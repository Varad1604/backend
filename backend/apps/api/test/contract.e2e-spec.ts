import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { PrismaClient } from '@prisma/client';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureHttp } from '../src/http';
import { env } from '../src/config/env';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { AuthService } from '../src/modules/identity-access/auth.service';

/**
 * Cross-cutting contract checks (brief §3): the error envelope on framework-level errors,
 * the CSV column contract, and the OverviewData shape (CONTRACT_DIFF #84, #97, #140).
 */
describe.skipIf(process.env.REQUIRE_LIVE_DEPENDENCIES !== 'true')('API contract conventions (brief §3)', () => {
  let app: NestFastifyApplication, prisma: PrismaService, base: PrismaClient;
  let gate: string, ho: string;
  const schema = 'ct_' + randomUUID().replaceAll('-', '');
  const password = randomBytes(24).toString('base64url');
  const prefix = 'DEMO-' + randomUUID(); let counter = 0;
  const call = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, token?: string, payload?: object, key = randomUUID(), ifMatch?: number) => app.inject({ method, url: '/api/v1' + path,
    remoteAddress: '198.20.0.' + (++counter % 250),
    headers: { ...(token ? { authorization: 'Bearer ' + token } : {}), 'idempotency-key': key, ...(ifMatch ? { 'if-match': String(ifMatch) } : {}) }, ...(payload ? { payload } : {}) });
  const create = async () => {
    const response = await call('POST', '/receiving-visits', gate, { officialGateEntryRef: 'DEMO-' + randomUUID().slice(0, 20), vehicleNumber: 'DEMO-CONTRACT-01', supplierDisplayName: 'Demo Supplier A', materialDisplayName: 'DEMO-Waste Paper', grossWeight: { value: '15000', unit: 'kg' } });
    expect(response.statusCode).toBe(201); return response.json().data;
  };
  beforeAll(async () => {
    const url = new URL(env.DATABASE_URL); url.searchParams.set('schema', schema);
    execFileSync(process.execPath, [resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy'], { env: { ...process.env, DATABASE_URL: url.toString() }, stdio: 'pipe' });
    base = new PrismaClient(); prisma = new PrismaService({ datasourceUrl: url.toString() });
    const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(prisma).compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter({ bodyLimit: 102_400, genReqId: () => randomUUID() })); await configureHttp(app); await app.init(); await app.getHttpAdapter().getInstance().ready();
    const auth = app.get(AuthService); const tokens: string[] = [];
    for (const role of ['gate', 'ho'] as const) {
      const code = prefix + '-' + role;
      await auth.bootstrapDemo(code, 'DEMO-' + role, password, [role]);
      const response = await call('POST', '/auth/login', undefined, { username: code, password, clientType: 'mobile' });
      tokens.push(response.json().data.accessToken);
    }
    [gate, ho] = tokens as [string, string];
  }, 30_000);
  afterAll(async () => {
    await app?.close();
    if (base) { if (!/^ct_[a-f0-9]{32}$/.test(schema)) throw Error('Unsafe test schema'); await base.$executeRawUnsafe('DROP SCHEMA "' + schema + '" CASCADE'); await base.$disconnect(); }
  });
  it('wraps framework-level errors in the brief envelope with proper codes', async () => {
    // Malformed JSON → 400 VALIDATION_FAILED, not SERVER_ERROR with Fastify wording (#97).
    const malformed = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { 'content-type': 'application/json' }, payload: '{bad json', remoteAddress: '198.20.0.250' });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json().error).toMatchObject({ code: 'VALIDATION_FAILED', requestId: expect.any(String) });
    // Body over 100 KiB → 413 VALIDATION_FAILED with the approved wording.
    const big = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { 'content-type': 'application/json' }, payload: 'a'.repeat(150_000), remoteAddress: '198.20.0.250' });
    expect(big.statusCode).toBe(413);
    expect(big.json().error).toMatchObject({ code: 'VALIDATION_FAILED', message: 'The file is larger than the upload limit.', fields: { file: 'The file is larger than the upload limit.' } });
    // Unknown paths keep the NOT_FOUND envelope with the request id.
    const unknown = await call('GET', '/definitely-not-a-route', gate);
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json().error).toMatchObject({ code: 'NOT_FOUND' });
    expect(unknown.headers['x-request-id']).toBe(unknown.json().error.requestId);
  });
  it('emits the receiving CSV with the frontend column contract (D-10 pending)', async () => {
    const visit = await create();
    await call('POST', `/receiving-visits/${visit.id}/weighments`, gate, { kind: 'tare', value: '5500', unit: 'kg' }, randomUUID(), 1);
    const csv = await call('GET', '/reports/receiving.csv', ho);
    expect(csv.statusCode).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.headers['content-disposition']).toContain('attachment');
    const body = csv.body;
    expect(body.charCodeAt(0)).toBe(0xFEFF); // UTF-8 BOM
    const header = body.slice(1).split('\r\n')[0]!;
    expect(header).toBe('Gate Entry No.,Vehicle No.,Supplier,Material,Gross Wt (kg),Tare Wt (kg),Net Wt (kg),QC status,Exit status,Exit time (IST),GRN status,GRN No.,Entry time (IST),Entered by');
    expect(body).toContain(visit.officialGateEntryRef);
    expect(body).toContain('9500.000'); // derived net, display only
    // Formula-injection guard: a leading "=" cell is prefixed with '.
    const hostile = await create();
    await prisma.receivingVisit.update({ where: { id: hostile.id }, data: { officialGateEntryRef: '=DEMO-EVIL' } }).catch(() => undefined);
    const guarded = await call('GET', '/reports/receiving.csv', ho);
    expect(guarded.body).toContain("'=DEMO-EVIL");
  });
  it('computes the OverviewData shape exactly as the frontend reads it', async () => {
    const visit = await create();
    await call('POST', `/receiving-visits/${visit.id}/weighments`, gate, { kind: 'tare', value: '5500', unit: 'kg' }, randomUUID(), 1);
    const overview = await call('GET', '/reports/overview', ho);
    expect(overview.statusCode).toBe(200);
    const data = overview.json().data;
    expect(data).toMatchObject({
      receiving: { total: expect.any(Number), today: expect.any(Number), onPremises: expect.any(Number) },
      qc: { awaitingInspection: expect.any(Number), inProgress: expect.any(Number), returned: expect.any(Number), awaitingReview: expect.any(Number), decided: expect.any(Number) },
      gate: { needsTare: expect.any(Number), readyToExit: expect.any(Number), exitedToday: expect.any(Number), grnPending: expect.any(Number) },
      documents: { draft: expect.any(Number), withHo: expect.any(Number), correctionRequested: expect.any(Number), verified: expect.any(Number) },
      erp: { approvalPending: expect.any(Number), voucherPending: expect.any(Number), postingPending: expect.any(Number), posted: expect.any(Number) },
    });
    expect(data.receiving.total).toBeGreaterThanOrEqual(2);
    expect(data.qc.awaitingInspection).toBeGreaterThanOrEqual(2);
    // The three snapshot lists carry full visit objects with display names.
    expect(data.oldestAwaitingQc[0]).toMatchObject({ createdBy: expect.any(String), qcStatus: 'pending', version: expect.any(Number) });
    expect(Object.keys(data)).toEqual(['generatedAt', 'receiving', 'qc', 'gate', 'documents', 'erp', 'oldestAwaitingQc', 'longestOnPremises', 'grnPendingList']);
    // "Today" counts use the Asia/Kolkata day; generatedAt is ISO UTC with Z (brief §3).
    expect(data.generatedAt).toMatch(/Z$/);
  });
});
