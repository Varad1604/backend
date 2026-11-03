import { ArgumentsHost, Catch, HttpException, type ExceptionFilter } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<FastifyRequest & { id?: string }>();
    const reply = context.getResponse<FastifyReply>();
    const requestId = request?.id ?? crypto.randomUUID();
    const fastifyCode = (error as { code?: string })?.code ?? '';
    // The Fastify adapter hands payload errors to this filter wrapped in a plain
    // HttpException carrying the transport status; brief §3 requires the envelope with
    // the right code on EVERY non-2xx (CONTRACT_DIFF #97).
    const statusCode = error instanceof z.ZodError ? 422
      : error instanceof HttpException ? error.getStatus()
      : fastifyCode === 'FST_ERR_CTP_BODY_TOO_LARGE' ? 413
      : typeof (error as { statusCode?: number })?.statusCode === 'number' ? (error as { statusCode: number }).statusCode
      : 500;
    const response = error instanceof HttpException ? error.getResponse() : null;
    // Readiness is a public machine-readable dependency report, not a domain error.
    if (statusCode === 503 && typeof response === 'object' && response !== null && 'checks' in response) {
      void reply.status(503).send(response); return;
    }
    const responseMessage = response === null || response === undefined ? undefined
      : typeof response === 'string' ? response
      : 'message' in response && typeof (response as { message: unknown }).message === 'string' ? (response as { message: string }).message
      : undefined;
    const isZod = error instanceof z.ZodError;
    // Approved user-facing wording for transport-level payload errors (CONTRACT_DIFF #97/#108).
    const frameworkMessage = statusCode === 413 || fastifyCode === 'FST_ERR_CTP_BODY_TOO_LARGE' ? 'The file is larger than the upload limit.'
      : fastifyCode === 'FST_ERR_CTP_INVALID_JSON' || /not valid JSON|Unexpected token/i.test(responseMessage ?? '') ? 'The request could not be read. Reload and try again.'
      : undefined;
    const message = statusCode === 500 ? 'Something went wrong. Nothing was saved.'
      : isZod ? 'Please check the highlighted fields.'
      : frameworkMessage ?? responseMessage ?? (error instanceof HttpException ? error.message : 'Request failed.');
    // A 500 must never be silent: log the underlying error with the requestId so the
    // response envelope can be correlated with the server-side cause (brief §11).
    if (statusCode === 500) console.error(`[api] 500 on ${request?.method} ${request?.url} (requestId=${requestId})`, error);
    const explicitCode = statusCode < 500 && response !== null && typeof response === 'object' && 'code' in response && typeof (response as { code: unknown }).code === 'string' ? (response as { code: string }).code : undefined;
    // Zod issues map to field errors; domain payloads may carry their own `fields` object.
    const fields = isZod ? Object.fromEntries(error.issues.map(issue => [issue.path.join('.'), issue.message]))
      : response !== null && typeof response === 'object' && 'fields' in response && response.fields && typeof response.fields === 'object' && !Array.isArray(response.fields)
        ? Object.fromEntries(Object.entries(response.fields as Record<string, unknown>).filter(([, value]) => typeof value === 'string')) as Record<string, string>
        : undefined;
    const meta = response !== null && typeof response === 'object' && 'meta' in response && response.meta && typeof response.meta === 'object' ? response.meta : undefined;
    // Status → code per brief §3; 400/413/415 transport errors are VALIDATION_FAILED.
    const code = explicitCode ?? ({ 400: 'VALIDATION_FAILED', 401: 'UNAUTHENTICATED', 403: 'FORBIDDEN', 404: 'NOT_FOUND', 409: 'CONFLICT', 413: 'VALIDATION_FAILED', 415: 'VALIDATION_FAILED', 422: 'VALIDATION_FAILED', 429: 'RATE_LIMITED', 503: 'UNAVAILABLE' } as Record<number, string>)[statusCode] ?? 'SERVER_ERROR';
    void reply.status(statusCode).send({ error: { code, message,
      ...(fields ? { fields } : {}), ...(statusCode === 413 && !fields?.file ? { fields: { ...(fields ?? {}), file: 'The file is larger than the upload limit.' } } : {}), ...(meta ? { meta } : {}), requestId } });
  }
}
