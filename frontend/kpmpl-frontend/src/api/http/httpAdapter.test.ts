import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHttpAdapter, toApiErrorFromResponse } from './httpAdapter';
import { ApiError } from '../errors';
import type { ReceivingVisit } from '../../domain/types';

/* ---------------- helpers ---------------- */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

interface Captured { url: string; init: RequestInit; headers: Headers }

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function setup(responses: (Response | Error | ((c: Captured) => Response | Promise<Response>))[], opts: { timeoutMs?: number } = {}) {
  const calls: Captured[] = [];
  const queue = [...responses];
  const fetchMock = vi.fn(async (url: string | URL | Request, init: RequestInit = {}) => {
    const c: Captured = { url: typeof url === 'string' ? url : url instanceof URL ? url.href : url.url, init, headers: new Headers(init.headers) };
    calls.push(c);
    const next = queue.shift();
    if (next === undefined) throw new Error(`unexpected fetch ${c.url}`);
    if (next instanceof Error) throw next;
    return typeof next === 'function' ? next(c) : next;
  });
  const onSessionExpired = vi.fn();
  const api = createHttpAdapter({
    baseUrl: '/api/v1/',
    timeoutMs: opts.timeoutMs ?? 5000,
    fetch: fetchMock,
    onSessionExpired,
    retryDelayMs: 0,
  });
  return { api, calls, fetchMock, onSessionExpired };
}

const visit: ReceivingVisit = {
  id: 'v1', officialGateEntryRef: '0008-HO', vehicleNumber: 'DEMO-MH-1', supplierDisplayName: 'Demo Supplier A',
  materialDisplayName: 'Domestic Waste Paper', challanRef: null, poRef: null, arrivedAt: null,
  grossWeight: { value: '15000.000', unit: 'kg' }, tareWeight: null, notes: null, qcStatus: 'pending',
  exitStatus: 'on_premises', grnStatus: 'not_recorded', officialGrnRef: null, physicalExitAt: null,
  createdAt: '2026-11-02T06:27:00.000Z', createdBy: 'Demo Gate User', updatedAt: '2026-11-02T06:27:00.000Z', version: 1,
};

async function caught(p: Promise<unknown>): Promise<ApiError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ApiError) return e;
    throw e;
  }
  throw new Error('expected an ApiError');
}

const bodyText = (c: Captured): string => (typeof c.init.body === 'string' ? c.init.body : '');

/* ---------------- envelope parsing ---------------- */

describe('envelope parsing', () => {
  it('unwraps { data } and keeps decimals and refs as strings', async () => {
    const { api, calls } = setup([json(200, { data: visit })]);
    const v = await api.getVisit('v1');
    expect(calls[0]!.url).toBe('/api/v1/receiving-visits/v1');
    expect(v.grossWeight?.value).toBe('15000.000');
    expect(typeof v.grossWeight?.value).toBe('string');
    expect(v.officialGateEntryRef).toBe('0008-HO');
  });

  it('unwraps a Page inside { data }', async () => {
    const page = { data: [visit], page: 1, pageSize: 50, total: 1 };
    const { api, calls } = setup([json(200, { data: page })]);
    const res = await api.listVisits({ search: 'DEMO', qcStatus: ['pending', 'returned'], page: 2, pageSize: 50 });
    expect(res.total).toBe(1);
    expect(res.data[0]?.id).toBe('v1');
    expect(calls[0]!.url).toBe('/api/v1/receiving-visits?search=DEMO&qcStatus=pending&qcStatus=returned&page=2&pageSize=50');
  });

  it('treats 204 as no body (logout)', async () => {
    const { api, calls } = setup([new Response(null, { status: 204 })]);
    await expect(api.logout()).resolves.toBeUndefined();
    expect(calls[0]!.init.method).toBe('POST');
  });

  it('rejects a 2xx body without the data envelope as SERVER_ERROR', async () => {
    const { api } = setup([json(200, visit)]);
    const e = await caught(api.getVisit('v1'));
    expect(e.code).toBe('SERVER_ERROR');
  });

  it('rejects a non-JSON 2xx body (e.g. index.html from a misrouted proxy)', async () => {
    const { api } = setup([new Response('<!doctype html>', { status: 200, headers: { 'Content-Type': 'text/html' } })]);
    const e = await caught(api.getVisit('v1'));
    expect(e.code).toBe('SERVER_ERROR');
    expect(e.message).toMatch(/unexpected response/);
  });

  it('returns the first QC inspection or null from the array endpoint', async () => {
    const { api } = setup([json(200, { data: [] })]);
    await expect(api.getQcInspection('v1')).resolves.toBeNull();
  });
});

