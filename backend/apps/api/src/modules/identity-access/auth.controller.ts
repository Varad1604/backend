import { Body, Controller, ForbiddenException, Get, Headers, HttpCode, Post, Req, Res, UnprocessableEntityException } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { env } from '../../config/env';
import { Public, Requires } from './access.decorators';
import { AuthService } from './auth.service';
import type { AuthRequest } from './identity.types';
import { PasswordService } from './password.service';
import { idempotencyKeySchema } from '../receiving/receiving.schemas';
const loginSchema = z.object({ username: z.string().min(3).max(100), password: z.string().min(8).max(128), clientType: z.enum(['web', 'mobile']).default('web') }).strict();
const refreshSchema = z.object({ refreshToken: z.string().max(256).optional() }).strict();
const changePasswordSchema = z.object({ currentPassword: z.string().min(1).max(128), newPassword: z.string().min(10).max(128) }).strict();
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService, private readonly passwords: PasswordService) {}
  private origin(request: FastifyRequest): void {
    // Brief §3: the Origin must be on the exact allowlist; cross-site fetch-site is rejected.
    if ((request.headers.origin && !env.webOriginList.includes(request.headers.origin)) || request.headers['sec-fetch-site'] === 'cross-site') throw new ForbiddenException('Origin is not permitted.');
  }
  // Brief §8: the session cookie is the only cookie — `__Host-kpmpl_sid`, HttpOnly, Secure,
  // SameSite=Lax, Path=/, no Domain (CONTRACT_DIFF #117-#119; the transitional refresh and
  // JS-readable CSRF cookies were removed with decision A).
  private cookies(reply: FastifyReply, refreshToken: string) {
    reply.setCookie('__Host-kpmpl_sid', refreshToken, { secure: env.COOKIE_SECURE === 'true', httpOnly: true, sameSite: 'lax', path: '/', maxAge: 12 * 3_600 });
  }
  @Public() @Post('login') @HttpCode(200)
  async login(@Body() body: unknown, @Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    this.origin(request);
    const input = loginSchema.parse(body);
    if (input.clientType === 'mobile' && request.headers.origin) throw new ForbiddenException('Browser clients must use cookie sessions.');
    const result = await this.auth.login(input.username, input.password, { ip: request.ip, userAgent: request.headers['user-agent'], clientType: input.clientType });
    reply.header('Cache-Control', 'no-store');
    if (input.clientType === 'web') {
      this.cookies(reply, result.refreshToken);
      // Brief §5.1: the web login response body is exactly the User (CONTRACT_DIFF #72).
      return { data: result.user };
    }
    return { data: result };
  }
  @Public() @Post('refresh') @HttpCode(200)
  async refresh(@Body() body: unknown, @Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    // Transitional endpoint for non-browser clients only: browsers use the session cookie
    // and re-authenticate when it expires (the brief defines no refresh route).
    this.origin(request);
    const input = refreshSchema.parse(body ?? {});
    if (request.cookies?.kpmpl_refresh || request.cookies?.['__Host-kpmpl_sid']) throw new ForbiddenException('Browser clients use cookie sessions.');
    const result = await this.auth.refresh(input.refreshToken ?? '', { ip: request.ip, userAgent: request.headers['user-agent'], clientType: 'mobile' });
    reply.header('Cache-Control', 'no-store');
    return { data: result };
  }
  @Requires('auth.self') @Get('me')
  async me(@Req() request: AuthRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    reply.header('Cache-Control', 'no-store');
    return { data: await this.auth.me(request.actor) };
  }
  @Requires('auth.self') @Post('logout') @HttpCode(204)
  async logout(@Req() request: AuthRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    this.origin(request);
    await this.auth.logout(request.actor);
    reply.clearCookie('__Host-kpmpl_sid', { path: '/' });
    reply.header('Cache-Control', 'no-store');
  }
  @Requires('auth.self') @Post('change-password') @HttpCode(200)
  async changePassword(@Body() body: unknown, @Headers('idempotency-key') key: string | undefined, @Req() request: AuthRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const input = changePasswordSchema.parse(body);
    try { this.passwords.assertAcceptable(input.newPassword); }
    catch (error) { throw new UnprocessableEntityException(error instanceof Error ? error.message : 'Choose a stronger password.'); }
    const result = await this.auth.changePassword(request.actor, idempotencyKeySchema.parse(key), input.currentPassword, input.newPassword);
    if (result.replayed) reply.header('Idempotent-Replay', 'true');
    return { data: result.body };
  }
}
