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
import { categories } from '../src/modules/documents/document.schemas';

describe.skipIf(process.env.REQUIRE_LIVE_DEPENDENCIES !== 'true')('Module 2 package → HO → manual ERP workflow', () => {
  let app: NestFastifyApplication, prisma: PrismaService, base: PrismaClient;
  const schema = 'm2_' + randomUUID().replaceAll('-', ''), password = randomBytes(24).toString('base64url'), prefix = 'DEMO-' + randomUUID();
  let gate: string, docs: string, ho: string;
  const call = (method: 'GET'|'POST'|'PUT'|'PATCH', path: string, token: string, payload?: object, version?: number, key = randomUUID()) => app.inject({ method, url: '/api/v1' + path, headers: { authorization: 'Bearer ' + token, 'idempotency-key': key, ...(version ? { 'if-match': String(version) } : {}) }, ...(payload ? { payload } : {}) });
  beforeAll(async () => {
    const url = new URL(env.DATABASE_URL); url.searchParams.set('schema', schema); execFileSync(process.execPath, [resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy'], { env: { ...process.env, DATABASE_URL: url.toString() }, stdio: 'pipe' });
    base = new PrismaClient(); prisma = new PrismaService({ datasourceUrl: url.toString() }); const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(prisma).compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter()); await configureHttp(app); await app.init(); await app.getHttpAdapter().getInstance().ready(); const auth = app.get(AuthService);
    const tokens: string[] = []; for (const role of ['gate', 'gate_doc', 'ho'] as const) { const code = prefix + '-' + role; await auth.bootstrapDemo(code, 'DEMO-' + role, password, [role]); const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: code, password, clientType: 'mobile' } }); tokens.push(login.json().data.accessToken); } [gate, docs, ho] = tokens as [string,string,string];
  }, 30_000);
  afterAll(async () => { await app?.close(); if (base) { if (!/^m2_[a-f0-9]{32}$/.test(schema)) throw Error('Unsafe test schema'); await base.$executeRawUnsafe('DROP SCHEMA "' + schema + '" CASCADE'); await base.$disconnect(); } });
  it('enforces checklist, role handoffs, ordered ERP milestones and retry safety', async () => {
    const visitResponse = await call('POST', '/receiving-visits', gate, { officialGateEntryRef: 'DEMO-' + randomUUID().slice(0, 20), vehicleNumber: 'DEMO-TRUCK', supplierDisplayName: 'DEMO-Supplier', materialDisplayName: 'DEMO-Waste Paper', grossWeight: { value: '15000.000', unit: 'kg' } }); expect(visitResponse.statusCode).toBe(201);
    const createKey = randomUUID(), createBody = { visitIds: [visitResponse.json().data.id], invoiceRef: '0008-HO' }; const created = await call('POST', '/document-packages', gate, createBody, undefined, createKey); expect(created.statusCode).toBe(201); expect((await call('POST', '/document-packages', gate, createBody, undefined, createKey)).headers['idempotent-replay']).toBe('true');
    let pkg = created.json().data; expect((await call('POST', `/document-packages/${pkg.id}/actions`, gate, { kind: 'mark_ready' }, pkg.version)).statusCode).toBe(422);
    for (const category of categories) { const result = await call('PUT', `/document-packages/${pkg.id}/items/${category}/applicability`, gate, { notApplicableReason: 'DEMO not applicable' }, pkg.version); expect(result.statusCode).toBe(200); pkg = result.json().data; }
    let result = await call('POST', `/document-packages/${pkg.id}/actions`, gate, { kind: 'mark_ready' }, pkg.version); expect(result.statusCode).toBe(200); pkg = result.json().data;
    expect((await call('POST', `/document-packages/${pkg.id}/actions`, gate, { kind: 'submit_to_ho', confirmComplete: true }, pkg.version)).statusCode).toBe(403);
    result = await call('POST', `/document-packages/${pkg.id}/actions`, docs, { kind: 'submit_to_ho', confirmComplete: true }, pkg.version); expect(result.statusCode).toBe(200); pkg = result.json().data;
    expect((await call('GET', '/head-office/cases', ho)).json().data.some((item: {id:string}) => item.id === pkg.id)).toBe(true);
    result = await call('POST', `/document-packages/${pkg.id}/actions`, ho, { kind: 'start_review' }, pkg.version); pkg = result.json().data; result = await call('POST', `/document-packages/${pkg.id}/actions`, ho, { kind: 'verify' }, pkg.version); expect(result.statusCode).toBe(200); pkg = result.json().data;
    result = await call('POST', `/head-office/cases/${pkg.id}/reminders`, ho, { note: 'DEMO reminder log only' }, pkg.version); expect(result.statusCode).toBe(200); pkg = result.json().data;
    expect((await call('POST', `/head-office/cases/${pkg.id}/erp-milestones`, ho, { type: 'purchase_voucher', action: 'confirm', dataManRef: '00071-HO', verifiedInDataManByStaff: true }, pkg.version)).statusCode).toBe(422);
    for (const [type, dataManRef] of [['plant_head_grn_approval','0008-HO'], ['purchase_voucher','00071-HO'], ['final_posting',undefined]] as const) { result = await call('POST', `/head-office/cases/${pkg.id}/erp-milestones`, ho, { type, action: 'confirm', ...(dataManRef ? { dataManRef } : {}), verifiedInDataManByStaff: true }, pkg.version); expect(result.statusCode).toBe(200); pkg = result.json().data; }
    expect((await call('POST', `/head-office/cases/${pkg.id}/reminders`, ho, { note: 'DEMO too late' }, pkg.version)).statusCode).toBe(422);
    result = await call('POST', `/head-office/cases/${pkg.id}/erp-milestones`, ho, { type: 'final_posting', action: 'reverse', note: 'DEMO correction', verifiedInDataManByStaff: true }, pkg.version); expect(result.statusCode).toBe(200); expect(result.json().data.erp.find((m: {type:string}) => m.type === 'final_posting').status).toBe('pending');
  }, 30_000);
});