/* ---------------- error mapping ---------------- */

describe('error mapping', () => {
  it('maps the error envelope onto ApiError (code, message, fields, requestId, meta)', async () => {
    const { api } = setup([
      json(422, { error: { code: 'VALIDATION_FAILED', message: 'Please check the highlighted fields.', fields: { grossWeight: 'Enter a gross weight greater than zero.', bad: 3 }, requestId: 'req_1', meta: {} } }),
    ]);
    const e = await caught(api.createVisit({ officialGateEntryRef: 'X', vehicleNumber: 'V', supplierDisplayName: 'S', materialDisplayName: 'M', grossWeight: { value: '0', unit: 'kg' } }, { idempotencyKey: 'k' }));
    expect(e.code).toBe('VALIDATION_FAILED');
    expect(e.httpStatus).toBe(422);
    expect(e.fields).toEqual({ grossWeight: 'Enter a gross weight greater than zero.' });
    expect(e.requestId).toBe('req_1');
  });

  it.each([
    ['DUPLICATE_CANDIDATE', 409, { existingId: 'v9' }],
    ['VERSION_CONFLICT', 409, { currentVersion: 4 }],
    ['DOMAIN_RULE', 422, {}],
    ['FORBIDDEN', 403, {}],
    ['NOT_FOUND', 404, {}],
    ['SERVER_ERROR', 500, {}],
  ] as const)('passes through %s', async (code, status, meta) => {
    const { api } = setup([json(status, { error: { code, message: 'm', requestId: 'r', meta } })]);
    const e = await caught(api.getVisit('v1'));
    expect(e.code).toBe(code);
    expect(e.meta).toEqual(meta);
  });

  it.each([
    [401, 'UNAUTHENTICATED'], [403, 'FORBIDDEN'], [404, 'NOT_FOUND'], [409, 'VERSION_CONFLICT'], [422, 'VALIDATION_FAILED'],
    [413, 'VALIDATION_FAILED'], [429, 'DOMAIN_RULE'], [502, 'NETWORK_UNAVAILABLE'], [503, 'NETWORK_UNAVAILABLE'], [500, 'SERVER_ERROR'],
  ] as const)('falls back by status %i when the body has no known code', async (status, code) => {
    const res = new Response('<html>bad gateway</html>', { status, headers: { 'X-Request-Id': 'req_hdr' } });
    const e = await toApiErrorFromResponse(res);
    expect(e.code).toBe(code);
    expect(e.requestId).toBe('req_hdr');
  });

  it('maps an unknown server code by HTTP status', async () => {
    const e = await toApiErrorFromResponse(json(409, { error: { code: 'SOMETHING_NEW', message: 'x' } }));
    expect(e.code).toBe('VERSION_CONFLICT');
    expect(e.message).toBe('x');
  });

  it('adds a file field error for 413 from the proxy', async () => {
    const e = await toApiErrorFromResponse(new Response('', { status: 413 }));
    expect(e.fields.file).toMatch(/larger than/);
  });

  it('maps a fetch failure to NETWORK_UNAVAILABLE', async () => {
    const { api } = setup([new TypeError('Failed to fetch'), new TypeError('Failed to fetch')]);
    const e = await caught(api.getVisit('v1'));
    expect(e.code).toBe('NETWORK_UNAVAILABLE');
    expect(e.httpStatus).toBe(0);
  });
});

/* ---------------- headers ---------------- */

