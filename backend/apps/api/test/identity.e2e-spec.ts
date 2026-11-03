import 'reflect-metadata';
import { Controller, Get } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { PrismaClient } from '@prisma/client';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureHttp } from '../src/http';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { AuthService } from '../src/modules/identity-access/auth.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { env } from '../src/config/env';

@Controller('unannotated-test')
class ClosedController { @Get() get() { return { secret: 'must never be returned' }; } }
const live = process.env.REQUIRE_LIVE_DEPENDENCIES === 'true';
describe.skipIf(!live)('P1 real persistence and security (isolated temporary schema)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let base: PrismaClient;
  let auth: AuthService;
  let audit: AuditService;
  const schema = 'p1_' + randomUUID().replaceAll('-', '');
  const password = randomBytes(24).toString('base64url');
  const code = 'DEMO-' + randomUUID();
  let gateId: string;
  let adminId: string;
  let counter = 0;
  const login = async (username = code, clientType: 'web' | 'mobile' = 'mobile', extra = {}) => app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: '198.51.100.' + (++counter), payload: { username, password, clientType, ...extra } });
  const bearer = (token: string) => ({ authorization: 'Bearer ' + token });
  beforeAll(async () => {
    const url = new URL(env.DATABASE_URL);
    url.searchParams.set('schema', schema);
    execFileSync(process.execPath, [resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy'], { env: { ...process.env, DATABASE_URL: url.toString() }, stdio: 'pipe' });
    base = new PrismaClient();
    prisma = new PrismaService({ datasourceUrl: url.toString() });
    const module = await Test.createTestingModule({ imports: [AppModule], controllers: [ClosedController] }).overrideProvider(PrismaService).useValue(prisma).compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await configureHttp(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    auth = app.get(AuthService); audit = app.get(AuditService);
    gateId = (await auth.bootstrapDemo(code, 'DEMO-Gate Test', password, ['gate'])).id;
    adminId = (await auth.bootstrapDemo(code + '-ADMIN', 'DEMO-Admin Test', password, ['admin'])).id;
  }, 30_000);
  afterAll(async () => {
    vi.restoreAllMocks();
    await app?.close();
    if (base) {
      // Only this test-generated, validated schema is removed; no app data is touched.
      if (!/^p1_[a-f0-9]{32}$/.test(schema)) throw Error('Unsafe test schema');
      await base.$executeRawUnsafe('DROP SCHEMA "' + schema + '" CASCADE');
      await base.$disconnect();
    }
  });
  it('denies unauthenticated reads and unknown capabilities with a request ID', async () => {
    const denied = await app.inject({ method: 'GET', url: '/api/v1/auth/me' });
    expect(denied.statusCode).toBe(401);
    expect(denied.json().error).toMatchObject({ code: 'UNAUTHENTICATED', requestId: expect.any(String) });
    const session = (await login()).json().data;
    const closed = await app.inject({ method: 'GET', url: '/api/v1/unannotated-test', headers: bearer(session.accessToken) });
    expect(closed.statusCode).toBe(403);
  });
  it('logs in, keeps only token hashes, and enforces admin permissions', async () => {
    const response = await login(); expect(response.statusCode).toBe(200);
    const data = response.json().data;
    expect(data.user).toMatchObject({ id: gateId, employeeCode: code, roles: ['gate'] });
    const me = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: bearer(data.accessToken) });
    expect(me.statusCode).toBe(200);
    expect(me.json().data).not.toHaveProperty('passwordHash');
    expect((await app.inject({ method: 'GET', url: '/api/v1/identity/users', headers: bearer(data.accessToken) })).statusCode).toBe(403);
    const row = await prisma.session.findFirstOrThrow({ where: { userId: gateId }, orderBy: { createdAt: 'desc' } });
    expect(row.refreshTokenHash).not.toBe(data.refreshToken);
    const events = JSON.stringify(await prisma.auditEvent.findMany(), (_, value) => typeof value === 'bigint' ? value.toString() : value);
    expect(events).not.toContain(data.refreshToken); expect(events).not.toContain(password); expect(events).not.toContain(data.accessToken);
  });
  it('returns the flat User to the web client and sets only the __Host session cookie', async () => {
    const response = await login(code, 'web'); expect(response.statusCode).toBe(200);
    const data = response.json().data;
    // Brief §5.1: the web login body is exactly the User (CONTRACT_DIFF #72).
    expect(data).toMatchObject({ id: gateId, username: code, roles: ['gate'], active: true, synthetic: true });
    expect(data).not.toHaveProperty('refreshToken'); expect(data).not.toHaveProperty('accessToken'); expect(data).not.toHaveProperty('csrfToken');
    expect(response.headers['cache-control']).toBe('no-store');
    const cookies = response.cookies;
    // Brief §8: the session cookie is the only cookie (CONTRACT_DIFF #118/#119).
    expect(cookies.map(cookie => cookie.name)).toEqual(['__Host-kpmpl_sid']);
    const session = cookies[0]!;
    expect(session).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/', secure: true });
    // The transitional refresh route refuses browser-style calls (no cookie transport).
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', headers: { cookie: session.name + '=' + session.value }, payload: {} })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { origin: 'https://foreign.example' }, payload: { username: code, password } })).statusCode).toBe(403);
  });
  it('commits refresh reuse revocation so the successor and access token both stop working', async () => {
    const first = (await login()).json().data;
    const next = await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', payload: { refreshToken: first.refreshToken } });
    expect(next.statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', payload: { refreshToken: first.refreshToken } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', payload: { refreshToken: next.json().data.refreshToken } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: bearer(next.json().data.accessToken) })).statusCode).toBe(401);
    expect(await prisma.auditEvent.count({ where: { action: 'refresh_reuse_revoked' } })).toBeGreaterThan(0);
  });
  it('caps concurrent logins globally even when requests race', async () => {
    const old = (await login(code + '-ADMIN')).json().data;
    const requests = await Promise.all(Array.from({ length: 6 }, () => login()));
    expect(requests.every(response => response.statusCode === 200)).toBe(true);
    expect(await prisma.session.count({ where: { revokedAt: null, expiresAt: { gt: new Date() } } })).toBe(5);
    expect((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: bearer(old.accessToken) })).statusCode).toBe(401);
  }, 20_000);
  it('revokes all sessions when demo roles or account activity changes', async () => {
    const administrator = (await login(code + '-ADMIN')).json().data;
    const actor = await auth.authenticate(administrator.accessToken);
    const gate = (await login()).json().data;
    await auth.setDemoAccess(actor, gateId, ['qc'], false, 'DEMO account deactivation test');
    expect((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: bearer(gate.accessToken) })).statusCode).toBe(401);
    expect((await login()).statusCode).toBe(401);
    await auth.setDemoAccess(actor, gateId, ['gate'], true, 'DEMO account restoration');
    const loggedIn = (await login()).json().data;
    await auth.setDemoAccess(actor, gateId, ['qc'], true, 'DEMO role correction');
    expect((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: bearer(loggedIn.accessToken) })).statusCode).toBe(401);
  });
  it('keeps the session alive for a display-name-only admin edit but rotates it on a role change', async () => {
    // Brief §5.1: rotate on role change; a cosmetic edit must not sign the person out (CONTRACT_DIFF #174).
    const administrator = (await login(code + '-ADMIN')).json().data;
    const headers = { ...bearer(administrator.accessToken), 'idempotency-key': randomUUID() };
    const created = await app.inject({ method: 'POST', url: '/api/v1/admin/users', headers, payload: { username: 'demo.rename.' + randomUUID().slice(0, 8), displayName: 'DEMO Rename Me', roles: ['qc'] } });
    expect(created.statusCode).toBe(201);
    const target = created.json().data;
    const signedIn = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: target.username, password: target.temporaryPassword, clientType: 'mobile' } });
    const token = signedIn.json().data.accessToken;
    const renamed = await app.inject({ method: 'PATCH', url: '/api/v1/admin/users/' + target.id, headers: { ...headers, 'idempotency-key': randomUUID() }, payload: { displayName: 'DEMO Renamed User' } });
    expect(renamed.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: bearer(token) })).statusCode).toBe(200);
    const roleChanged = await app.inject({ method: 'PATCH', url: '/api/v1/admin/users/' + target.id, headers: { ...headers, 'idempotency-key': randomUUID() }, payload: { roles: ['ho'] } });
    expect(roleChanged.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: bearer(token) })).statusCode).toBe(401);
  }, 20_000);
  it('revokes logout and rejects expired or wrong-algorithm tokens', async () => {
    const data = (await login()).json().data;
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: bearer(data.accessToken) })).statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: bearer(data.accessToken) })).statusCode).toBe(401);
    const fresh = (await login()).json().data;
    const now = Date.now(); vi.spyOn(Date, 'now').mockReturnValue(now + 16 * 60_000);
    expect((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: bearer(fresh.accessToken) })).statusCode).toBe(401);
    vi.restoreAllMocks();
    expect((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: bearer('eyJhbGciOiJub25lIn0.e30.') })).statusCode).toBe(401);
  });
  it('rate-limits the 6th login attempt per IP+username and uses the brief failure message', async () => {
    const unknown = 'DEMO-UNKNOWN-' + randomUUID();
    // One fixed client IP so the per-IP+username budget actually accumulates.
    const attempt = (username: string, extra = {}) => app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: '198.51.100.7', payload: { username, password, clientType: 'mobile', ...extra } });
    for (let i = 0; i < 5; i++) expect((await attempt(unknown)).statusCode).toBe(401);
    // Brief §3: login 5/min per IP+username — the 6th attempt within the minute is 429.
    const limited = await attempt(unknown);
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error).toMatchObject({ code: 'RATE_LIMITED', message: 'Too many attempts. Wait a minute and try again.' });
    // Unknown user and wrong password are indistinguishable (brief §8).
    expect((await attempt(code, { password: 'DEMO-wrong-password' })).json().error.message).toBe('Username or password is incorrect.');
  });
  it('authenticates web requests from the httpOnly session cookie and exposes named pending policies', async () => {
    const response = await login(code, 'web');
    const sessionCookie = response.cookies.find(item => item.name === '__Host-kpmpl_sid');
    expect(sessionCookie).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' });
    const headers = { cookie: sessionCookie!.name + '=' + sessionCookie!.value };
    const me = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers });
    expect(me.statusCode).toBe(200); expect(me.json().data).toMatchObject({ username: code, displayName: 'DEMO-Gate Test', synthetic: true, active: true });
    const policies = await app.inject({ method: 'GET', url: '/api/v1/config/policies', headers });
    expect(policies.statusCode).toBe(200);
    expect(policies.json().data).toMatchObject({ qcDeductionCalculation: { value: 'not_configured', decision: 'D-02' }, qcDecisionBy: { value: 'qc_operator', decision: 'D-03', status: 'decided' } });
    expect(policies.json().data).not.toHaveProperty('qcReviewEnabled');
    // CSRF proof on cookie-authenticated writes: allowlisted Origin + the custom header (brief §3).
    const probe = async (extra: Record<string, string>) => app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: { ...headers, ...extra } });
    expect((await probe({})).statusCode).toBe(403);
    expect((await probe({ 'x-requested-with': 'kpmpl-web' })).statusCode).toBe(403);
    expect((await probe({ 'x-requested-with': 'kpmpl-web', origin: 'https://evil.example' })).statusCode).toBe(403);
    expect((await probe({ 'x-requested-with': 'kpmpl-web', origin: 'http://localhost:5173' })).statusCode).toBe(204);
  });
  it('stores the role matrix in the database and enforces admin safeguards and password lifecycle', async () => {
    expect(await prisma.capability.count()).toBeGreaterThan(10);
    expect(await prisma.roleCapability.count()).toBeGreaterThan(10);
    const administrator = (await login(code + '-ADMIN')).json().data;
    const headers = { ...bearer(administrator.accessToken), 'idempotency-key': randomUUID() };
    const username = 'demo.user.' + randomUUID().slice(0, 8);
    const created = await app.inject({ method: 'POST', url: '/api/v1/admin/users', headers, payload: { username, displayName: 'DEMO-Created User', roles: ['qc'] } });
    expect(created.statusCode).toBe(201);
    expect(created.json().data).toMatchObject({ username, displayName: 'DEMO-Created User', roles: ['qc'], mustChangePassword: true });
    const temporaryPassword = created.json().data.temporaryPassword as string;
    expect(temporaryPassword.length).toBeGreaterThanOrEqual(10);
    const replay = await app.inject({ method: 'POST', url: '/api/v1/admin/users', headers, payload: { username, displayName: 'DEMO-Created User', roles: ['qc'] } });
    expect(replay.statusCode).toBe(201); expect(replay.headers['idempotent-replay']).toBe('true'); expect(replay.json()).toEqual(created.json());
    const changedRetry = await app.inject({ method: 'POST', url: '/api/v1/admin/users', headers, payload: { username, displayName: 'DEMO-Changed Retry', roles: ['qc'] } });
    expect(changedRetry.statusCode).toBe(422); expect(changedRetry.json().error.code).toBe('VALIDATION_FAILED');
    const signedIn = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username, password: temporaryPassword, clientType: 'mobile' } });
    expect(signedIn.statusCode).toBe(200);
    const accessToken = signedIn.json().data.accessToken as string;
    const newPassword = 'DEMO-new-secure-password-' + randomUUID();
    // Brief §3: change-password is a write, so the Idempotency-Key is required (CONTRACT_DIFF #110).
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/change-password', headers: bearer(accessToken), payload: { currentPassword: temporaryPassword, newPassword } })).statusCode).toBe(422);
    const changed = await app.inject({ method: 'POST', url: '/api/v1/auth/change-password', headers: { ...bearer(accessToken), 'idempotency-key': randomUUID() }, payload: { currentPassword: temporaryPassword, newPassword } });
    expect(changed.statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username, password: temporaryPassword, clientType: 'mobile' } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username, password: newPassword, clientType: 'mobile' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'PATCH', url: '/api/v1/admin/users/' + adminId, headers: { ...bearer(administrator.accessToken), 'idempotency-key': randomUUID() }, payload: { active: false } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'PATCH', url: '/api/v1/admin/users/' + adminId, headers: { ...bearer(administrator.accessToken), 'idempotency-key': randomUUID() }, payload: { roles: ['gate'] } })).statusCode).toBe(409);
  }, 20_000);
  it('enforces audit immutability and transactional rollback', async () => {
    const event = await prisma.auditEvent.findFirstOrThrow();
    await expect(prisma.auditEvent.update({ where: { id: event.id }, data: { action: 'DEMO-tamper' } })).rejects.toThrow();
    await expect(prisma.$executeRawUnsafe('TRUNCATE "AuditEvent"')).rejects.toThrow();
    const count = await prisma.auditEvent.count();
    await expect(prisma.$transaction(async tx => {
      await audit.append(tx, { entityType: 'User', entityId: adminId, action: 'DEMO-rollback', actorId: adminId });
      throw Error('Rollback this transaction');
    })).rejects.toThrow('Rollback');
    expect(await prisma.auditEvent.count()).toBe(count);
    expect((await audit.verify()).valid).toBe(true);
  });
  it('keeps blocked client rules inactive and restricts account bootstrap', async () => {
    const token = (await login()).json().data.accessToken;
    const response = await app.inject({ method: 'GET', url: '/api/v1/platform/features', headers: bearer(token) });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({ qcDecisions: true, module2: false, deductionCalculation: 'not_configured', productionRoster: 'not_configured' });
    await expect(auth.bootstrapDemo('REAL-EMPLOYEE', 'Real Employee', password, ['admin'])).rejects.toThrow();
    const admin = (await login(code + '-ADMIN')).json().data;
    expect((await app.inject({ method: 'GET', url: '/api/v1/identity/users', headers: bearer(admin.accessToken) })).statusCode).toBe(200);
    const remainingCapacity = 10 - await prisma.user.count({ where: { isActive: true } });
    for (let i = 0; i < remainingCapacity; i++) await auth.bootstrapDemo(code + '-' + i, 'DEMO-Capacity ' + i, password, ['qc']);
    await expect(auth.bootstrapDemo(code + '-EXTRA', 'DEMO-Extra', password, ['qc'])).rejects.toThrow('Ten active users');
    expect(await prisma.user.count({ where: { isActive: true } })).toBe(10);
  }, 20_000);
});
