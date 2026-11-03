import { permits, roleCapabilities, type Capability } from './policy';
import { ConflictException, ForbiddenException, HttpException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { env } from '../../config/env';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';
import { RateLimitService } from './rate-limit.service';
import { canonical } from '../audit/audit-chain';
import type { Actor } from './identity.types';
import type { RoleCode } from './policy';

const includeRoles = { userRoles: { include: { role: { include: { capabilities: { include: { capability: true } } } } } } } as const;
type UserWithRoles = Prisma.UserGetPayload<{ include: typeof includeRoles }>;
const grantedCapabilities = (user: UserWithRoles) => [...new Set(user.userRoles.flatMap(grant => grant.role.capabilities.map(link => link.capability.code)))];
export const userDto = (user: UserWithRoles) => ({ id: user.id, username: user.employeeCode, displayName: user.fullName, fullName: user.fullName,
  employeeCode: user.employeeCode, roles: user.userRoles.map(grant => grant.role.code), synthetic: user.synthetic,
  active: user.isActive, isActive: user.isActive, mustChangePassword: user.mustChangePassword });
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const equal = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const credentials = (sessionId: string) => ({ refreshToken: sessionId + '.' + randomBytes(32).toString('base64url'), csrfToken: randomBytes(32).toString('base64url') });
export interface SessionContext { ip: string; userAgent?: string; clientType: 'web' | 'mobile' }

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService,
    private readonly passwords: PasswordService, private readonly tokens: TokenService,
    private readonly limits: RateLimitService) {}
  private async lock(tx: Prisma.TransactionClient) { await tx.$executeRaw`SELECT pg_advisory_xact_lock(6200001)`; }
  private transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(work, { timeout: 10_000 });
  }
  async authorize(actor: Actor, capability: Capability, tx?: Prisma.TransactionClient): Promise<Actor> {
    const session = await (tx ?? this.prisma).session.findUnique({ where: { id: actor.sessionId }, include: { user: { include: includeRoles } } });
    if (!session || session.userId !== actor.userId || session.revokedAt || session.expiresAt <= new Date() || !session.user.isActive) throw new UnauthorizedException('Invalid or expired session.');
    const current = { userId: session.userId, sessionId: session.id, roles: userDto(session.user).roles, capabilities: grantedCapabilities(session.user), mustChangePassword: session.user.mustChangePassword };
    if (!permits(current.capabilities, capability)) throw new ForbiddenException('Permission denied.');
    return current;
  }
  async login(username: string, password: string, context: SessionContext) {
    // Brief §3: 5/min per IP+username; lockout is checked per account.
    await this.limits.limitLogin(context.ip, username);
    await this.limits.checkAccount(username);
    // R-22: usernames are unique case-insensitively (stored lowercase, legacy rows may be uppercase).
    const user = await this.prisma.user.findUnique({ where: { employeeCode: username }, include: includeRoles })
      ?? await this.prisma.user.findUnique({ where: { employeeCode: username.toLowerCase() }, include: includeRoles });
    const valid = await this.passwords.verify(password, user?.passwordHash);
    if (!valid || !user?.isActive) {
      await this.limits.failure(username);
      await this.transaction(tx => this.audit.append(tx, { entityType: 'AuthAttempt', entityId: hash(username), action: 'login_failed' }));
      throw new UnauthorizedException('Username or password is incorrect.');
    }
    const id = randomUUID();
    const secrets = credentials(id);
    const result = await this.transaction(async tx => {
      await this.lock(tx);
      const current = await tx.user.findUnique({ where: { id: user.id }, include: includeRoles });
      if (!current?.isActive || current.passwordHash !== user.passwordHash) throw new UnauthorizedException('Username or password is incorrect.');
      const now = new Date();
      const sessions = await tx.session.findMany({ where: { revokedAt: null, expiresAt: { gt: now } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
      for (const oldest of sessions.slice(0, Math.max(0, sessions.length - 4))) {
        await tx.session.update({ where: { id: oldest.id }, data: { revokedAt: now } });
        await this.audit.append(tx, { entityType: 'Session', entityId: oldest.id, actorId: user.id, action: 'session_evicted', reason: 'Global five-session limit' });
      }
      await tx.session.create({ data: { id, userId: user.id, refreshTokenHash: hash(secrets.refreshToken), csrfTokenHash: hash(secrets.csrfToken), clientType: context.clientType,
        ip: context.ip, userAgent: context.userAgent?.slice(0, 512), lastSeenAt: now, expiresAt: new Date(now.getTime() + 12 * 3_600_000) } });
      await this.audit.append(tx, { entityType: 'Session', entityId: id, actorId: user.id, action: 'login', newValue: { clientType: context.clientType } });
      return userDto(current);
    });
    await this.limits.success(username);
    return { ...secrets, accessToken: this.tokens.issue(user.id, id), expiresInSec: 900 as const, user: result };
  }
  async authenticate(token: string): Promise<Actor> {
    const claims = this.tokens.verify(token);
    const session = await this.prisma.session.findUnique({ where: { id: claims.sid }, include: { user: { include: includeRoles } } });
    if (!session || session.userId !== claims.sub || session.revokedAt || session.expiresAt <= new Date() || !session.user.isActive) throw new UnauthorizedException('Invalid or expired session.');
    return { userId: session.userId, sessionId: session.id, roles: userDto(session.user).roles, capabilities: grantedCapabilities(session.user), mustChangePassword: session.user.mustChangePassword };
  }
  async authenticateCookie(token: string): Promise<Actor> {
    const now = new Date();
    const session = await this.prisma.session.findUnique({ where: { refreshTokenHash: hash(token) }, include: { user: { include: includeRoles } } });
    if (!session || session.revokedAt || session.expiresAt <= now || session.lastSeenAt <= new Date(now.getTime() - 2 * 3_600_000) || !session.user.isActive) {
      throw new UnauthorizedException('Invalid or expired session.');
    }
    await this.prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: now } });
    return { userId: session.userId, sessionId: session.id, roles: userDto(session.user).roles, capabilities: grantedCapabilities(session.user), mustChangePassword: session.user.mustChangePassword };
  }
  // Transitional non-browser refresh. Browser clients use the session cookie and sign in
  // again when it expires; the JS-readable CSRF cookie was removed with CONTRACT_DIFF #119A.
  async refresh(token: string, context: SessionContext) {
    await this.limits.limitPerSession(context.ip); // transitional route: keyed per presented token context
    const id = token.split('.')[0];
    if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw new UnauthorizedException('Invalid or expired session.');
    const secrets = credentials(id);
    const outcome = await this.transaction(async tx => {
      await this.lock(tx);
      const session = await tx.session.findUnique({ where: { id }, include: { user: { include: includeRoles } } });
      if (!session || session.revokedAt || session.expiresAt <= new Date() || !session.user.isActive || session.clientType !== context.clientType) return null;
      const presented = hash(token);
      if (!equal(presented, session.refreshTokenHash)) {
        const reused = await tx.refreshTokenHistory.findUnique({ where: { tokenHash: presented } });
        if (reused?.sessionId === id) {
          await tx.session.update({ where: { id }, data: { revokedAt: new Date() } });
          await this.audit.append(tx, { entityType: 'Session', entityId: id, actorId: session.userId, action: 'refresh_reuse_revoked' });
        }
        return null;
      }
      await tx.refreshTokenHistory.create({ data: { tokenHash: session.refreshTokenHash, sessionId: id, expiresAt: session.expiresAt } });
      await tx.session.update({ where: { id }, data: { refreshTokenHash: hash(secrets.refreshToken) } });
      // Keep CSRF stable for the lifetime of a session so concurrent tabs can recover.
      await this.audit.append(tx, { entityType: 'Session', entityId: id, actorId: session.userId, action: 'refresh_rotated' });
      return userDto(session.user);
    });
    // Throw outside the transaction: reuse revocation and its audit must commit.
    if (!outcome) throw new UnauthorizedException('Invalid or expired session.');
    return { refreshToken: secrets.refreshToken, accessToken: this.tokens.issue(outcome.id, id), expiresInSec: 900 as const, user: outcome };
  }
  async logout(actor: Actor): Promise<void> {
    await this.transaction(async tx => {
      await this.lock(tx);
      await tx.session.updateMany({ where: { id: actor.sessionId, userId: actor.userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit.append(tx, { entityType: 'Session', entityId: actor.sessionId, actorId: actor.userId, action: 'logout' });
    });
  }
  async me(actor: Actor) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: actor.userId }, include: includeRoles });
    return userDto(user);
  }
  async changePassword(actor: Actor, key: string, currentPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: actor.userId }, include: includeRoles });
    if (!await this.passwords.verify(currentPassword, user.passwordHash)) throw new UnauthorizedException('Current password is incorrect.');
    const passwordHash = await this.passwords.hash(newPassword);
    // Brief §3: the change is a write, so it consumes an Idempotency-Key like every other write.
    return this.identityWrite(actor, 'auth.self', '/auth/change-password', key, { targetId: actor.userId }, async tx => {
      await this.lock(tx);
      await tx.user.update({ where: { id: actor.userId }, data: { passwordHash, mustChangePassword: false } });
      await tx.session.updateMany({ where: { userId: actor.userId, id: { not: actor.sessionId }, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit.append(tx, { entityType: 'User', entityId: actor.userId, actorId: actor.userId, action: 'password_changed' });
      return { changed: true };
    });
  }
  async createUser(actor: Actor, key: string, username: string, displayName: string, roles: RoleCode[]) {
    const temporaryPassword = randomBytes(18).toString('base64url');
    const passwordHash = await this.passwords.hash(temporaryPassword);
    return this.identityWrite(actor, 'admin.users', '/admin/users', key, { username, displayName, roles }, async tx => {
      const created = await tx.user.create({ data: { employeeCode: username.toLowerCase(), fullName: displayName, passwordHash,
        mustChangePassword: true, synthetic: env.APP_MODE !== 'production' } });
      for (const code of roles) {
        const role = await this.ensureRole(tx, code);
        await tx.userRole.create({ data: { userId: created.id, roleId: role.id, grantedBy: actor.userId } });
      }
      await this.audit.append(tx, { entityType: 'User', entityId: created.id, actorId: actor.userId, action: 'user_created',
        newValue: { username: username.toLowerCase(), displayName, roles } });
      const user = await tx.user.findUniqueOrThrow({ where: { id: created.id }, include: includeRoles });
      return { ...userDto(user), temporaryPassword };
    });
  }
  async updateUser(actor: Actor, targetId: string, key: string, input: { displayName?: string; roles?: RoleCode[]; active?: boolean }) {
    return this.identityWrite(actor, 'admin.users', '/admin/users/' + targetId, key, input, async tx => {
      const before = await tx.user.findUniqueOrThrow({ where: { id: targetId }, include: includeRoles });
      if (actor.userId === targetId && input.active === false) throw new ForbiddenException('You cannot deactivate your own account.');
      const beforeRoles = userDto(before).roles;
      if (before.isActive && beforeRoles.includes('admin') && (input.active === false || (input.roles && !input.roles.includes('admin')))) {
        const otherAdmins = await tx.user.count({ where: { id: { not: targetId }, isActive: true, userRoles: { some: { role: { code: 'admin' } } } } });
        if (!otherAdmins) throw new ConflictException('At least one active administrator is required.');
      }
      await tx.user.update({ where: { id: targetId }, data: { ...(input.displayName ? { fullName: input.displayName } : {}), ...(input.active !== undefined ? { isActive: input.active } : {}) } });
      if (input.roles) {
        await tx.userRole.deleteMany({ where: { userId: targetId } });
        for (const code of input.roles) {
          const role = await this.ensureRole(tx, code);
          await tx.userRole.create({ data: { userId: targetId, roleId: role.id, grantedBy: actor.userId } });
        }
      }
      // Brief §5.1: rotate the session on role change; deactivation revokes immediately.
      // A display-name-only edit does not sign the person out (CONTRACT_DIFF #174, decision A).
      const rolesChanged = input.roles !== undefined && JSON.stringify(input.roles.slice().sort()) !== JSON.stringify(beforeRoles.slice().sort());
      const activeChanged = input.active !== undefined && input.active !== before.isActive;
      if (rolesChanged || activeChanged) await tx.session.updateMany({ where: { userId: targetId, revokedAt: null }, data: { revokedAt: new Date() } });
      const after = await tx.user.findUniqueOrThrow({ where: { id: targetId }, include: includeRoles });
      await this.audit.append(tx, { entityType: 'User', entityId: targetId, actorId: actor.userId, action: 'user_updated', oldValue: userDto(before), newValue: userDto(after) });
      return userDto(after);
    }, 'PATCH');
  }
  async resetPassword(actor: Actor, targetId: string, key: string) {
    const temporaryPassword = randomBytes(18).toString('base64url');
    const passwordHash = await this.passwords.hash(temporaryPassword);
    return this.identityWrite(actor, 'admin.users', '/admin/users/' + targetId + '/reset-password', key, { targetId }, async tx => {
      await tx.user.update({ where: { id: targetId }, data: { passwordHash, mustChangePassword: true } });
      await tx.session.updateMany({ where: { userId: targetId, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit.append(tx, { entityType: 'User', entityId: targetId, actorId: actor.userId, action: 'password_reset' });
      const user = await tx.user.findUniqueOrThrow({ where: { id: targetId }, include: includeRoles });
      return { ...userDto(user), temporaryPassword };
    });
  }
  async setDemoAccess(actor: Actor, targetId: string, roles: RoleCode[], isActive: boolean, reason: string) {
    if (!reason.trim()) throw new ForbiddenException('A reason is required.');
    return this.transaction(async tx => {
      await this.lock(tx);
      const administrator = await tx.user.findUnique({ where: { id: actor.userId }, include: includeRoles });
      const session = await tx.session.findUnique({ where: { id: actor.sessionId } });
      if (!administrator?.isActive || !userDto(administrator).roles.includes('admin') || !session || session.userId !== actor.userId || session.revokedAt || session.expiresAt <= new Date()) throw new ForbiddenException('Permission denied.');
      const before = await tx.user.findUnique({ where: { id: targetId }, include: includeRoles });
      if (!before?.employeeCode?.startsWith('DEMO-')) throw new ForbiddenException('Production roster is not configured.');
      if (!before.isActive && isActive && await tx.user.count({ where: { isActive: true } }) >= 10) throw new ConflictException('Ten active users are already configured.');
      await tx.user.update({ where: { id: targetId }, data: { isActive } });
      await tx.userRole.deleteMany({ where: { userId: targetId } });
      for (const code of roles) {
        const role = await this.ensureRole(tx, code);
        await tx.userRole.create({ data: { userId: targetId, roleId: role.id, grantedBy: actor.userId } });
      }
      await tx.session.updateMany({ where: { userId: targetId, revokedAt: null }, data: { revokedAt: new Date() } });
      const after = userDto(await tx.user.findUniqueOrThrow({ where: { id: targetId }, include: includeRoles }));
      await this.audit.append(tx, { entityType: 'User', entityId: targetId, actorId: actor.userId, action: 'demo_access_changed', oldValue: userDto(before), newValue: after, reason });
      return after;
    });
  }

  async listUsers() { return (await this.prisma.user.findMany({ include: includeRoles, orderBy: { createdAt: 'asc' }, take: 100 })).map(userDto); }
  async bootstrapDemo(employeeCode: string, fullName: string, password: string, roles: RoleCode[]) {
    if (!employeeCode.startsWith('DEMO-') || !fullName.startsWith('DEMO-')) throw new ForbiddenException('Synthetic bootstrap requires DEMO-prefixed data.');
    const passwordHash = await this.passwords.hash(password);
    return this.transaction(async tx => {
      await this.lock(tx);
      if (await tx.user.count({ where: { isActive: true } }) >= 10) throw new ConflictException('Ten active users are already configured.');
      const user = await tx.user.create({ data: { employeeCode, fullName, passwordHash } });
      for (const code of roles) {
        const role = await this.ensureRole(tx, code);
        await tx.userRole.create({ data: { userId: user.id, roleId: role.id, grantedBy: user.id } });
      }
      await this.audit.append(tx, { entityType: 'User', entityId: user.id, actorId: user.id, action: 'demo_user_bootstrapped', newValue: { employeeCode, fullName, roles } });
      return userDto(await tx.user.findUniqueOrThrow({ where: { id: user.id }, include: includeRoles }));
    });
  }
  private async ensureRole(tx: Prisma.TransactionClient, code: RoleCode) {
    const role = await tx.role.upsert({ where: { code }, update: {}, create: { code } });
    for (const capabilityCode of roleCapabilities[code]) {
      const capability = await tx.capability.upsert({ where: { code: capabilityCode }, update: {}, create: { code: capabilityCode } });
      await tx.roleCapability.upsert({ where: { roleId_capabilityId: { roleId: role.id, capabilityId: capability.id } }, update: {}, create: { roleId: role.id, capabilityId: capability.id } });
    }
    return role;
  }
  private identityWrite<T extends Prisma.InputJsonObject>(actor: Actor, capability: Capability, path: string, key: string, input: Prisma.InputJsonValue,
    work: (tx: Prisma.TransactionClient) => Promise<T>, method = 'POST'): Promise<{ body: T; replayed: boolean }> {
    const requestHash = createHash('sha256').update(canonical(input)).digest('hex');
    return this.transaction(async tx => {
      const current = await this.authorize(actor, capability, tx);
      const scope = current.userId + ':' + method + ':' + path + ':' + key;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(6200010, hashtext(${scope}))`;
      const identity = { userId: current.userId, method, path, key };
      const previous = await tx.idempotencyRecord.findUnique({ where: { userId_method_path_key: identity } });
      if (previous && previous.expiresAt > new Date()) {
        if (previous.requestHash !== requestHash) throw new HttpException({ code: 'VALIDATION_FAILED', message: 'Idempotency key reused with different data' }, 422);
        return { body: previous.responseBody as T, replayed: true };
      }
      if (previous) await tx.idempotencyRecord.delete({ where: { id: previous.id } });
      const body = await work(tx);
      await tx.idempotencyRecord.create({ data: { ...identity, requestHash, responseStatus: 201, responseBody: body, status: 'completed', expiresAt: new Date(Date.now() + 86_400_000) } });
      return { body, replayed: false };
    });
  }
}