describe('headers', () => {
  it('sends credentials: include and X-Requested-With on reads', async () => {
    const { api, calls } = setup([json(200, { data: [] })]);
    await api.getQcQueue();
    expect(calls[0]!.init.credentials).toBe('include');
    expect(calls[0]!.headers.get('X-Requested-With')).toBe('kpmpl-web');
    expect(calls[0]!.headers.get('Accept')).toBe('application/json');
    expect(calls[0]!.headers.get('Idempotency-Key')).toBeNull();
    expect(calls[0]!.headers.get('If-Match')).toBeNull();
  });

  it('sends Idempotency-Key and If-Match (integer version) on versioned writes', async () => {
    const { api, calls } = setup([json(200, { data: visit })]);
    await api.recordTare('v1', { value: '4000.000' }, { idempotencyKey: 'key-123', expectedVersion: 7 });
    const c = calls[0]!;
    expect(c.url).toBe('/api/v1/receiving-visits/v1/weighments');
    expect(c.init.method).toBe('POST');
    expect(c.headers.get('Idempotency-Key')).toBe('key-123');
    expect(c.headers.get('If-Match')).toBe('7');
    expect(c.headers.get('Content-Type')).toBe('application/json');
    expect(c.headers.get('X-Requested-With')).toBe('kpmpl-web');
    expect(JSON.parse(bodyText(c))).toEqual({ kind: 'tare', value: '4000.000', unit: 'kg' });
  });

  it('sends Idempotency-Key without If-Match on creates', async () => {
    const { api, calls } = setup([json(201, { data: visit })]);
    await api.createVisit({ officialGateEntryRef: '0008-HO', vehicleNumber: 'V', supplierDisplayName: 'S', materialDisplayName: 'M', grossWeight: { value: '15000.000', unit: 'kg' } }, { idempotencyKey: 'create-1' });
    expect(calls[0]!.headers.get('Idempotency-Key')).toBe('create-1');
    expect(calls[0]!.headers.get('If-Match')).toBeNull();
    expect(bodyText(calls[0]!)).toContain('"value":"15000.000"');
    expect(bodyText(calls[0]!)).toContain('"officialGateEntryRef":"0008-HO"');
  });

  it('QC decision posts to /qc-inspections/{inspectionId}/decisions with the VISIT version', async () => {
    const { api, calls } = setup([
      json(200, { data: [{ inspectionId: 'insp-9', visitId: 'v1' }] }),
      json(200, { data: { inspectionId: 'insp-9' } }),
    ]);
    await api.decideQc('v1', { outcome: 'accepted', reason: '' }, { idempotencyKey: 'rk', expectedVersion: 5 });
    expect(calls[1]!.url).toBe('/api/v1/qc-inspections/insp-9/decisions');
    expect(calls[1]!.headers.get('If-Match')).toBe('5');
  });

  it('routes Plant Head approval through the document-authority endpoint', async () => {
    const { api, calls } = setup([json(200, { data: { id: 'p1' } })]);
    await api.recordErpMilestone('p1', {
      type: 'plant_head_grn_approval', action: 'confirm', dataManRef: 'GRN-1', verifiedInDataManByStaff: true,
    }, { idempotencyKey: 'erp-1', expectedVersion: 6 });
    expect(calls[0]!.url).toBe('/api/v1/document-packages/p1/erp-milestones/plant-head-approval');
    expect(calls[0]!.headers.get('If-Match')).toBe('6');
  });

  it('keeps later ERP milestones on the Head Office endpoint', async () => {
    const { api, calls } = setup([json(200, { data: { id: 'p1' } })]);
    await api.recordErpMilestone('p1', {
      type: 'purchase_voucher', action: 'confirm', dataManRef: 'PV-1', verifiedInDataManByStaff: true,
    }, { idempotencyKey: 'erp-2', expectedVersion: 7 });
    expect(calls[0]!.url).toBe('/api/v1/head-office/cases/p1/erp-milestones');
  });

  it('does not send Idempotency-Key on login or logout', async () => {
    const { api, calls } = setup([json(200, { data: { id: 'u' } }), new Response(null, { status: 204 })]);
    await api.login('demo-gate', 'pw');
    await api.logout();
    expect(calls[0]!.headers.get('Idempotency-Key')).toBeNull();
    expect(calls[1]!.headers.get('Idempotency-Key')).toBeNull();
    expect(JSON.parse(bodyText(calls[0]!))).toEqual({ username: 'demo-gate', password: 'pw' });
  });
});

