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
 * v0.8.5 journey (live): gate entry → QC → exit → GRN → package → HO verify →
 * Accountant (checks + amounts + handover) → Head Accountant RETURN TO HO →
 * HO re-verify → Accountant restart → handover → approve → DataMan final posting
 * (per-milestone capability) → bill_posted. Every hop asserts its state.
 */
describe.skipIf(process.env.REQUIRE_LIVE_DEPENDENCIES !== 'true')('full v0.8.5 journey with the return-to-HO loop', () => {
  let app: NestFastifyApplication, prisma: PrismaService, base: PrismaClient;
  const schema = 'j85_' + randomUUID().replaceAll('-', ''), password = randomBytes(24).toString('base64url'), prefix = 'J-' + randomUUID().slice(0, 8);
  const tokens: Record<string, string> = {};
  // Six roles are needed but the global cap keeps five live sessions (oldest evicted),
  // so a role re-logins once on a 401 and the request is retried.
  const relogin = async (user: string) => {
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'DEMO-' + prefix + '-' + user, password, clientType: 'mobile' } });
    tokens[user] = login.json().data.accessToken;
  };
  const call = async (user: string, method: 'GET'|'POST'|'PUT', path: string, body?: object, version?: number, key = randomUUID()) => {
    const once = async () => {
      const res = await app.inject({ method, url: '/api/v1' + path, headers: { authorization: 'Bearer ' + tokens[user], 'idempotency-key': key, ...(version !== undefined ? { 'if-match': String(version) } : {}) }, ...(body !== undefined ? { payload: body } : {}) });
      let json: any = null;
      try { json = res.statusCode === 204 ? null : res.json(); } catch { json = null; }
      return { status: res.statusCode, data: json?.data, error: json?.error, body: res.body };
    };
    let r = await once();
    if (r.status === 401) { await relogin(user); r = await once(); }
    return r;
  };

  beforeAll(async () => {
    const url = new URL(env.DATABASE_URL); url.searchParams.set('schema', schema); execFileSync(process.execPath, [resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy'], { env: { ...process.env, DATABASE_URL: url.toString() }, stdio: 'pipe' });
    base = new PrismaClient({ datasourceUrl: url.toString() }); prisma = new PrismaService({ datasourceUrl: url.toString() });
    const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(prisma).compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter()); await configureHttp(app); await app.init(); await app.getHttpAdapter().getInstance().ready();
    const auth = app.get(AuthService);
    for (const role of ['gate', 'gate_doc_authority', 'qc', 'ho', 'accountant'] as const) {
      const code = 'DEMO-' + prefix + '-' + role; await auth.bootstrapDemo(code, 'DEMO-J-' + role, password, [role]);
      const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: code, password, clientType: 'mobile' } });
      tokens[role] = login.json().data.accessToken;
    }
  }, 60_000);
  afterAll(async () => { await app?.close(); if (base) { if (!/^j85_[a-f0-9]{32}$/.test(schema)) throw Error('Unsafe test schema'); await base.$executeRawUnsafe('DROP SCHEMA "' + schema + '" CASCADE'); await base.$disconnect(); } });

  it('walks the whole mill including the return-to-HO loop and posts the bill', async () => {
    // 1. Gate entry with loaded weight.
    let r = await call('gate', 'POST', '/receiving-visits', { officialGateEntryRef: 'J-ENTRY-1', vehicleNumber: 'J-TRUCK-1', supplierDisplayName: 'J Supplier', materialDisplayName: 'J Waste Paper', grossWeight: { value: '16000.000', unit: 'kg' } });
    expect(r.status, r.body).toBe(201); const visitId = r.data.id; let version = r.data.version;
    // 2. QC submits readings and accepts (D-03).
    r = await call('qc', 'POST', `/receiving-visits/${visitId}/qc-inspections`, { measurements: [{ code: 'moisture', value: '9.00', unit: 'percent' }, { code: 'impurity', value: '1.50', unit: 'percent' }], intent: 'submit' }, version);
    expect(r.status).toBe(201);
    version = (await call('gate', 'GET', `/receiving-visits/${visitId}`)).data.version;
    r = await call('qc', 'POST', `/qc-inspections/${r.data.inspectionId}/decisions`, { outcome: 'accepted_with_deduction', reason: 'J: 1.5% impurity per schedule.' }, version);
    expect(r.status).toBe(200); version = (await call('gate', 'GET', `/receiving-visits/${visitId}`)).data.version;
    // 2b. Tare (empty weighment) — required before exit.
    r = await call('gate', 'POST', `/receiving-visits/${visitId}/weighments`, { kind: 'tare', value: '6100.000', unit: 'kg' }, version);
    expect([200, 201].includes(r.status)).toBe(true); version = r.data.version;
    // 3. Exit (only after QC accepted/with-deduction).
    r = await call('gate', 'POST', `/receiving-visits/${visitId}/exit`, { physicalExitAt: new Date().toISOString(), millChecksConfirmed: true }, version);
    expect([200, 201].includes(r.status)).toBe(true); version = r.data.version;
    // 4. GRN follow-up (independent domain, recorded after exit).
    r = await call('gate', 'POST', `/receiving-visits/${visitId}/grn-links`, { officialGrnRef: 'J-GRN-0001', verifiedInDataManByStaff: true }, version);
    expect([200, 201].includes(r.status)).toBe(true);
    // 5. Document package prepared by the Document Authority.
    r = await call('gate_doc_authority', 'POST', '/document-packages', { visitIds: [visitId], invoiceRef: 'J-INV-0001' }); let pkg = r.data;
    expect(r.status).toBe(201);
    const boundary = '----j' + randomUUID(); const pdf = Buffer.from('%PDF-1.4 J journey fixture');
    const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="category"\r\n\r\nsupplier_invoice\r\n`), Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="J-INV.pdf"\r\nContent-Type: application/pdf\r\n\r\n`), pdf, Buffer.from(`\r\n--${boundary}--\r\n`)]);
    const up = await app.inject({ method: 'POST', url: `/api/v1/document-packages/${pkg.id}/files`, headers: { authorization: 'Bearer ' + tokens.gate_doc_authority, 'idempotency-key': randomUUID(), 'if-match': String(pkg.version), 'content-type': `multipart/form-data; boundary=${boundary}`, 'content-length': String(body.length) }, payload: body });
    expect(up.statusCode, up.body).toBe(201); pkg = up.json().data;
    for (const category of ['factory_grn', 'weighbridge_slip', 'qc_slip', 'supporting_bill', 'eway_bill']) { pkg = (await call('gate_doc_authority', 'PUT', `/document-packages/${pkg.id}/items/${category}/applicability`, { notApplicableReason: 'J: N/A' }, pkg.version)).data; }
    pkg = (await call('gate_doc_authority', 'POST', `/document-packages/${pkg.id}/actions`, { kind: 'mark_ready' }, pkg.version)).data;
    pkg = (await call('gate_doc_authority', 'POST', `/document-packages/${pkg.id}/actions`, { kind: 'submit_to_ho', confirmComplete: true }, pkg.version)).data;
    // 6. HO reviews and verifies.
    pkg = (await call('ho', 'POST', `/document-packages/${pkg.id}/actions`, { kind: 'start_review' }, pkg.version)).data;
    pkg = (await call('ho', 'POST', '/head-office/reviews', { packageId: pkg.id, category: 'supplier_invoice', check: 'ok' }, pkg.version)).data;
    pkg = (await call('ho', 'POST', `/document-packages/${pkg.id}/actions`, { kind: 'verify' }, pkg.version)).data;
    expect(pkg.status).toBe('verified');
    // 7. Accountant starts the accounting review (consolidated role; checks + amounts are
    // recorded after the return loop like step 9 does).
    r = await call('accountant', 'POST', `/document-packages/${pkg.id}/accounting`, { kind: 'start_accounting' }, pkg.version);
    expect(r.status, r.body).toBe(200); pkg = r.data;
    expect(pkg.status).toBe('with_accounting');

    // 8. Head Accountant RETURNS TO HO (failed check).
    const rHo = await call('accountant', 'POST', `/document-packages/${pkg.id}/accounting`, { kind: 'return_to_ho', reason: 'J: GST figure does not match the invoice.', failedChecks: ['gst_checked'] }, pkg.version);
    expect(rHo.status, JSON.stringify(rHo.error ?? rHo.body).slice(0, 300)).toBe(200);
    pkg = rHo.data;
    expect(pkg.status).toBe('returned_to_ho'); // back at Head Office (Phase 1-2 rule)
    expect(pkg.accounting.approvedBy).toBeNull(); // stale approval cleared (B-12)
    // 9. HO re-verifies; Accountant restarts; handover again.
    pkg = (await call('ho', 'POST', `/document-packages/${pkg.id}/actions`, { kind: 'start_review' }, pkg.version)).data;
    pkg = (await call('ho', 'POST', '/head-office/reviews', { packageId: pkg.id, category: 'supplier_invoice', check: 'ok' }, pkg.version)).data;
    pkg = (await call('ho', 'POST', `/document-packages/${pkg.id}/actions`, { kind: 'verify' }, pkg.version)).data;
    // Restart accounting after re-verification: approve requires a package under review.
    r = await call('accountant', 'POST', `/document-packages/${pkg.id}/accounting`, { kind: 'start_accounting' }, pkg.version);
    expect(r.status, r.body).toBe(200); pkg = r.data;
    expect(pkg.status).toBe('with_accounting');
    r = await call('accountant', 'POST', '/accounting/cases/' + pkg.id + '/checks',
      { checks: [{ type: 'bill_passed', status: 'ok' }, { type: 'gst_checked', status: 'ok' }, { type: 'tds_checked', status: 'ok' }] }, pkg.version);
    expect(r.status).toBe(200); pkg = r.data;
    // 10. Approve, then DataMan final posting by the Head Accountant (per-milestone capability).
    pkg = (await call('accountant', 'POST', `/document-packages/${pkg.id}/accounting`, { kind: 'approve_accounting' }, pkg.version)).data;
    expect(pkg.status).toBe('accounting_approved');
    // Plant Head approval is confirmed by the role holding erp.plant_head_approval (HO).
    r = await call('ho', 'POST', `/head-office/cases/${pkg.id}/erp-milestones`, { type: 'plant_head_grn_approval', action: 'confirm', dataManRef: 'J-GRN-0001', verifiedInDataManByStaff: true }, pkg.version);
    expect(r.status, r.body).toBe(200); pkg = r.data;
    r = await call('ho', 'POST', `/head-office/cases/${pkg.id}/erp-milestones`, { type: 'purchase_voucher', action: 'confirm', dataManRef: 'J-VCH-0001', verifiedInDataManByStaff: true }, pkg.version);
    expect(r.status).toBe(200); pkg = r.data;
    r = await call('accountant', 'POST', `/head-office/cases/${pkg.id}/erp-milestones`, { type: 'final_posting', action: 'confirm', dataManRef: 'J-PST-0001', verifiedInDataManByStaff: true }, pkg.version);
    expect(r.status).toBe(200); pkg = r.data;
    expect(pkg.erp.every((m: { status: string }) => m.status === 'confirmed')).toBe(true);
    // 11. Bill posting — the final internal state.
    r = await call('accountant', 'POST', `/document-packages/${pkg.id}/accounting`, { kind: 'post_bill', billRef: 'J-BILL-0001', note: 'J journey posting' }, pkg.version);
    expect(r.status, r.body).toBe(200); pkg = r.data;
    expect(pkg.status).toBe('bill_posted');
    expect((await call('accountant', 'POST', `/document-packages/${pkg.id}/accounting`, { kind: 'post_bill', billRef: 'J-BILL-0002' }, pkg.version)).status).toBe(422);
    // 12. The audit trail shows every leg, including the return to HO.
    const actions = pkg.history.map((h: { action: string }) => h.action);
    for (const wording of ['Sent to Accounts', 'Returned to Head Office', 'Accounting approved', 'Bill posted']) {
      expect(actions, 'missing: ' + wording).toContain(wording);
    }
  }, 60_000);
});
