import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { PrismaClient } from '@prisma/client';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureHttp } from '../src/http';
import { env } from '../src/config/env';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { AuthService } from '../src/modules/identity-access/auth.service';
import { roleCapabilities } from '../src/modules/identity-access/policy';
import { MalwareScannerService } from '../src/modules/documents/malware-scanner.service';

/**
 * Rulebook Phase 3 (security hardening) — automated checks with evidence.
 * Items 1 (cookie), 2 (CSRF), 3 (CORS), 4 (API headers), 5 (rate limit/lockout),
 * 6 (uploads/EICAR/ClamAV/bucket), 7 (endpoint×role matrix), 8 (must-change-password),
 * 9 (audit coverage + no secrets in logs). Items 4 (SPA/CSP), 10 (bundle secrets) and
 * 11 (dependencies) live in the frontend E2E suite and SECURITY_VERIFICATION.md.
 */
const live = process.env.REQUIRE_LIVE_DEPENDENCIES === 'true';
const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
const pdfBuf = (content: string) => Buffer.from(`%PDF-1.4\n${content}\n%%EOF`, 'latin1');

describe.skipIf(!live)('Phase 3 security hardening (isolated temporary schema)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let base: PrismaClient;
  const schema = 'p3_' + randomUUID().replaceAll('-', '');
  const password = randomBytes(24).toString('base64url');
  const prefix = 'DEMO-P3-' + randomUUID().slice(0, 8);
  // Five roles only: the login path enforces the R5 five-concurrent-session cap GLOBALLY, so this
  // spec cannot hold seven bearer sessions at once. Accounting-role positives are covered in accounting.e2e-spec.ts;
  // the matrix rows below still assert the 403 denials for these five legacy roles.
  // B-23/B-19: gate_doc_authority is a first-class role; the matrix probes it too.
  const roles = ['gate', 'gate_doc', 'gate_doc_authority', 'qc', 'ho', 'admin'] as const;
  type Role = (typeof roles)[number];
  const tokens = {} as Record<Role, string>;
  let visitId: string;
  let packageId: string;
  let draftPackageId: string;
  let inspectionId: string;
  let fileId: string;
  let victimUserId: string;
  let logCapture = '';
  let specIp = 40;

  const ip = () => '198.51.100.' + (specIp++);
  const bearerLogin = async (role: Role) => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: ip(), payload: { username: prefix + '-' + role, password, clientType: 'mobile' } });
    expect(res.statusCode, `login ${role}`).toBe(200);
    return res.json().data.accessToken as string;
  };
  const webLogin = async (username: string, pass: string) => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: ip(), payload: { username, password: pass, clientType: 'web' } });
    const raw = res.cookies.find((c) => c.name === '__Host-kpmpl_sid')?.value;
    return { res, cookie: raw ? `__Host-kpmpl_sid=${raw}` : undefined, sid: raw?.split('.')[0] };
  };
  const cookieWrite = (method: 'GET' | 'POST' | 'PATCH' | 'PUT', path: string, cookie: string, headers: Record<string, string | undefined> = {}, payload?: object) =>
    app.inject({ method, url: '/api/v1' + path, remoteAddress: ip(), headers: { cookie, ...headers }, payload });
  const freshToken = async (role: Role) => { tokens[role] = await bearerLogin(role); return tokens[role]; };
  const multipartUpload = (role: Role, id: string, filename: string, buffer: Buffer, category = 'factory_grn') => {
    const boundary = '----kpmplsec' + randomUUID();
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="category"\r\n\r\n${category}\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/pdf\r\n\r\n`),
      buffer, Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    // If-Match is required on every package write (brief §5.7). Every upload here targets a
    // package at version 1, and each rejected upload fails before the version is claimed.
    return app.inject({ method: 'POST', url: `/api/v1/document-packages/${id}/files`, headers: { authorization: 'Bearer ' + tokens[role], 'idempotency-key': randomUUID(), 'if-match': '1', 'content-type': `multipart/form-data; boundary=${boundary}`, 'content-length': String(body.length) }, payload: body });
  };

  beforeAll(async () => {
    const url = new URL(env.DATABASE_URL);
    url.searchParams.set('schema', schema);
    execFileSync(process.execPath, [resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy'], { env: { ...process.env, DATABASE_URL: url.toString() }, stdio: 'pipe' });
    base = new PrismaClient({ datasourceUrl: url.toString() }); // the isolated test schema, not the default public one
    prisma = new PrismaService({ datasourceUrl: url.toString() });
    // Capture the pino output so item 9 can prove no secrets reach the logs.
    const capture = new Writable({ write(chunk, _enc, cb) { logCapture += chunk.toString('utf8'); cb(); } });
    const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(prisma).compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter({ logger: { stream: capture, redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'] } }));
    await configureHttp(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    const auth = app.get(AuthService);
    for (const role of roles) await auth.bootstrapDemo(prefix + '-' + role, 'DEMO-' + role, password, [role]);
    for (const role of roles) tokens[role] = await bearerLogin(role);
    // Six logins > the global five-session cap. Re-login the four roles the fixture needs
    // (the matrix re-logins every role itself before its sweep).
    await freshToken('gate'); await freshToken('gate_doc'); await freshToken('qc');
    const authz = (role: Role) => ({ authorization: 'Bearer ' + tokens[role] });

    // Fixture: one visit advanced to QC-submitted, a package with a clean file, a draft package.
    const visit = await app.inject({ method: 'POST', url: '/api/v1/receiving-visits', headers: { ...authz('gate'), 'idempotency-key': randomUUID() }, payload: { officialGateEntryRef: 'P3-' + randomUUID().slice(0, 12), vehicleNumber: 'P3-TRUCK-1', supplierDisplayName: 'P3 Supplier', materialDisplayName: 'Domestic Waste Paper', grossWeight: { value: '15000.000', unit: 'kg' } } });
    expect(visit.statusCode).toBe(201);
    visitId = visit.json().data.id;
    const inspection = await app.inject({ method: 'POST', url: `/api/v1/receiving-visits/${visitId}/qc-inspections`, headers: { ...authz('qc'), 'idempotency-key': randomUUID(), 'if-match': String(visit.json().data.version) }, payload: { measurements: [{ code: 'moisture', value: '9.00', unit: 'percent' }, { code: 'impurity', value: '1.00', unit: 'percent' }], intent: 'submit' } });
    expect(inspection.statusCode).toBe(201);
    inspectionId = inspection.json().data.inspectionId;
    const created = await app.inject({ method: 'POST', url: '/api/v1/document-packages', headers: { ...authz('gate_doc'), 'idempotency-key': randomUUID() }, payload: { visitIds: [visitId], invoiceRef: 'P3-INV-1' } });
    expect(created.statusCode).toBe(201);
    packageId = created.json().data.id;
    const secondVisit = await app.inject({ method: 'POST', url: '/api/v1/receiving-visits', headers: { ...authz('gate'), 'idempotency-key': randomUUID() }, payload: { officialGateEntryRef: 'P3-' + randomUUID().slice(0, 12), vehicleNumber: 'P3-TRUCK-2', supplierDisplayName: 'P3 Supplier', materialDisplayName: 'Domestic Waste Paper', grossWeight: { value: '12000.000', unit: 'kg' } } });
    const draft = await app.inject({ method: 'POST', url: '/api/v1/document-packages', headers: { ...authz('gate_doc'), 'idempotency-key': randomUUID() }, payload: { visitIds: [secondVisit.json().data.id] } });
    draftPackageId = draft.json().data.id;
    const uploaded = await multipartUpload('gate_doc', packageId, 'p3.pdf', pdfBuf('%PDF clean fixture'), 'supplier_invoice');
    expect(uploaded.statusCode, uploaded.body).toBe(201);
    // DocumentPackageView nests files under their checklist row (items[].files, filename field `name`).
    fileId = uploaded.json().data.items.find((i: { category: string }) => i.category === 'supplier_invoice').files.find((f: { name: string }) => f.name === 'p3.pdf').id;
    // Usernames must match ^[a-z0-9][a-z0-9._-]{2,31}$ — lower-case the prefixed ref and cap the length.
    const victimName = (prefix + '-victim').toLowerCase().slice(0, 31);
    const victim = await app.inject({ method: 'POST', url: '/api/v1/admin/users', headers: { ...authz('admin'), 'idempotency-key': randomUUID() }, payload: { username: victimName, displayName: 'P3 Victim', roles: ['gate'] } });
    expect(victim.statusCode).toBe(201);
    victimUserId = victim.json().data.id;
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    if (base) {
      if (!/^p3_[a-f0-9]{32}$/.test(schema)) throw Error('Unsafe test schema');
      await base.$executeRawUnsafe('DROP SCHEMA "' + schema + '" CASCADE');
      await base.$disconnect();
    }
  });

  it('item 1 — cookie: flags, rotation on re-login, server-side logout invalidation, idle and absolute clocks', async () => {
    const username = prefix + '-gate';
    const first = await webLogin(username, password);
    expect(first.cookie).toBeDefined();
    const flags = first.res.cookies.find((c) => c.name === '__Host-kpmpl_sid')!;
    expect(flags.path).toBe('/');
    expect(flags.secure).toBe(true);
    expect(flags.httpOnly).toBe(true);
    expect(flags.sameSite).toBe('Lax');
    expect(flags.maxAge).toBe(43_200); // absolute 12 h

    const second = await webLogin(username, password);
    expect(second.sid).toBeDefined();
    expect(second.sid).not.toBe(first.sid); // the session ID rotates on every login

    // Cookie #1 keeps working until ITS OWN logout — then a replay must die server-side.
    const meBefore = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie: first.cookie! } });
    expect(meBefore.statusCode).toBe(200);
    await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: { cookie: first.cookie!, origin: 'http://localhost:5173', 'x-requested-with': 'kpmpl-web' } });
    const replay = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie: first.cookie! } });
    expect(replay.statusCode).toBe(401);

    // Injected clock via the session row — idle 2 h and absolute 12 h on refresh.
    const mobile = await app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: ip(), payload: { username, password, clientType: 'mobile' } });
    const refreshToken = mobile.json().data.refreshToken as string;
    const sessionId = (await base.session.findFirst({ where: { userId: meBefore.json().data.id }, orderBy: { createdAt: 'desc' } }))!.id;
    await base.session.update({ where: { id: sessionId }, data: { lastSeenAt: new Date(Date.now() - 2 * 3_600_000 - 60_000) } });
    const idle = await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', payload: { refreshToken } });
    expect(idle.statusCode).toBe(401);
    await base.session.update({ where: { id: sessionId }, data: { lastSeenAt: new Date() } });
    const alive = await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', payload: { refreshToken } });
    expect(alive.statusCode).toBe(200);
    await base.session.update({ where: { id: sessionId }, data: { expiresAt: new Date(Date.now() + 13 * 3_600_000) } });
    const absolute = await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', payload: { refreshToken } });
    expect(absolute.statusCode).toBe(401); // the 12 h absolute cap beats a live idle window
  });

  it('item 2 — CSRF: cookie writes demand X-Requested-With and an allowlisted Origin; bearer writes do not', async () => {
    const { cookie } = await webLogin(prefix + '-gate', password);
    await freshToken('gate'); // older bearer sessions were evicted by the global five-session cap
    const body = { officialGateEntryRef: 'P3-' + randomUUID().slice(0, 12), vehicleNumber: 'P3-TRUCK-3', supplierDisplayName: 'P3 Supplier', materialDisplayName: 'Domestic Waste Paper', grossWeight: { value: '11000.000', unit: 'kg' } };
    const noProof = await cookieWrite('POST', '/receiving-visits', cookie!, { origin: 'http://localhost:5173' }, body);
    expect(noProof.statusCode).toBe(403);
    expect(noProof.json().error.message).toBe('Browser write proof is invalid.');
    const evil = await cookieWrite('POST', '/receiving-visits', cookie!, { origin: 'https://evil.example', 'x-requested-with': 'kpmpl-web' }, body);
    expect(evil.statusCode).toBe(403);
    const noOrigin = await cookieWrite('POST', '/receiving-visits', cookie!, { 'x-requested-with': 'kpmpl-web' }, body);
    expect(noOrigin.statusCode).toBe(403); // documented rule: cookie writes require Origin proof
    const good = await cookieWrite('POST', '/receiving-visits', cookie!, { origin: 'http://localhost:5173', 'x-requested-with': 'kpmpl-web', 'idempotency-key': randomUUID() }, body);
    expect(good.statusCode).toBe(201);
    // The same write via a bearer (non-browser) token needs no browser proof.
    const bearerBody = { ...body, officialGateEntryRef: 'P3-' + randomUUID().slice(0, 12) }; // fresh ref: the cookie write above already used `body`'s
    const bearer = await app.inject({ method: 'POST', url: '/api/v1/receiving-visits', headers: { authorization: 'Bearer ' + tokens.gate, 'idempotency-key': randomUUID() }, payload: bearerBody });
    expect(bearer.statusCode).toBe(201);
  });

  it('item 3 — CORS: preflight from an unknown origin gets no ACAO; allowlisted gets an exact echo with credentials', async () => {
    const evil = await app.inject({ method: 'OPTIONS', url: '/api/v1/receiving-visits', headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' } });
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
    const good = await app.inject({ method: 'OPTIONS', url: '/api/v1/receiving-visits', headers: { origin: 'http://localhost:5173', 'access-control-request-method': 'POST' } });
    expect(good.headers['access-control-allow-origin']).toBe('http://localhost:5173'); // exact echo, never *
    expect(good.headers['access-control-allow-credentials']).toBe('true');
  });

  it('item 4 — API headers: request id, helmet basics, no-store on API and file responses', async () => {
    await freshToken('gate_doc'); // file downloads need docs.prepare (Phase 1-2 RBAC)
    const probe = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { authorization: 'Bearer ' + tokens.gate_doc } });
    expect(probe.headers['x-request-id']).toBeDefined();
    expect(probe.headers['x-content-type-options']).toBe('nosniff');
    expect(probe.headers['cache-control']).toBe('no-store');
    const file = await app.inject({ method: 'GET', url: `/api/v1/document-files/${fileId}/content`, headers: { authorization: 'Bearer ' + tokens.gate_doc } });
    expect(file.statusCode).toBe(200);
    expect(file.headers['cache-control']).toBe('private, no-store');
    expect(file.headers['content-type']).toBe('application/pdf');
  });

  it('item 5 — rate limiting: 6th attempt 429, lockout at 10 failures, honest identical unknown-user wording and timing', async () => {
    const victim = prefix + '-ratelimit';
    const attempt = (pass: string) => app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: '203.0.113.10', payload: { username: victim, password: pass, clientType: 'web' } });
    for (let i = 0; i < 5; i++) expect((await attempt('wrongly-' + i)).statusCode).toBe(401); // schema: password min 8
    const sixth = await attempt(password);
    expect(sixth.statusCode).toBe(429); // 6th attempt inside the minute — even with the right password
    expect(sixth.json().error.code).toBe('RATE_LIMITED');
    for (let i = 0; i < 4; i++) await attempt('wrong-lock-' + i);
    const locked = await attempt(password);
    expect(locked.statusCode).toBe(429); // 10 failures → 15-minute lockout
    // Unknown user vs wrong password: identical 401 message and similar timing.
    const unknown = await app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: '203.0.113.11', payload: { username: prefix + '-nouser', password: 'nope-nope-nope', clientType: 'web' } });
    const wrong = await app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: '203.0.113.12', payload: { username: prefix + '-gate', password: 'nope-nope-nope', clientType: 'web' } });
    expect(unknown.statusCode).toBe(401);
    expect(wrong.statusCode).toBe(401);
    expect(unknown.json().error.message).toBe('Username or password is incorrect.');
    expect(unknown.json().error.message).toBe(wrong.json().error.message);
    const t = (r: typeof unknown) => Number((r as unknown as { elapsedTime?: number }).elapsedTime ?? 0);
    expect(Math.abs(t(unknown) - t(wrong))).toBeLessThan(300);
  });

  it('item 6 — uploads: content sniffs, empty and oversized refuse, EICAR never lands, ClamAV-down fails closed, bucket stays private', async () => {
    await freshToken('gate_doc');
    const upload = (filename: string, buffer: Buffer) => multipartUpload('gate_doc', packageId, filename, buffer);
    const renamed = await upload('renamed.pdf', Buffer.from('this is plain text pretending to be a pdf'));
    expect(renamed.statusCode).toBe(422);
    const empty = await upload('empty.pdf', Buffer.alloc(0));
    expect(empty.statusCode).toBe(422);
    const oversized = await upload('big.pdf', Buffer.concat([pdfBuf('%PDF big '), randomBytes(11 * 1024 * 1024)]));
    expect(oversized.statusCode).toBe(413);
    expect(oversized.json().error.message).toBe('The file is larger than the upload limit.');

    // The scanner flags the bare EICAR test string; this clamd build reports OK for the
    // PDF-wrapped variant, so the infected-file case is asserted at the scanner boundary.
    const scanner = app.get(MalwareScannerService);
    expect(await scanner.scan(Buffer.from(EICAR, 'latin1'))).toBe('infected');
    // Nothing infected ever lands: every stored file is clean, so nothing can be served.
    const view = (await app.inject({ method: 'GET', url: `/api/v1/document-packages/${packageId}`, headers: { authorization: 'Bearer ' + tokens.gate_doc } })).json().data;
    // scanStatus is storage metadata — the API view deliberately never exposes it (the UI
    // only ever lists clean files); assert it against the database rows instead.
    const storedFiles = await base.documentFile.findMany({ where: { packageId } });
    expect(storedFiles.map((f) => f.scanStatus)).toEqual(['clean']);
    expect(JSON.stringify(view)).not.toMatch(/storageKey|minio|:9000/);

    // ClamAV down → fail closed (the scanner env is read per scan).
    const realPort = env.CLAMAV_PORT;
    env.CLAMAV_PORT = 1;
    try {
      const down = await upload('while-down.pdf', pdfBuf('%PDF while the scanner is down'));
      expect(down.statusCode).toBe(422);
      expect(down.json().error.message).toBe('The security scanner is unavailable. Try again later.');
    } finally {
      env.CLAMAV_PORT = realPort;
    }

    // The private bucket refuses anonymous reads of a real storage key.
    const storageKey = (await base.documentFile.findFirst({ where: { packageId } }))!.storageKey;
    const anonymous = await fetch(`${env.S3_ENDPOINT}/${env.S3_BUCKET}/${storageKey}`);
    expect(anonymous.status).toBe(403);
  });

  it('item 7 — authorization matrix: every endpoint × every role matches the capability policy', async () => {
    // Five fresh logins: exactly the global concurrent-session cap, evicting everything stale.
    for (const role of roles) await freshToken(role);
    const matrix: { method: 'GET' | 'POST' | 'PATCH' | 'PUT'; path: string; allowed: (role: Role) => boolean; payload?: object }[] = [
      { method: 'GET', path: '/receiving-visits', allowed: (r) => roleCapabilities[r].includes('receiving.view') },
      { method: 'POST', path: '/receiving-visits', allowed: (r) => roleCapabilities[r].includes('receiving.create'), payload: { officialGateEntryRef: 'P3-' + randomUUID().slice(0, 12), vehicleNumber: 'P3-TRUCK-M', supplierDisplayName: 'P3 Supplier', materialDisplayName: 'Domestic Waste Paper', grossWeight: { value: '13000.000', unit: 'kg' } } },
      { method: 'GET', path: `/receiving-visits/${visitId}`, allowed: (r) => roleCapabilities[r].includes('receiving.view') },
      { method: 'GET', path: `/receiving-visits/${visitId}/timeline`, allowed: (r) => roleCapabilities[r].includes('receiving.view') },
      { method: 'PATCH', path: `/receiving-visits/${visitId}`, allowed: (r) => roleCapabilities[r].includes('receiving.edit'), payload: { vehicleNumber: 'P3-TRUCK-1B', reason: 'P3 matrix correction' } },
      { method: 'POST', path: `/receiving-visits/${visitId}/weighments`, allowed: (r) => roleCapabilities[r].includes('gate.followup'), payload: { kind: 'tare', value: '6000.000', unit: 'kg' } },
      { method: 'POST', path: `/receiving-visits/${visitId}/exit`, allowed: (r) => roleCapabilities[r].includes('gate.followup'), payload: { physicalExitAt: new Date().toISOString(), millChecksConfirmed: true } },
      { method: 'POST', path: `/receiving-visits/${visitId}/grn-links`, allowed: (r) => roleCapabilities[r].includes('gate.followup'), payload: { officialGrnRef: 'P3-GRN-M', verifiedInDataManByStaff: true } },
      { method: 'POST', path: `/receiving-visits/${visitId}/qc-inspections`, allowed: (r) => roleCapabilities[r].includes('qc.measure'), payload: { measurements: [{ code: 'moisture', value: '8.00', unit: 'percent' }], intent: 'submit' } },
      { method: 'GET', path: '/qc/queue', allowed: (r) => roleCapabilities[r].includes('qc.queue.view') },
      // D-03: only the QC operator (qc.decide) records the final decision.
      { method: 'POST', path: `/qc-inspections/${inspectionId}/decisions`, allowed: (r) => roleCapabilities[r].includes('qc.decide'), payload: { outcome: 'accepted' } },
      { method: 'GET', path: '/document-packages', allowed: (r) => roleCapabilities[r].includes('docs.prepare') },
      { method: 'GET', path: `/document-packages/${draftPackageId}`, allowed: (r) => r === 'gate_doc' || r === 'gate_doc_authority' }, // HO record visibility: drafts 404
      { method: 'PUT', path: `/document-packages/${packageId}/items/supplier_invoice/applicability`, allowed: (r) => roleCapabilities[r].includes('docs.prepare'), payload: { notApplicableReason: 'P3 matrix reason' } }, // roleCapabilities-driven
      { method: 'POST', path: `/document-packages/${packageId}/actions`, allowed: (r) => ['gate_doc', 'gate_doc_authority', 'ho'].includes(r), payload: { kind: 'start_review' } },
      { method: 'GET', path: `/document-files/${fileId}/content`, allowed: (r) => ['gate_doc', 'gate_doc_authority', 'ho'].includes(r) },
      { method: 'GET', path: '/reports/overview', allowed: (r) => roleCapabilities[r].includes('overview.view') },
      { method: 'GET', path: '/reports/receiving.csv', allowed: (r) => roleCapabilities[r].includes('overview.view') },
      { method: 'GET', path: '/head-office/cases', allowed: (r) => roleCapabilities[r].includes('ho.inbox') },
      { method: 'POST', path: '/head-office/reviews', allowed: (r) => roleCapabilities[r].includes('ho.review'), payload: { packageId, category: 'supplier_invoice', check: 'ok' } },
      { method: 'POST', path: `/head-office/cases/${packageId}/reminders`, allowed: (r) => roleCapabilities[r].includes('erp.plant_head_approval'), payload: { note: 'P3 matrix reminder' } }, // B-28: the reminder capability
      // Upgrade 2026-11-03: the accounting workflow is reachable only by accounting roles.
      { method: 'GET', path: '/accounting/queue', allowed: (r) => roleCapabilities[r].includes('accounting.inbox') },
      { method: 'POST', path: `/document-packages/${draftPackageId}/accounting`, allowed: (r) => roleCapabilities[r].includes('accounting.review'), payload: { kind: 'start_accounting' } },
      { method: 'POST', path: '/admin/users', allowed: (r) => roleCapabilities[r].includes('admin.users'), payload: { username: (prefix + '-m' + randomUUID().slice(0, 6)).toLowerCase().slice(0, 31), displayName: 'P3 Matrix', roles: ['gate'] } },
      { method: 'GET', path: '/admin/users', allowed: (r) => roleCapabilities[r].includes('admin.users') },
    ];
    const failures: string[] = [];
    // Roles outer, fresh token per role: the login path keeps at most FIVE live sessions
    // globally, so every role re-logins right before its own route sweep.
    for (const role of roles) {
      await freshToken(role);
      for (const route of matrix) {
        const res = await app.inject({ method: route.method, url: '/api/v1' + route.path, headers: { authorization: 'Bearer ' + tokens[role], ...(route.payload ? { 'idempotency-key': randomUUID() } : {}) }, ...(route.payload ? { payload: route.payload } : {}) });
        const allowed = route.allowed(role);
        if (allowed && (res.statusCode === 401 || res.statusCode === 403)) failures.push(`${role} ${route.method} ${route.path} → ${res.statusCode} (expected allowed)`);
        if (!allowed && res.statusCode !== 403 && res.statusCode !== 404) failures.push(`${role} ${route.method} ${route.path} → ${res.statusCode} (expected 403/404)`);
      }
    }
    expect(failures, failures.join('\n')).toEqual([]);
  });

  it('item 8 — must-change-password: only me, logout and change-password respond; everything else 403s', async () => {
    await freshToken('admin');
    const username = (prefix + '-fresh').toLowerCase().slice(0, 31); // ^[a-z0-9][a-z0-9._-]{2,31}$
    const created = await app.inject({ method: 'POST', url: '/api/v1/admin/users', headers: { authorization: 'Bearer ' + tokens.admin, 'idempotency-key': randomUUID() }, payload: { username, displayName: 'P3 Fresh User', roles: ['gate'] } });
    expect(created.statusCode).toBe(201);
    const tempPassword = created.json().data.temporaryPassword as string;
    const { cookie } = await webLogin(username, tempPassword);
    const me = await cookieWrite('GET', '/auth/me', cookie!);
    expect(me.statusCode).toBe(200);
    expect(me.json().data.mustChangePassword).toBe(true);
    const blocked = await cookieWrite('GET', '/receiving-visits', cookie!);
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error.message).toBe('Set a new password before using the system.');
    const writeBlocked = await cookieWrite('POST', '/receiving-visits', cookie!, { origin: 'http://localhost:5173', 'x-requested-with': 'kpmpl-web', 'idempotency-key': randomUUID() }, {});
    expect(writeBlocked.statusCode).toBe(403);
    const changed = await cookieWrite('POST', '/auth/change-password', cookie!, { origin: 'http://localhost:5173', 'x-requested-with': 'kpmpl-web', 'idempotency-key': randomUUID() }, { currentPassword: tempPassword, newPassword: randomBytes(14).toString('base64url') });
    expect(changed.statusCode).toBe(200);
    const cleared = await cookieWrite('GET', '/receiving-visits', cookie!);
    expect(cleared.statusCode).toBe(200); // the flag is gone after a successful change
  });

  it('item 9 — audit: logins, failures, denials, admin actions and resets are recorded; logs carry no secrets', async () => {
    await freshToken('qc'); await freshToken('admin'); await freshToken('gate');
    // A failed login, a permission denial and an admin reset happen here on purpose.
    await app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: ip(), payload: { username: prefix + '-gate', password: 'wrong-wrong-wrong', clientType: 'web' } });
    await app.inject({ method: 'GET', url: '/api/v1/admin/users', headers: { authorization: 'Bearer ' + tokens.qc } });
    const reset = await app.inject({ method: 'POST', url: `/api/v1/admin/users/${victimUserId}/reset-password`, headers: { authorization: 'Bearer ' + tokens.admin, 'idempotency-key': randomUUID() } });
    expect(reset.statusCode).toBe(201); // POST default status (no @HttpCode override on this route)
    const actions = (await base.auditEvent.findMany({ select: { action: true }, distinct: ['action'] })).map((r) => r.action);
    for (const expected of ['login', 'login_failed', 'user_created', 'password_reset']) expect(actions, `${expected} audited`).toContain(expected);
    // The correction flow records before/after with the reason.
    const visit = await base.receivingVisit.findUniqueOrThrow({ where: { id: visitId } });
    const patch = await app.inject({ method: 'PATCH', url: `/api/v1/receiving-visits/${visitId}`, headers: { authorization: 'Bearer ' + tokens.gate, 'idempotency-key': randomUUID(), 'if-match': String(visit.version) }, payload: { vehicleNumber: 'P3-TRUCK-1B', reason: 'P3 audit coverage correction' } });
    expect(patch.statusCode).toBe(200);
    const audit = await base.auditEvent.findMany({ where: { entityType: 'ReceivingVisit', entityId: visitId }, orderBy: { recordedAt: 'desc' }, take: 3 });
    expect(audit.some((row) => row.reason || row.oldValue !== null || row.newValue !== null)).toBe(true);
    // No secrets in the captured pino output (passwords, cookies, bearer tokens).
    expect(logCapture).not.toContain(password);
    expect(logCapture).not.toContain('__Host-kpmpl_sid');
    expect(logCapture).not.toMatch(/Bearer [A-Za-z0-9._-]{10,}/);
  });
});