/* ---------------- idempotency key ---------------- */

describe('idempotency key', () => {
  it('generates a UUID v4 when the caller passes an empty key', async () => {
    const { api, calls } = setup([json(200, { data: { temporaryPassword: 'T' } })]);
    await api.adminResetPassword('u1', { idempotencyKey: '' });
    expect(calls[0]!.url).toBe('/api/v1/admin/users/u1/reset-password');
    expect(calls[0]!.headers.get('Idempotency-Key')).toMatch(UUID);
  });

  it('uses crypto.randomUUID format when the caller omits the key', async () => {
    const { api, calls } = setup([json(200, { data: { id: 'u1' } })]);
    // updateUser with an undefined key simulates a caller that has none
    await api.updateUser('u1', { active: false }, { idempotencyKey: undefined as unknown as string });
    expect(calls[0]!.headers.get('Idempotency-Key')).toMatch(UUID);
    expect(calls[0]!.init.method).toBe('PATCH');
  });

  it('reuses the caller key unchanged on a manual retry', async () => {
    const { api, calls } = setup([new TypeError('offline'), json(200, { data: visit })]);
    const opts = { idempotencyKey: 'same-key', expectedVersion: 2 };
    await expect(api.recordExit('v1', { physicalExitAt: '2026-11-02T06:27:00.000Z', millChecksConfirmed: true }, opts)).rejects.toMatchObject({ code: 'NETWORK_UNAVAILABLE' });
    await api.recordExit('v1', { physicalExitAt: '2026-11-02T06:27:00.000Z', millChecksConfirmed: true }, opts);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.headers.get('Idempotency-Key')).toBe('same-key');
    expect(calls[1]!.headers.get('Idempotency-Key')).toBe('same-key');
  });
});

/* ---------------- retries ---------------- */

