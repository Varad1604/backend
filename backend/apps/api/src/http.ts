import type { FastifyInstance } from 'fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { env } from './config/env';
export async function configureHttp(app: NestFastifyApplication): Promise<void> {
  app.setGlobalPrefix('api/v1');
  await app.register(cookie);
  await app.register(helmet, { contentSecurityPolicy: false });
  // Brief §3: exact-origin allowlist with credentials, never a wildcard (CONTRACT_DIFF #123).
  await app.register(cors, { origin: env.webOriginList, credentials: true });
  await app.register(multipart, { limits: { files: 1, fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, fields: 2 } });
  (app.getHttpAdapter().getInstance() as FastifyInstance).addHook('onSend', async (request, reply, payload) => {
    reply.header('X-Request-Id', request.id);
    // Handlers may set `private, no-store` (file downloads, CONTRACT_DIFF #136); never weaken it.
    if (!reply.hasHeader('Cache-Control')) reply.header('Cache-Control', 'no-store');
    return payload;
  });
}
