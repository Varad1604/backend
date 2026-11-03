import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { PrismaClient } from '@prisma/client';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureHttp } from '../src/http';
import { env } from '../src/config/env';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { AuthService } from '../src/modules/identity-access/auth.service';
import { AuditService } from '../src/modules/audit/audit.service';

/** Brief §12 test 3 — golden path M1: gate → QC draft → submit → QC decision → tare → exit → GRN (D-03: the QC operator decides). */
describe.skipIf(process.env.REQUIRE_LIVE_DEPENDENCIES !== 'true')('golden path M1: gate → QC operator (readings + decision) → gate (AT-03)', () => {
  let app: NestFastifyApplication, prisma: PrismaService, base: PrismaClient, audit: AuditService;
  let gate: string, qc: string, ho: string, gateId: string, gateName: string, qcName: string;
  const schema = 'core_' + randomUUID().replaceAll('-', '');
  const password = randomBytes(24).toString('base64url');
  const prefix = 'DEMO-' + randomUUID(); let counter = 0;
  const call = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, token?: string, payload?: object, key = randomUUID(), ifMatch?: number) => app.inject({ method, url: '/api/v1' + path,
    remoteAddress: '198.19.0.' + (++counter % 250),
    headers: { ...(token ? { authorization: 'Bearer ' + token } : {}), 'idempotency-key': key, ...(ifMatch ? { 'if-match': String(ifMatch) } : {}) }, ...(payload ? { payload } : {}) });
  const create = async () => {
    const response = await call('POST', '/receiving-visits', gate, { officialGateEntryRef: 'DEMO-' + randomUUID().slice(0, 20), vehicleNumber: 'DEMO-VEHICLE-001', supplierDisplayName: 'Demo Supplier A', materialDisplayName: 'DEMO-Waste Paper', grossWeight: { value: '15000', unit: 'kg' } });
    expect(response.statusCode).toBe(201); return response.json().data as { id: string; version: number };
  };
  const readings = (moisture: string, impurity: string) => [
    { code: 'moisture', value: moisture, unit: 'percent' }, { code: 'impurity', value: impurity, unit: 'percent' },
  ];
  beforeAll(async () => {
    const url = new URL(env.DATABASE_URL); url.searchParams.set('schema', schema);
    execFileSync(process.execPath, [resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy'], { env: { ...process.env, DATABASE_URL: url.toString() }, stdio: 'pipe' });
    base = new PrismaClient(); prisma = new PrismaService({ datasourceUrl: url.toString() });
    const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(prisma).compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter()); await configureHttp(app); await app.init(); await app.getHttpAdapter().getInstance().ready();
    const auth = app.get(AuthService); audit = app.get(AuditService); const tokens: string[] = [];
    for (const role of ['gate', 'qc', 'ho'] as const) {
      const code = prefix + '-' + role; const user = await auth.bootstrapDemo(code, 'DEMO-' + role, password, [role]); if (!gateId) { gateId = user.id; gateName = user.displayName; }
      if (role === 'qc') qcName = user.displayName;
      const response = await call('POST', '/auth/login', undefined, { username: code, password, clientType: 'mobile' });
      expect(response.statusCode).toBe(200); tokens.push(response.json().data.accessToken);
    }
    [gate, qc, ho] = tokens as [string, string, string];
  }, 30_000);
  afterAll(async () => {
    vi.restoreAllMocks(); await app?.close();
    if (base) { if (!/^core_[a-f0-9]{32}$/.test(schema)) throw Error('Unsafe test schema'); await base.$executeRawUnsafe('DROP SCHEMA "' + schema + '" CASCADE'); await base.$disconnect(); }
  });
  it('walks create → draft → submit → return → resubmit → accept → tare → exit → GRN with independent status domains', async () => {
    const visit = await create(), path = '/receiving-visits/' + visit.id;
    // QC work queue: QcQueueItem[] oldest first, shaped per brief §5.4.
    const queue = await call('GET', '/qc/queue', qc);
    expect(queue.statusCode).toBe(200);
    const item = queue.json().data.find((row: { visit: { id: string } }) => row.visit.id === visit.id);
    expect(item).toMatchObject({ latestRevision: null, lastReturnReason: null });
    expect(item.visit).toMatchObject({ qcStatus: 'pending', version: 1 });
    // Draft keeps the case in progress and does not require both readings (R-07).
    const draft = await call('POST', path + '/qc-inspections', qc, { measurements: [{ code: 'moisture', value: '9.5', unit: 'percent' }], intent: 'draft' }, randomUUID(), 1);
    expect(draft.statusCode).toBe(201);
    expect(draft.json().data).toMatchObject({ qcStatus: 'in_progress', revisions: [{ revision: 1, state: 'draft', revisionReason: null }] });
    expect(draft.json().data.deductionCalculation).toEqual({ status: 'not_configured', value: null });
    expect((await call('GET', path, qc)).json().data).toMatchObject({ qcStatus: 'in_progress', version: 2 });
    // Submit requires both moisture and impurity.
    const partial = await call('POST', path + '/qc-inspections', qc, { measurements: [{ code: 'moisture', value: '9.50', unit: 'percent' }], intent: 'submit' }, randomUUID(), 2);
    expect(partial.statusCode).toBe(422); expect(partial.json().error.fields.impurity).toBeDefined();
    const submitted = await call('POST', path + '/qc-inspections', qc, { measurements: readings('9.50', '1.00'), intent: 'submit', remarks: 'DEMO observed readings; no calculation' }, randomUUID(), 2);
    expect(submitted.statusCode).toBe(201);
    // A submit finalises the current draft in place (mock rule: the draft is overwritten, revision stays 1).
    expect(submitted.json().data).toMatchObject({ qcStatus: 'submitted', revisions: [{ revision: 1, state: 'submitted',
      measurements: [{ code: 'moisture', value: '9.50', unit: 'percent' }, { code: 'impurity', value: '1.00', unit: 'percent' }] }] });
    // Numeric rows carry the fixed scale 2 (CONTRACT_DIFF #146).
    expect(await prisma.qCMeasurement.count({ where: { revision: { inspection: { visitId: visit.id } }, code: 'moisture' } })).toBe(1);
    expect((await call('GET', path, qc)).json().data).toMatchObject({ qcStatus: 'submitted', version: 3 });
    // Submitted cases stay in the QC operator's own queue, awaiting the decision (D-03).
    const awaiting = (await call('GET', '/qc/queue', qc)).json().data.find((row: { visit: { id: string } }) => row.visit.id === visit.id);
    expect(awaiting.visit).toMatchObject({ qcStatus: 'submitted' });
    // The separate decision queue is gone.
    expect((await call('GET', '/qc/review-queue', qc)).statusCode).toBe(404);
    const inspectionId = (await call('GET', path + '/qc-inspections', qc)).json().data[0].inspectionId;
    // Only qc.decide may decide: Gate and HO are refused.
    expect((await call('POST', '/qc-inspections/' + inspectionId + '/decisions', gate, { outcome: 'accepted' }, randomUUID(), 3)).statusCode).toBe(403);
    expect((await call('POST', '/qc-inspections/' + inspectionId + '/decisions', ho, { outcome: 'accepted' }, randomUUID(), 3)).statusCode).toBe(403);
    // The decision still needs the visit If-Match and an Idempotency-Key.
    expect((await call('POST', '/qc-inspections/' + inspectionId + '/decisions', qc, { outcome: 'accepted' }, randomUUID(), 2)).statusCode).toBe(409);
    const rejected = await call('POST', '/qc-inspections/' + inspectionId + '/decisions', qc, { outcome: 'nonsense', reason: 'x' }, randomUUID(), 3);
    expect(rejected.statusCode).toBe(422);
    // The same QC operator who submitted the readings records the decision (no separation-of-duties block).
    const returnKey = randomUUID();
    const returned = await call('POST', '/qc-inspections/' + inspectionId + '/decisions', qc, { outcome: 'returned', reason: 'DEMO: re-check moisture on a second sample.' }, returnKey, 3);
    expect(returned.statusCode).toBe(200);
    expect(returned.json().data).toMatchObject({ qcStatus: 'returned', reviews: [{ outcome: 'returned', demonstrationOnly: false, forRevision: 1, recordedBy: qcName }] });
    const returnReplay = await call('POST', '/qc-inspections/' + inspectionId + '/decisions', qc, { outcome: 'returned', reason: 'DEMO: re-check moisture on a second sample.' }, returnKey, 3);
    expect(returnReplay.json()).toEqual(returned.json()); expect(returnReplay.headers['idempotent-replay']).toBe('true');
    expect((await call('GET', path, qc)).json().data).toMatchObject({ qcStatus: 'returned', version: 4 });
    // Resubmission after a return requires a revision reason (R-07).
    const noReason = await call('POST', path + '/qc-inspections', qc, { measurements: readings('9.00', '1.00'), intent: 'submit' }, randomUUID(), 4);
    expect(noReason.statusCode).toBe(422); expect(noReason.json().error.fields.revisionReason).toBeDefined();
    const resubmitted = await call('POST', path + '/qc-inspections', qc, { measurements: readings('9.00', '1.00'), intent: 'submit', revisionReason: 'DEMO second-sample moisture check' }, randomUUID(), 4);
    expect(resubmitted.statusCode).toBe(201);
    expect(resubmitted.json().data.revisions.at(-1)).toMatchObject({ revision: 2, state: 'submitted', revisionReason: 'DEMO second-sample moisture check' });
    // The QC operator accepts the second submission.
    const accepted = await call('POST', '/qc-inspections/' + inspectionId + '/decisions', qc, { outcome: 'accepted' }, randomUUID(), 5);
    expect(accepted.statusCode).toBe(200); expect(accepted.json().data.qcStatus).toBe('accepted');
    // Gate follow-up: tare, exit (R-05), GRN (R-06) — all with the visit version in If-Match.
    const tare = await call('POST', path + '/weighments', gate, { kind: 'tare', value: '5500', unit: 'kg' }, randomUUID(), 6);
    expect(tare.statusCode).toBe(201); expect(tare.json().data).toMatchObject({ version: 7, tareWeight: { value: '5500.000', unit: 'kg' } });
    const exit = await call('POST', path + '/exit', gate, { physicalExitAt: new Date(Date.now() - 5_000).toISOString(), remarks: 'DEMO physical exit report', millChecksConfirmed: true }, randomUUID(), 7);
    expect(exit.statusCode).toBe(201);
    expect(exit.json().data).toMatchObject({ version: 8, qcStatus: 'accepted', exitStatus: 'exited', grnStatus: 'not_recorded' });
    const grnKey = randomUUID();
    const grn = await call('POST', path + '/grn-links', gate, { officialGrnRef: '0007-HO/26', verifiedInDataManByStaff: true }, grnKey, 8);
    expect(grn.statusCode).toBe(201); expect(grn.json().data).toMatchObject({ version: 9, exitStatus: 'exited', grnStatus: 'reference_recorded', officialGrnRef: '0007-HO/26' });
    const replay = await call('POST', path + '/grn-links', gate, { officialGrnRef: '0007-HO/26', verifiedInDataManByStaff: true }, grnKey, 8);
    expect(replay.json()).toEqual(grn.json()); expect(replay.headers['idempotent-replay']).toBe('true');
    // The audit chain holds and every event landed in order with the right source.
    expect((await audit.verify()).valid).toBe(true);
    const timeline = (await call('GET', path + '/timeline', qc)).json().data;
    const actions = timeline.map((event: { action: string }) => event.action);
    expect(actions).toEqual(['Official GRN reference recorded', 'Physical exit recorded', 'Tare recorded', 'QC accepted',
      'QC readings submitted', 'QC returned for correction', 'QC readings submitted', 'QC draft saved', 'Gross weight recorded', 'Receiving visit created']);
    expect(timeline.find((event: { action: string }) => event.action === 'Official GRN reference recorded').source).toBe('manual_staff_confirmation');
    expect(timeline.find((event: { action: string }) => event.action === 'Receiving visit created').actor).toBe(gateName);
    expect(timeline.find((event: { action: string }) => event.action === 'QC accepted').actor).toBe(qcName);
    // New decision audit rows are real decisions, not demonstration records.
    const decisionEvents = await prisma.auditEvent.findMany({ where: { entityType: 'QCInspection', entityId: inspectionId, action: { in: ['qc_returned', 'qc_accepted'] } } });
    expect(decisionEvents).toHaveLength(2);
    for (const event of decisionEvents) expect((event.newValue as { demonstrationOnly?: boolean }).demonstrationOnly).toBeUndefined();
    // Exit history rows keep event time separate from record time (brief §3).
    const exitRow = await prisma.vehicleExit.findFirstOrThrow({ where: { visitId: visit.id } });
    expect(exitRow.physicalExitAt.getTime()).toBeLessThan(Date.now());
    expect(exitRow.recordedAt).not.toEqual(exitRow.physicalExitAt);
  }, 60_000);
  it('enforces the brief §4 matrix on server capabilities (AT-11)', async () => {
    const visit = await create(), path = '/receiving-visits/' + visit.id;
    expect((await call('POST', path + '/qc-inspections', gate, { measurements: readings('9', '1'), intent: 'submit' }, randomUUID(), 1)).statusCode).toBe(403);
    expect((await call('POST', path + '/qc-inspections', ho, { measurements: readings('9', '1'), intent: 'submit' }, randomUUID(), 1)).statusCode).toBe(403);
    expect((await call('GET', '/qc/queue', ho)).statusCode).toBe(403);
    expect((await call('GET', '/qc/queue', qc)).statusCode).toBe(200);
    expect((await call('POST', path + '/weighments', qc, { kind: 'tare', value: '100', unit: 'kg' }, randomUUID(), 1)).statusCode).toBe(403);
    expect((await call('POST', path + '/exit', qc, { millChecksConfirmed: true }, randomUUID(), 1)).statusCode).toBe(403);
    expect((await call('POST', path + '/grn-links', qc, { officialGrnRef: 'DEMO-GRN', verifiedInDataManByStaff: true }, randomUUID(), 1)).statusCode).toBe(403);
  });
  it('blocks exit per R-05 with the mock-approved sentences and never exits on a tare alone', async () => {
    const visit = await create(), path = '/receiving-visits/' + visit.id, key = randomUUID();
    const denied = await call('POST', path + '/exit', gate, { millChecksConfirmed: true }, key, 1);
    expect(denied.statusCode).toBe(422); expect(denied.json().error.code).toBe('DOMAIN_RULE');
    expect(denied.json().error.message).toBe('Record the tare (empty) weight before recording exit.');
    expect((await prisma.receivingVisit.findUniqueOrThrow({ where: { id: visit.id } })).version).toBe(1);
    expect(await prisma.vehicleExit.count({ where: { visitId: visit.id } })).toBe(0);
    expect(await prisma.idempotencyRecord.count({ where: { key } })).toBe(0);
    const tare = await call('POST', path + '/weighments', gate, { kind: 'tare', value: '5500', unit: 'kg' }, randomUUID(), 1);
    expect(tare.statusCode).toBe(201); expect(tare.json().data).toMatchObject({ version: 2, exitStatus: 'on_premises', qcStatus: 'pending' });
    const noQc = await call('POST', path + '/exit', gate, { millChecksConfirmed: true }, randomUUID(), 2);
    expect(noQc.statusCode).toBe(422); expect(noQc.json().error.message).toBe('QC has not submitted readings for this truck yet.');
    await call('POST', path + '/qc-inspections', qc, { measurements: readings('9.00', '1.00'), intent: 'submit' }, randomUUID(), 2);
    const noChecks = await call('POST', path + '/exit', gate, { millChecksConfirmed: false }, randomUUID(), 3);
    expect(noChecks.statusCode).toBe(422);
    expect(noChecks.json().error.fields.millChecksConfirmed).toBe('Confirm the mill’s exit checks were completed.');
    const future = await call('POST', path + '/exit', gate, { millChecksConfirmed: true, physicalExitAt: new Date(Date.now() + 30 * 60_000).toISOString() }, randomUUID(), 3);
    expect(future.json().error.fields.physicalExitAt).toBe('Exit time cannot be in the future.');
    const beforeVisit = await call('POST', path + '/exit', gate, { millChecksConfirmed: true, physicalExitAt: new Date(Date.now() - 10 * 60_000).toISOString() }, randomUUID(), 3);
    expect(beforeVisit.json().error.fields.physicalExitAt).toBe('Exit time cannot be before the truck was recorded at the Gate.');
    const allowed = await call('POST', path + '/exit', gate, { millChecksConfirmed: true }, randomUUID(), 3);
    expect(allowed.statusCode).toBe(201);
    const repeated = await call('POST', path + '/exit', gate, { millChecksConfirmed: true }, randomUUID(), 4);
    expect(repeated.statusCode).toBe(422); expect(repeated.json().error.message).toBe('Physical exit is already recorded for this truck.');
    expect(await prisma.vehicleExit.count({ where: { visitId: visit.id } })).toBe(1);
    // A locked truck refuses tare corrections too (R-04).
    const lateTare = await call('POST', path + '/weighments', gate, { kind: 'tare', value: '5600', unit: 'kg', correctionReason: 'DEMO late re-weigh' }, randomUUID(), 4);
    expect(lateTare.statusCode).toBe(422); expect(lateTare.json().error.message).toBe('The truck has already exited. Tare is locked.');
  }, 60_000);
  it('guards the GRN per R-06 and notes shared references without blocking', async () => {
    const first = await create(), second = await create();
    for (const visit of [first, second]) {
      const path = '/receiving-visits/' + visit.id;
      const withoutTare = await call('POST', path + '/grn-links', gate, { officialGrnRef: 'DEMO-MULTI-0001', verifiedInDataManByStaff: true }, randomUUID(), visit.version);
      expect(withoutTare.statusCode).toBe(422);
      expect(withoutTare.json().error.message).toBe('Record the tare weight first. The GRN is generated in DataMan after empty weighment.');
      expect((await call('POST', path + '/weighments', gate, { kind: 'tare', value: '5500', unit: 'kg' }, randomUUID(), visit.version)).statusCode).toBe(201);
      const unverified = await call('POST', path + '/grn-links', gate, { officialGrnRef: 'DEMO-MULTI-0001', verifiedInDataManByStaff: false }, randomUUID(), visit.version + 1);
      expect(unverified.statusCode).toBe(422); expect(unverified.json().error.fields.verifiedInDataManByStaff).toBeDefined();
      const recorded = await call('POST', path + '/grn-links', gate, { officialGrnRef: 'DEMO-MULTI-0001', verifiedInDataManByStaff: true }, randomUUID(), visit.version + 1);
      expect(recorded.statusCode).toBe(201);
    }
    // D-01/D-11: the same GRN on other visits is noted in the audit detail, not blocked.
    const sharedPath = '/receiving-visits/' + second.id;
    const correction = await call('POST', sharedPath + '/grn-links', gate, { officialGrnRef: 'DEMO-MULTI-0001', verifiedInDataManByStaff: true }, randomUUID(), second.version + 2);
    expect(correction.statusCode).toBe(422); expect(correction.json().error.fields.officialGrnRef).toBe('This is the same reference already recorded.');
    const withReason = await call('POST', sharedPath + '/grn-links', gate, { officialGrnRef: 'DEMO-MULTI-0002', verifiedInDataManByStaff: true, correctionReason: 'DEMO re-typed reference' }, randomUUID(), second.version + 2);
    expect(withReason.statusCode).toBe(201);
    const event = await prisma.auditEvent.findFirstOrThrow({ where: { action: 'grn_reference_corrected' } });
    expect(JSON.stringify(event.newValue)).toContain('DEMO-MULTI-0001');
    expect(event.source).toBe('manual_staff_confirmation');
    // The second recording of the same GRN notes the other visit (D-01/D-11).
    const recordings = await prisma.auditEvent.findMany({ where: { action: 'grn_reference_recorded', newValue: { path: ['officialGrnRef'], equals: 'DEMO-MULTI-0001' } }, orderBy: { id: 'asc' } });
    expect(recordings.length).toBe(2);
    expect(JSON.stringify(recordings[0]!.newValue)).not.toContain('Same GRN also recorded');
    expect(JSON.stringify(recordings[1]!.newValue)).toContain('Same GRN also recorded');
  });
  it('rejects stale writes with VERSION_CONFLICT and rolls QC back if the audit fails', async () => {
    const visit = await create(), path = '/receiving-visits/' + visit.id + '/qc-inspections';
    expect((await call('POST', path, qc, { measurements: readings('9', '1'), intent: 'draft' }, randomUUID(), 1)).statusCode).toBe(201);
    const stale = await call('POST', path, qc, { measurements: readings('9', '1'), intent: 'draft' }, randomUUID(), 1);
    expect(stale.statusCode).toBe(409); expect(stale.json().error.code).toBe('VERSION_CONFLICT');
    expect(stale.json().error.meta).toMatchObject({ currentVersion: 2 });
    // The audit failure must roll the finalisation back atomically: the draft stays a draft
    // (R-07 overwrite), no version bump, no retry snapshot (brief §7 concurrency rules).
    const failure = vi.spyOn(audit, 'append').mockRejectedValueOnce(Error('DEMO audit failure'));
    const rollbackKey = randomUUID();
    const failed = await call('POST', path, qc, { measurements: readings('9', '1'), intent: 'submit' }, rollbackKey, 2);
    failure.mockRestore(); expect(failed.statusCode).toBe(500);
    expect((await prisma.qCRevision.findFirstOrThrow({ where: { inspection: { visitId: visit.id } } })).state).toBe('draft');
    expect((await prisma.receivingVisit.findUniqueOrThrow({ where: { id: visit.id } })).version).toBe(2);
    expect(await prisma.idempotencyRecord.count({ where: { key: rollbackKey } })).toBe(0);
    const retried = await call('POST', path, qc, { measurements: readings('9', '1'), intent: 'submit' }, rollbackKey, 2);
    expect(retried.statusCode).toBe(201);
    expect((await prisma.qCRevision.findFirstOrThrow({ where: { inspection: { visitId: visit.id } } })).state).toBe('submitted');
    expect((await prisma.receivingVisit.findUniqueOrThrow({ where: { id: visit.id } })).version).toBe(3);
  });
  it('protects submitted history in the database and verifies the complete audit chain', async () => {
    const revision = await prisma.qCRevision.findFirstOrThrow({ where: { state: 'submitted' } });
    await expect(prisma.qCRevision.update({ where: { id: revision.id }, data: { remarks: 'DEMO overwrite' } })).rejects.toThrow();
    const exit = await prisma.vehicleExit.findFirstOrThrow(); await expect(prisma.vehicleExit.delete({ where: { id: exit.id } })).rejects.toThrow();
    const grn = await prisma.gRNReference.findFirstOrThrow(); await expect(prisma.gRNReference.update({ where: { id: grn.id }, data: { officialGrnRef: 'DEMO overwrite' } })).rejects.toThrow();
    const review = await prisma.qCReview.findFirstOrThrow(); await expect(prisma.qCReview.delete({ where: { id: review.id } })).rejects.toThrow();
    expect((await audit.verify()).valid).toBe(true);
  });
});