describe('retries', () => {
  it('retries a GET once after a network failure', async () => {
    const { api, fetchMock } = setup([new TypeError('reset'), json(200, { data: [] })]);
    await expect(api.getQcQueue()).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('never retries a write automatically', async () => {
    const { api, fetchMock } = setup([new TypeError('reset')]);
    await expect(api.packageAction('p1', { kind: 'mark_ready' }, { idempotencyKey: 'k', expectedVersion: 1 })).rejects.toMatchObject({ code: 'NETWORK_UNAVAILABLE' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry an HTTP error response', async () => {
    const { api, fetchMock } = setup([json(500, { error: { code: 'SERVER_ERROR', message: 'Something went wrong. Nothing was saved.' } })]);
    await expect(api.getQcQueue()).rejects.toMatchObject({ code: 'SERVER_ERROR' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

/* ---------------- multipart, files, CSV ---------------- */

describe('files and CSV', () => {
  it('uploads multipart FormData with category and file, no JSON content type', async () => {
    const { api, calls } = setup([json(200, { data: { id: 'p1' } })]);
    const file = new File(['%PDF-1.4 demo'], 'DEMO-invoice.pdf', { type: 'application/pdf' });
    await api.attachFile('p1', { category: 'supplier_invoice', file }, { idempotencyKey: 'up-1', expectedVersion: 3 });
    const c = calls[0]!;
    expect(c.url).toBe('/api/v1/document-packages/p1/files');
    expect(c.init.body).toBeInstanceOf(FormData);
    const fd = c.init.body as FormData;
    expect(fd.get('category')).toBe('supplier_invoice');
    const sent = fd.get('file');
    expect(sent).toBeInstanceOf(File);
    expect((sent as File).name).toBe('DEMO-invoice.pdf');
    expect(c.headers.get('Content-Type')).toBeNull();
    expect(c.headers.get('Idempotency-Key')).toBe('up-1');
    expect(c.headers.get('If-Match')).toBe('3');
  });

  it('builds the file content URL from the base URL', () => {
    const { api } = setup([]);
    expect(api.fileContentUrl('f 1')).toBe('/api/v1/document-files/f%201/content');
  });

  it('removes a file with DELETE ?category= and versioned headers', async () => {
    const { api, calls } = setup([json(200, { data: { id: 'p1' } })]);
    await api.removeFile('p1', 'qc_slip', 'f1', { idempotencyKey: 'rm', expectedVersion: 4 });
    expect(calls[0]!.init.method).toBe('DELETE');
    expect(calls[0]!.url).toBe('/api/v1/document-packages/p1/files/f1?category=qc_slip');
    expect(calls[0]!.headers.get('If-Match')).toBe('4');
  });

  it('downloads the server CSV with its filename', async () => {
    const { api, calls } = setup([
      new Response('\uFEFFGate Entry No.\r\n0008-HO', { status: 200, headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="kpmpl-receiving-2026-11-02.csv"' } }),
    ]);
    const out = await api.exportReceivingCsv({ from: '2026-11-01' });
    expect(calls[0]!.url).toBe('/api/v1/reports/receiving.csv?from=2026-11-01');
    expect(calls[0]!.headers.get('Accept')).toBe('text/csv');
    expect(out.filename).toBe('kpmpl-receiving-2026-11-02.csv');
    expect(await out.blob.text()).toContain('0008-HO');
  });
});

/* ---------------- 401 handling ---------------- */

describe('401 handling', () => {
  it('signals session expiry on a 401 from a normal call', async () => {
    const { api, onSessionExpired } = setup([json(401, { error: { code: 'UNAUTHENTICATED', message: 'Please sign in.' } })]);
    await expect(api.getOverview()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
  });

  it('does not signal expiry for a failed login', async () => {
    const { api, onSessionExpired } = setup([json(401, { error: { code: 'UNAUTHENTICATED', message: 'Username or password is incorrect.' } })]);
    await expect(api.login('x', 'y')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(onSessionExpired).not.toHaveBeenCalled();
  });

  it('me() returns null on 401 without signalling expiry', async () => {
    const { api, onSessionExpired } = setup([json(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } })]);
    await expect(api.me()).resolves.toBeNull();
    expect(onSessionExpired).not.toHaveBeenCalled();
  });

  it('change-password 401 with a live session becomes a currentPassword field error', async () => {
    const { api, onSessionExpired } = setup([
      json(401, { error: { code: 'UNAUTHENTICATED', message: 'x', requestId: 'r1' } }),
      json(200, { data: { id: 'u1' } }),
    ]);
    const e = await caught(api.changePassword({ currentPassword: 'a', newPassword: 'bbbbbbbbbbbb' }, { idempotencyKey: 'cp' }));
    expect(e.code).toBe('VALIDATION_FAILED');
    expect(e.fields.currentPassword).toBeTruthy();
    expect(onSessionExpired).not.toHaveBeenCalled();
  });

  it('change-password 401 with a dead session signals expiry', async () => {
    const { api, onSessionExpired } = setup([
      json(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } }),
      json(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } }),
    ]);
    await expect(api.changePassword({ currentPassword: 'a', newPassword: 'bbbbbbbbbbbb' }, { idempotencyKey: 'cp' })).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
  });
});

/* ---------------- timeout ---------------- */

describe('timeout', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const hang = (c: Captured) =>
    new Promise<Response>((_, reject) => {
      c.init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    });

  it('aborts a write after the timeout, marks it as a timeout and does not retry', async () => {
    const { api, fetchMock } = setup([hang], { timeoutMs: 1000 });
    const p = caught(api.packageAction('p1', { kind: 'verify' }, { idempotencyKey: 'k', expectedVersion: 1 }));
    await vi.advanceTimersByTimeAsync(1001);
    const e = await p;
    expect(e.code).toBe('NETWORK_UNAVAILABLE');
    expect(e.meta.timeout).toBe(true);
    expect(e.message).toMatch(/safe to repeat/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('aborts a read after the timeout without retrying', async () => {
    const { api, fetchMock } = setup([hang], { timeoutMs: 500 });
    const p = caught(api.getOverview());
    await vi.advanceTimersByTimeAsync(501);
    const e = await p;
    expect(e.meta.timeout).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
