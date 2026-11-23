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

/**
 * Upgrade 2026-11-03 — HO → Accountant → Head Accountant → Bill Posted.
 * Covers: capability denials, the full state machine, duplicate-posting guard,
 * authorized corrections with before/after + reason, audit/history wording,
 * HO's retained ERP-confirm rights after handoff, and retry safety.
 */
describe.skipIf(process.env.REQUIRE_LIVE_DEPENDENCIES !== 'true')('accounting workflow: verified → with_accounting → with_head_accountant → accounting_approved → bill_posted', () => {
  let app: NestFastifyApplication, prisma: PrismaService, base: PrismaClient;
  const schema = 'ac_' + randomUUID().replaceAll('-', ''), password = randomBytes(24).toString('base64url'), prefix = 'DEMO-' + randomUUID();
  let gate: string, docs: string, ho: string, accountant: string;
  const call = (method: 'GET'|'POST'|'PUT', path: string, token: string, payload?: object, version?: number, key = randomUUID()) =>
    app.inject({ method, url: '/api/v1' + path, headers: { authorization: 'Bearer ' + token, 'idempotency-key': key, ...(version ? { 'if-match': String(version) } : {}) }, ...(payload ? { payload } : {}) });
  const act = (pkgId: string, token: string, payload: object, version: number, key = randomUUID()) =>
    call('POST', `/document-packages/${pkgId}/accounting`, token, payload, version, key);

  beforeAll(async () => {
    const url = new URL(env.DATABASE_URL); url.searchParams.set('schema', schema); execFileSync(process.execPath, [resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy'], { env: { ...process.env, DATABASE_URL: url.toString() }, stdio: 'pipe' });
    base = new PrismaClient(); prisma = new PrismaService({ datasourceUrl: url.toString() });
    const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(prisma).compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter()); await configureHttp(app); await app.init(); await app.getHttpAdapter().getInstance().ready();
    const auth = app.get(AuthService);
    const tokens: string[] = [];
    for (const role of ['gate', 'gate_doc', 'ho', 'accountant'] as const) {
      const code = prefix + '-' + role; await auth.bootstrapDemo(code, 'DEMO-' + role, password, [role]);
      const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: code, password, clientType: 'mobile' } });
      tokens.push(login.json().data.accessToken);
    }
    [gate, docs, ho, accountant] = tokens as [string, string, string, string];
  }, 30_000);
  afterAll(async () => { await app?.close(); if (base) { if (!/^ac_[a-f0-9]{32}$/.test(schema)) throw Error('Unsafe test schema'); await base.$executeRawUnsafe('DROP SCHEMA "' + schema + '" CASCADE'); await base.$disconnect(); } });

  it('walks verified → bill posted with strict permissions, corrections and an intact audit trail', async () => {
    // --- Gate + HO bring a package to `verified`, with one real PDF attached ---
    const visitResponse = await call('POST', '/receiving-visits', gate, { officialGateEntryRef: 'DEMO-' + randomUUID().slice(0, 20), vehicleNumber: 'DEMO-TRUCK-AC', supplierDisplayName: 'DEMO-Supplier', materialDisplayName: 'DEMO-Waste Paper', grossWeight: { value: '15000.000', unit: 'kg' } });
    expect(visitResponse.statusCode).toBe(201); const visitId = visitResponse.json().data.id;
    const created = await call('POST', '/document-packages', docs, { visitIds: [visitId], invoiceRef: '0008-HO' }); // Phase 1-2 RBAC: the Document Authority prepares packages
    expect(created.statusCode, created.body).toBe(201);
    let pkg = created.json().data;
    const boundary = '----kpmplac' + randomUUID(); const pdf = Buffer.from('%PDF-1.4 DEMO accounting fixture');
    const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="category"\r\n\r\nsupplier_invoice\r\n`), Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="DEMO-INV.pdf"\r\nContent-Type: application/pdf\r\n\r\n`), pdf, Buffer.from(`\r\n--${boundary}--\r\n`)]);
    const uploaded = await app.inject({ method: 'POST', url: `/api/v1/document-packages/${pkg.id}/files`, headers: { authorization: 'Bearer ' + docs, 'idempotency-key': randomUUID(), 'if-match': String(pkg.version), 'content-type': `multipart/form-data; boundary=${boundary}`, 'content-length': String(body.length) }, payload: body });
    expect(uploaded.statusCode, uploaded.body).toBe(201);
    pkg = uploaded.json().data; // the upload claimed version 1 → 2; keep the fresh row.
    for (const category of categories.slice(1)) { const r = await call('PUT', `/document-packages/${pkg.id}/items/${category}/applicability`, docs, { notApplicableReason: 'DEMO not applicable' }, pkg.version); pkg = r.json().data; }
    const ready = await call('POST', `/document-packages/${pkg.id}/actions`, docs, { kind: 'mark_ready' }, pkg.version); expect(ready.statusCode, ready.body).toBe(200); pkg = ready.json().data;
    const sent = await call('POST', `/document-packages/${pkg.id}/actions`, docs, { kind: 'submit_to_ho', confirmComplete: true }, pkg.version); expect(sent.statusCode, sent.body).toBe(200); pkg = sent.json().data;
    const reviewing = await call('POST', `/document-packages/${pkg.id}/actions`, ho, { kind: 'start_review' }, pkg.version); expect(reviewing.statusCode, reviewing.body).toBe(200); pkg = reviewing.json().data;
    const checked = await call('POST', '/head-office/reviews', ho, { packageId: pkg.id, category: 'supplier_invoice', check: 'ok' }, pkg.version); expect(checked.statusCode, checked.body).toBe(200); pkg = checked.json().data;
    const verified = await call('POST', `/document-packages/${pkg.id}/actions`, ho, { kind: 'verify' }, pkg.version); expect(verified.statusCode, verified.body).toBe(200); pkg = verified.json().data;
    expect(pkg.status).toBe('verified');

    // --- Consolidated least privilege: only Accountant handles internal accounting ---
    expect((await act(pkg.id, gate, { kind: 'start_accounting' }, pkg.version)).statusCode).toBe(403);
    expect((await act(pkg.id, docs, { kind: 'start_accounting' }, pkg.version)).statusCode).toBe(403);
    expect((await act(pkg.id, ho, { kind: 'start_accounting' }, pkg.version)).statusCode).toBe(403);
    const queue = await call('GET', '/accounting/queue', accountant);
    expect(queue.statusCode).toBe(200);
    expect(queue.json().data.some((item: { id: string }) => item.id === pkg.id)).toBe(true);

    let result = await act(pkg.id, accountant, { kind: 'start_accounting' }, pkg.version);
    expect(result.statusCode, result.body).toBe(200); pkg = result.json().data;
    expect(pkg.status).toBe('with_accounting');
    expect(pkg.accounting.stage).toBe('with_accountant');
    expect((await act(pkg.id, accountant, { kind: 'start_accounting' }, pkg.version)).statusCode).toBe(422);
    // Approval fails until the three independent accounting checks are recorded.
    expect((await act(pkg.id, accountant, { kind: 'approve_accounting' }, pkg.version)).statusCode).toBe(422);

    result = await act(pkg.id, accountant, { kind: 'correct_accounting', field: 'accountingRef', value: '0009-AC', reason: 'DEMO typed the bill reference' }, pkg.version);
    expect(result.statusCode, result.body).toBe(200); pkg = result.json().data;
    expect(pkg.accounting.corrections[0]).toMatchObject({ field: 'accountingRef', oldValue: null, newValue: '0009-AC' });
    result = await act(pkg.id, accountant, { kind: 'record_amounts', invoiceAmount: '15250.50', gstAmount: '2745.09' }, pkg.version);
    expect(result.statusCode).toBe(200); pkg = result.json().data;
    expect(pkg.accounting.invoiceAmount).toBe('15250.50');
    const checks = await call('POST', '/accounting/cases/' + pkg.id + '/checks', accountant, {
      checks: [{ type: 'bill_passed', status: 'ok' }, { type: 'gst_checked', status: 'ok' }, { type: 'tds_checked', status: 'ok' }],
    }, pkg.version);
    expect(checks.statusCode, checks.body).toBe(200); pkg = checks.json().data;

    const approveKey = randomUUID(); const approvedVersion = pkg.version;
    result = await act(pkg.id, accountant, { kind: 'approve_accounting', note: 'DEMO approved for posting' }, approvedVersion, approveKey);
    expect(result.statusCode, result.body).toBe(200); pkg = result.json().data;
    expect(pkg.status).toBe('accounting_approved');
    expect(pkg.accounting.approvedBy).toBe('DEMO-accountant');
    expect((await act(pkg.id, accountant, { kind: 'correct_accounting', field: 'accountingRef', value: '0010-AC', reason: 'Too late' }, pkg.version)).statusCode).toBe(422);

    result = await act(pkg.id, accountant, { kind: 'post_bill', billRef: '00071-HO' }, pkg.version);
    expect(result.statusCode, result.body).toBe(200); pkg = result.json().data;
    expect(pkg.status).toBe('bill_posted');
    expect(pkg.accounting.accountingRef).toBe('00071-HO');
    expect(pkg.accounting.postedBy).toBe('DEMO-accountant');
    expect((await act(pkg.id, accountant, { kind: 'post_bill', billRef: '00071-HO' }, pkg.version)).statusCode).toBe(422);
    const replay = await act(pkg.id, accountant, { kind: 'approve_accounting', note: 'DEMO approved for posting' }, approvedVersion, approveKey);
    expect(replay.statusCode).toBe(200);
    expect(replay.headers['idempotent-replay']).toBe('true');

    const actions = pkg.history.map((h: { action: string }) => h.action);
    for (const word of ['Sent to Accounts', 'Accounting approved', 'Bill posted', 'Accounting correction recorded']) {
      expect(actions).toContain(word);
    }
    expect(pkg.accounting.corrections.length).toBe(1);
    const timeline = (await call('GET', '/receiving-visits/' + visitId + '/timeline', ho)).json().data;
    expect(timeline.some((event: { action: string }) => event.action === 'bill_posted')).toBe(true);

    // --- HO keeps its ERP-confirm duties after the handoff (internal ≠ external) ---
    expect((await call('GET', '/head-office/cases', ho)).json().data.some((item: { id: string }) => item.id === pkg.id)).toBe(true);
    const erpResult = await call('POST', `/head-office/cases/${pkg.id}/erp-milestones`, ho, { type: 'plant_head_grn_approval', action: 'confirm', dataManRef: '0008-HO', verifiedInDataManByStaff: true }, pkg.version);
    expect(erpResult.statusCode).toBe(200);
    expect(erpResult.json().data.erp.find((m: { type: string }) => m.type === 'plant_head_grn_approval').status).toBe('confirmed');

    // --- The Accountant can still read the package and its PDF after posting ---
    expect((await call('GET', `/document-packages/${pkg.id}`, accountant)).statusCode).toBe(200);
    const fileId = pkg.items.flatMap((i: { files: { id: string }[] }) => i.files)[0].id;
    const pdfResponse = await app.inject({ method: 'GET', url: `/api/v1/document-files/${fileId}/content`, headers: { authorization: 'Bearer ' + accountant } });
    expect(pdfResponse.statusCode).toBe(200);
    expect(pdfResponse.headers['content-type']).toContain('application/pdf');
  }, 60_000);
});
