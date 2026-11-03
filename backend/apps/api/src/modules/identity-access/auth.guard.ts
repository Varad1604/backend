import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { env } from '../../config/env';
import { AuthService } from './auth.service';
import { RateLimitService } from './rate-limit.service';
import { permits, type Capability } from './policy';
import type { AuthRequest } from './identity.types';
import { Public, Requires, RequiresAny } from './access.decorators';
export { Public, Requires, RequiresAny };
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly auth: AuthService, private readonly limits: RateLimitService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>('kpmpl.public', targets)) return true;
    const request = context.switchToHttp().getRequest<AuthRequest>();
    const match = request.headers.authorization?.match(/^Bearer ([^ ]+)$/);
    const sessionCookie = request.cookies?.['__Host-kpmpl_sid'] ?? request.cookies?.kpmpl_sid;
    const cookieAuthenticated = !match?.[1] && Boolean(sessionCookie);
    if (!match?.[1] && !sessionCookie) throw new UnauthorizedException('Authentication required.');
    request.actor = match?.[1] ? await this.auth.authenticate(match[1]) : await this.auth.authenticateCookie(sessionCookie!);
    // Brief §3: general API budget is 300/min per session.
    await this.limits.limitPerSession(request.actor.sessionId);
    // Rulebook Phase 3 item 8: while the password flag is set the server serves only
    // the self-service auth endpoints; everything else refuses until it is cleared.
    if (request.actor.mustChangePassword) {
      const path = request.raw.url?.split('?')[0] ?? '';
      const selfService = path.endsWith('/auth/me') || path.endsWith('/auth/logout') || path.endsWith('/auth/change-password');
      if (!selfService) throw new ForbiddenException('Set a new password before using the system.');
    }
    const capability = this.reflector.getAllAndOverride<Capability>('kpmpl.capability', targets);
    const capabilitiesAny = this.reflector.getAllAndOverride<Capability[]>('kpmpl.capabilitiesAny', targets);
    if ((!capability && !capabilitiesAny?.length) || (capability && !permits(request.actor.capabilities, capability)) || (capabilitiesAny?.length && !capabilitiesAny.some(item => permits(request.actor.capabilities, item)))) throw new ForbiddenException('Permission denied.');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && cookieAuthenticated) {
      // CSRF proof: the Origin must be on the exact allowlist, plus the custom header (brief §3).
      const origin = request.headers.origin;
      if (!origin || !env.webOriginList.includes(origin) || request.headers['x-requested-with'] !== 'kpmpl-web') throw new ForbiddenException('Browser write proof is invalid.');
    }
    return true;
  }
}
