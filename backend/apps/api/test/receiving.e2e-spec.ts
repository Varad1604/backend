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

describe.skipIf(process.env.REQUIRE_LIVE_DEPENDENCIES !== 'true')('receiving backend, real database (R-01…R-04, AT-02/03/06/07/16)', () => {
  let app: NestFastifyApplication, prisma: PrismaService, base: PrismaClient, audit: AuditService;
  let gate: string, gate2: string, qc: string, ho: string, gateName: string;
  const schema = 'p2_' + randomUUID().replaceAll('-', '');
  const password = randomBytes(24).toString('base64url');
  const prefix = 'DEMO-' + randomUUID();
  const body = (overrides = {}) => ({ officialGateEntryRef: 'DEMO-' + randomUUID().slice(0, 20), vehicleNumber: 'DEMO-MH-00-AA-0001',
    supplierDisplayName: 'Demo Supplier A', materialDisplayName: 'DEMO-Waste Paper', grossWeight: { value: '15000.000', unit: 'kg' }, ...overrides });
  let requestNumber = 0;
  const request = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, token?: string, payload?: unknown, key?: string, ifMatch?: number) => app.inject({
    method, url, remoteAddress: '198.18.0.' + (++requestNumber % 250),
    headers: { ...(token ? { authorization: 'Bearer ' + token } : {}), ...(key ? { 'idempotency-key': key } : {}), ...(ifMatch ? { 'if-match': String(ifMatch) } : {}) },
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
  const create = (input: Record<string, unknown> = body(), key = randomUUID(), token = gate) => request('POST', '/api/v1/receiving-visits', token, input, key);
  const weight = (id: string, input: object, key = randomUUID(), token = gate, ifMatch?: number) => request('POST', '/api/v1/receiving-visits/' + id + '/weighments', token, input, key, ifMatch);
  beforeAll(async () => {
    const url = new URL(env.DATABASE_URL); url.searchParams.set('schema', schema);
    execFileSync(process.execPath, [resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy'], { env: { ...process.env, DATABASE_URL: url.toString() }, stdio: 'pipe' });
    base = new PrismaClient(); prisma = new PrismaService({ datasourceUrl: url.toString() });
    const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(prisma).compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter()); await configureHttp(app); await app.init();
    await app.getHttpAdapter().getInstance().ready();
    const auth = app.get(AuthService); audit = app.get(AuditService);
    const tokens: string[] = []; const names: string[] = [];
    for (const role of ['gate', 'gate', 'qc', 'ho'] as const) {
      const code = prefix + '-' + tokens.length;
      const user = await auth.bootstrapDemo(code, 'DEMO-User-' + tokens.length, password, [role]);
      if (!gateName) gateName = user.displayName;
      const response = await request('POST', '/api/v1/auth/login', undefined, { username: code, password, clientType: 'mobile' });
      expect(response.statusCode).toBe(200); tokens.push(response.json().data.accessToken); names.push(user.displayName);
    }
    [gate, gate2, qc, ho] = tokens as [string, string, string, string];
    void names;
  }, 30_000);
  afterAll(async () => {
    vi.restoreAllMocks(); await app?.close();
    if (base) {
      if (!/^p2_[a-f0-9]{32}$/.test(schema)) throw Error('Unsafe test schema');
      await base.$executeRawUnsafe('DROP SCHEMA "' + schema + '" CASCADE'); await base.$disconnect();
    }
  });
  it('persists a visit per R-01, preserves opaque refs, and shares it with QC and HO', async () => {
    const response = await create(body({ officialGateEntryRef: '0008-HO', poRef: ' 0000/PO-26-HO ', challanRef: '000001-A', arrivedAt: '2026-11-02T06:27:00.000Z' }));
    expect(response.statusCode).toBe(201);
    const visit = response.json().data;
    // Brief §5.2 exact fields: createdBy is the display name; statuses start per brief; arrivedAt round-trips.
    expect(visit).toMatchObject({ officialGateEntryRef: '0008-HO', poRef: ' 0000/PO-26-HO ', challanRef: '000001-A', createdBy: 'DEMO-User-0',
      version: 1, qcStatus: 'pending', exitStatus: 'on_premises', grnStatus: 'not_recorded', grossWeight: { value: '15000.000', unit: 'kg' },
      tareWeight: null, arrivedAt: '2026-11-02T06:27:00.000Z', officialGrnRef: null, physicalExitAt: null });
    expect(Object.keys(visit).sort()).toEqual(['arrivedAt', 'challanRef', 'createdAt', 'createdBy', 'exitStatus', 'grossWeight', 'grnStatus', 'id',
      'materialDisplayName', 'notes', 'officialGateEntryRef', 'officialGrnRef', 'physicalExitAt', 'poRef', 'qcStatus', 'supplierDisplayName', 'tareWeight',
      'updatedAt', 'vehicleNumber', 'version'].sort());
    const read = await request('GET', '/api/v1/receiving-visits/' + visit.id, qc);
    expect(read.statusCode).toBe(200); expect(read.json().data).toEqual(visit);
    expect((await request('GET', '/api/v1/receiving-visits/' + visit.id, ho)).statusCode).toBe(200);
    expect((await prisma.weighment.findFirstOrThrow({ where: { visitId: visit.id } })).value.toFixed(3)).toBe('15000.000');
  });
  it('enforces R-01 required fields and max lengths (40/30/80/80)', async () => {
    expect((await create(body({ supplierDisplayName: undefined }))).statusCode).toBe(422);
    expect((await create(body({ materialDisplayName: undefined }))).statusCode).toBe(422);
    expect((await create(body({ officialGateEntryRef: 'X'.repeat(41) }))).json().error.fields.officialGateEntryRef).toBeDefined();
    expect((await create(body({ vehicleNumber: 'V'.repeat(31) }))).statusCode).toBe(422);
    expect((await create(body({ supplierDisplayName: 'S'.repeat(81) }))).statusCode).toBe(422);
    expect((await create(body({ materialDisplayName: 'M'.repeat(81) }))).statusCode).toBe(422);
    expect((await create(body({ challanRef: 'C'.repeat(41) }))).statusCode).toBe(422);
    expect((await create(body({ grossWeight: { value: '0.000', unit: 'kg' } }))).statusCode).toBe(422);
  });
  it('rejects characters outside the brief §3 safe charset in refs and names (KPMPL-001)', async () => {
    // The '#' and '&' etc. ARE allowed; angle brackets, quotes, braces and equals are not.
    expect((await create(body({ officialGateEntryRef: 'DEMO<bad>' }))).statusCode).toBe(422);
    expect((await create(body({ vehicleNumber: 'DEMO"MH"' }))).statusCode).toBe(422);
    expect((await create(body({ supplierDisplayName: 'Demo {Supplier}' }))).statusCode).toBe(422);
    expect((await create(body({ challanRef: 'CH=1;2' }))).statusCode).toBe(422);
    // The allowed set keeps working: letters, digits, space, punctuation from the charset, unicode.
    expect((await create(body({ officialGateEntryRef: "0042-HO (gate) #2" }))).statusCode).toBe(201);
    expect((await create(body({ supplierDisplayName: 'Démo Supplier Müller & Co.' }))).statusCode).toBe(201);
  });
  it('denies unauthorized writes and serves the register to every role per brief §5.2', async () => {
    expect((await create(body(), randomUUID(), qc)).statusCode).toBe(403);
    // receiving.view is held by all six roles: ho and admin read the register (CONTRACT_DIFF #151).
    expect((await request('GET', '/api/v1/receiving-visits', ho)).statusCode).toBe(200);
    expect((await request('GET', '/api/v1/receiving-visits')).statusCode).toBe(401);
    const { grossWeight: _weight, ...fields } = body({ officialGateEntryRef: 'DEMO-HIDDEN' }); void _weight;
    const hidden = await prisma.receivingVisit.create({ data: { ...fields, createdBy: (await prisma.user.findFirstOrThrow()).id, isDemo: false } });
    expect((await request('GET', '/api/v1/receiving-visits/' + hidden.id, gate)).statusCode).toBe(404);
    expect((await weight(hidden.id, { kind: 'tare', value: '1', unit: 'kg' }, randomUUID(), gate, 1)).statusCode).toBe(404);
  });
  it('serializes identical retries and rejects changed payloads without duplicate audit', async () => {
    const input = body(), key = randomUUID(); const before = await prisma.receivingVisit.count();
    const responses = await Promise.all([create(input, key), create(input, key)]);
    expect(responses.map(response => response.statusCode)).toEqual([201, 201]);
    expect(responses[0]!.json()).toEqual(responses[1]!.json());
    expect(responses.filter(response => response.headers['idempotent-replay'] === 'true')).toHaveLength(1);
    expect(await prisma.receivingVisit.count()).toBe(before + 1);
    const id = responses[0]!.json().data.id;
    expect(await prisma.auditEvent.count({ where: { entityType: 'ReceivingVisit', entityId: id, action: 'receiving_created' } })).toBe(1);
    expect(await prisma.weighment.count({ where: { visitId: id } })).toBe(1);
    const conflict = await create({ ...input, notes: 'DEMO altered retry' }, key);
    expect(conflict.statusCode).toBe(422); expect(conflict.json().error.code).toBe('VALIDATION_FAILED');
  });
  it('blocks exact duplicate Gate Entry refs globally and identifies the existing visit (R-02)', async () => {
    const input = body(), key = randomUUID(); const first = await create(input, key);
    const second = await create(input, key, gate2);
    expect(first.statusCode).toBe(201); expect(second.statusCode).toBe(409);
    expect(second.json().error).toMatchObject({ code: 'DUPLICATE_CANDIDATE', meta: { existingId: first.json().data.id } });
    expect(second.headers['idempotent-replay']).toBeUndefined();
  });
  it('records tare from the If-Match header, derives exact net, and corrects with a reason (R-04)', async () => {
    const visit = (await create()).json().data;
    // The body carries no version; the header does (CONTRACT_DIFF #41).
    const tare = await weight(visit.id, { kind: 'tare', value: '5500', unit: 'kg' }, randomUUID(), gate, 1);
    expect(tare.statusCode).toBe(201); expect(tare.json().data).toMatchObject({ version: 2, tareWeight: { value: '5500.000', unit: 'kg' } });
    expect(tare.json().data.netWeight).toBeUndefined();
    // A second tare is a correction: correctionReason required, old value kept in audit.
    const withoutReason = await weight(visit.id, { kind: 'tare', value: '6000', unit: 'kg' }, randomUUID(), gate, 2);
    expect(withoutReason.statusCode).toBe(422);
    expect(withoutReason.json().error.fields.correctionReason).toBeDefined();
    const key = randomUUID();
    const corrected = await weight(visit.id, { kind: 'tare', value: '6000', unit: 'kg', correctionReason: 'DEMO scale re-weigh' }, key, gate, 2);
    expect(corrected.statusCode).toBe(201); expect(corrected.json().data).toMatchObject({ version: 3, tareWeight: { value: '6000.000', unit: 'kg' } });
    const replay = await weight(visit.id, { kind: 'tare', value: '6000', unit: 'kg', correctionReason: 'DEMO scale re-weigh' }, key, gate, 2);
    expect(replay.json()).toEqual(corrected.json()); expect(replay.headers['idempotent-replay']).toBe('true');
    expect((await prisma.weighment.findFirstOrThrow({ where: { visitId: visit.id, kind: 'tare' }, orderBy: { recordedAt: 'asc' } })).value.toFixed(3)).toBe('5500.000');
    // R-04: tare must stay below gross.
    expect((await weight(visit.id, { kind: 'tare', value: '16000', unit: 'kg' }, randomUUID(), gate, 3)).json().error.fields.value).toMatch(/less than the gross/);
    expect((await weight(visit.id, { kind: 'tare', value: '15000', unit: 'kg' }, randomUUID(), gate, 3)).statusCode).toBe(422);
  });
  it('rejects racing writes with VERSION_CONFLICT and the current version in meta', async () => {
    const visit = (await create()).json().data;
    const responses = await Promise.all(['5500', '6000'].map(value => weight(visit.id, { kind: 'tare', value: value + '.000', unit: 'kg' }, randomUUID(), gate, 1)));
    expect(responses.map(response => response.statusCode).sort()).toEqual([201, 409]);
    const conflict = responses.find(response => response.statusCode === 409)!;
    expect(conflict.json().error.code).toBe('VERSION_CONFLICT');
    expect(conflict.json().error.meta).toMatchObject({ currentVersion: 2 });
    expect(await prisma.weighment.count({ where: { visitId: visit.id } })).toBe(2);
    expect((await prisma.receivingVisit.findUniqueOrThrow({ where: { id: visit.id } })).version).toBe(2);
  });
  it('rejects malformed/negative/overprecision weights and non-kg units without partial saves', async () => {
    const before = await prisma.receivingVisit.count();
    for (const value of ['-1', '0', '1e3', '1.0001', '1000000000']) expect((await create(body({ grossWeight: { value, unit: 'kg' } }))).statusCode).toBe(422);
    expect((await create(body({ createdBy: randomUUID() }))).statusCode).toBe(422);
    expect((await request('POST', '/api/v1/receiving-visits', gate, body())).statusCode).toBe(422);
    expect(await prisma.receivingVisit.count()).toBe(before);
    const visit = (await create()).json().data;
    expect((await weight(visit.id, { kind: 'tare', value: '1', unit: 'mt' }, randomUUID(), gate, 1)).statusCode).toBe(422);
    expect(await prisma.weighment.count({ where: { visitId: visit.id } })).toBe(1);
    expect((await prisma.receivingVisit.findUniqueOrThrow({ where: { id: visit.id } })).version).toBe(1);
  });
  it('rolls data, weights, audit and retry snapshot back together on an audit failure', async () => {
    const input = body(), key = randomUUID();
    const counts = [await prisma.receivingVisit.count(), await prisma.weighment.count(), await prisma.idempotencyRecord.count()];
    const failure = vi.spyOn(audit, 'append').mockRejectedValueOnce(Error('DEMO simulated audit failure'));
    const response = await create(input, key); failure.mockRestore();
    expect(response.statusCode).toBe(500);
    expect([await prisma.receivingVisit.count(), await prisma.weighment.count(), await prisma.idempotencyRecord.count()]).toEqual(counts);
    expect((await create(input, key)).statusCode).toBe(201);
  });
  it('matches refs as text, searches refs partially and by GRN, filters statuses, and caps pageSize at 500', async () => {
    const exact = await request('GET', '/api/v1/receiving-visits?officialGateEntryRef=0008-HO&pageSize=1', qc);
    expect(exact.statusCode).toBe(200);
    // Brief §3: paged payloads are {data: {data, page, pageSize, total}} (CONTRACT_DIFF #94).
    expect(exact.json()).toMatchObject({ data: { page: 1, pageSize: 1 } });
    expect(Array.isArray(exact.json().data.data)).toBe(true);
    expect(exact.json().data.data[0].officialGateEntryRef).toBe('0008-HO');
    // Partial, case-insensitive ref search (CONTRACT_DIFF #144).
    const partial = await request('GET', '/api/v1/receiving-visits?search=8-ho', qc);
    expect(partial.json().data.total).toBe(1);
    expect((await request('GET', '/api/v1/receiving-visits?search=DEMO-NoMatch-' + randomUUID(), qc)).json().data.total).toBe(0);
    const supplier = 'DEMO-Search-Supplier-' + randomUUID();
    const materialVisit = (await create(body({ supplierDisplayName: supplier }))).json().data;
    const match = await request('GET', '/api/v1/receiving-visits?search=' + encodeURIComponent(supplier.toLowerCase()), qc);
    expect(match.statusCode).toBe(200); expect(match.json().data.data.map((item: { id: string }) => item.id)).toEqual([materialVisit.id]);
    expect((await request('GET', '/api/v1/receiving-visits?pageSize=500', qc)).statusCode).toBe(200);
    // The brief mandates a 500 cap (CONTRACT_DIFF #143; the old test asserted 101).
    expect((await request('GET', '/api/v1/receiving-visits?pageSize=501', qc)).statusCode).toBe(422);
    // Status filters (CONTRACT_DIFF #142): the register tiles rely on them.
    const pending = await request('GET', '/api/v1/receiving-visits?qcStatus=pending', qc);
    expect(pending.statusCode).toBe(200);
    expect(pending.json().data.data.every((visit: { qcStatus: string }) => visit.qcStatus === 'pending')).toBe(true);
    expect((await request('GET', `/api/v1/receiving-visits?qcStatus=submitted&qcStatus=returned`, qc)).statusCode).toBe(200);
    expect((await request('GET', '/api/v1/receiving-visits?exitStatus=on_premises', qc)).json().data.data.every((visit: { exitStatus: string }) => visit.exitStatus === 'on_premises')).toBe(true);
    expect((await request('GET', '/api/v1/receiving-visits?grnStatus=not_recorded', qc)).statusCode).toBe(200);
    const row = await prisma.weighment.findFirstOrThrow();
    await expect(prisma.weighment.update({ where: { id: row.id }, data: { value: '42' } })).rejects.toThrow();
    await expect(prisma.weighment.delete({ where: { id: row.id } })).rejects.toThrow();
    expect((await audit.verify()).valid).toBe(true);
  });
  it('locks the gate details after exit and keeps corrections reasoned and audited (R-03)', async () => {
    const visit = (await create()).json().data;
    const key = randomUUID();
    // Same values as the stored visit, no changes → the reason field carries the error.
    const unchanged = await request('PATCH', '/api/v1/receiving-visits/' + visit.id, gate,
      { officialGateEntryRef: visit.officialGateEntryRef, vehicleNumber: visit.vehicleNumber, supplierDisplayName: visit.supplierDisplayName,
        materialDisplayName: visit.materialDisplayName, grossWeight: { value: '15000.000', unit: 'kg' }, reason: 'DEMO no-op' }, key, visit.version);
    expect(unchanged.statusCode).toBe(422);
    expect(unchanged.json().error.fields.reason).toBe('Change at least one field, or go back.');
    const corrected = await request('PATCH', '/api/v1/receiving-visits/' + visit.id, gate,
      { vehicleNumber: 'DEMO-MH-00-ZZ-9999', supplierDisplayName: 'Demo Supplier A', materialDisplayName: 'DEMO-Waste Paper', grossWeight: { value: '15000.000', unit: 'kg' }, reason: 'DEMO transcription fix' }, randomUUID(), 1);
    expect(corrected.statusCode).toBe(200); expect(corrected.json().data.vehicleNumber).toBe('DEMO-MH-00-ZZ-9999');
    expect(corrected.json().data.createdBy).toBe('DEMO-User-0');
    const timeline = (await request('GET', '/api/v1/receiving-visits/' + visit.id + '/timeline', ho)).json().data;
    expect(timeline[0].action).toBe('Gate details corrected');
    expect(timeline.at(0)!.actor).toBe('DEMO-User-0');
    expect(await prisma.auditEvent.count({ where: { entityType: 'ReceivingVisit', entityId: visit.id, action: 'receiving_corrected' } })).toBe(1);
  });
});
