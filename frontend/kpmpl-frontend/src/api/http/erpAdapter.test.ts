import { describe, expect, it, vi } from 'vitest';
import { createHttpAdapter } from './httpAdapter';
import { ApiError } from '../errors';
import { isErpOutage } from '../../features/erp/erpView';

/**
 * Phase 05A — route/contract tests for the DataMan ERP read-only adapter calls.
 * These assert the wire contract the backend controller actually implements
 * (paths, query names, meta-based pagination, standard error envelope). They use a
 * stubbed transport: they are NOT live ERP integration tests.
 */

interface Captured { url: string; init: RequestInit }

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function setup(responses: (Response | Error)[]) {
  const calls: Captured[] = [];
  const queue = [...responses];
  const fetchMock = vi.fn(async (url: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: typeof url === 'string' ? url : url instanceof URL ? url.href : url.url, init });
    const next = queue.shift();
    if (next === undefined) throw new Error('unexpected fetch');
    if (next instanceof Error) throw next;
    return next;
  });
  const api = createHttpAdapter({
    baseUrl: '/api/v1/',
    timeoutMs: 5000,
    fetch: fetchMock,
    onSessionExpired: vi.fn(),
    retryDelayMs: 0,
  });
  return { api, calls };
}

async function caught(p: Promise<unknown>): Promise<ApiError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ApiError) return e;
    throw e;
  }
  throw new Error('expected an ApiError');
}

/** Exactly what ErpSqlServerController returns for a 200 list. */
const listBody = {
  data: [
    {
      docId: 'DEMO-GATE-1001', vType: 'GRN', vNo: 'V-1001', vDate: '2026-11-10T00:00:00.000Z',
      vTime: '1900-01-01T09:15:00.000Z', partyCode: 'P-100', vehicleNo: 'MH-14-AB-1001',
      gateOutDate: '2026-11-10T11:20:00.000Z',
      grossWeight: { value: '18420.500', unit: 'kg' },
      tareWeight: { value: '6120.250', unit: 'kg' },
      netWeight: { value: '12300.250', unit: 'kg' },
      hasWeighment: true, hasGrn: true, grnDate: '2026-11-10T00:00:00.000Z', grnApprovalStatus: 'APPROVED',
      fieldsAvailable: ['docId', 'vType', 'vNo', 'vDate', 'vTime', 'partyCode', 'vehicleNo', 'gateOutDate'],
    },
  ],
  meta: { source: 'erp.sql.server.gate-entries.list', total: 41, page: 2, limit: 20, totalPages: 3, retrievedAt: '2026-11-16T18:00:00.000Z' },
};

describe('GET /erp/gate-entries — list contract', () => {
  it('calls the accepted path with the documented query names and reads meta pagination', async () => {
    const { api, calls } = setup([json(200, listBody)]);
    const page = await api.listErpGateEntries({ page: 2, limit: 20, docId: 'DEMO-GATE-1001', vType: 'PCHLG' });

    expect(calls).toHaveLength(1);
    const url = new URL(calls[0]!.url, 'http://kpmpl.local');
    expect(url.pathname).toBe('/api/v1/erp/gate-entries');
    expect(url.searchParams.get('page')).toBe('2');
    expect(url.searchParams.get('limit')).toBe('20');
    expect(url.searchParams.get('docId')).toBe('DEMO-GATE-1001');
    expect(url.searchParams.get('vType')).toBe('PCHLG');
    expect(calls[0]!.init.method).toBe('GET');

    // Pagination lives in meta on the ERP endpoint; it must survive the adapter.
    expect(page.total).toBe(41);
    expect(page.page).toBe(2);
    expect(page.totalPages).toBe(3);
    expect(page.data[0]!.netWeight).toEqual({ value: '12300.250', unit: 'kg' });
  });

  it('omits empty filters rather than sending blank parameters', async () => {
    const { api, calls } = setup([json(200, { data: [], meta: { total: 0, page: 1, limit: 20, totalPages: 0 } })]);
    await api.listErpGateEntries({ page: 1, limit: 20, docId: undefined, vType: '' });
    const url = new URL(calls[0]!.url, 'http://kpmpl.local');
    expect(url.searchParams.has('docId')).toBe(false);
    expect(url.searchParams.has('vType')).toBe(false);
  });

  it('returns an empty page for a genuinely empty 200 without inventing records', async () => {
    const { api } = setup([json(200, { data: [], meta: { total: 0, page: 1, limit: 20, totalPages: 0 } })]);
    const page = await api.listErpGateEntries({ page: 1, limit: 20 });
    expect(page.data).toEqual([]);
    expect(page.total).toBe(0);
  });

  it('raises a 503 ERP outage instead of resolving with empty data', async () => {
    const { api } = setup([
      json(503, { error: { code: 'ERP_UNAVAILABLE', message: 'ERP data source temporarily unavailable.', meta: { retryable: true } } }),
    ]);
    const err = await caught(api.listErpGateEntries({ page: 1 }));
    expect(err.httpStatus).toBe(503);
    expect(isErpOutage(err)).toBe(true);
  });
});

describe('GET /erp/gate-entries/:docId — detail contract', () => {
  it('encodes the DocId and lifts fieldsAvailable/fieldsMissing out of meta', async () => {
    const { api, calls } = setup([
      json(200, {
        data: {
          docId: 'GI/2026 001', vType: 'GRN', vNo: 'V-9', vDate: null, vTime: null, partyCode: 'P-9',
          vehicleNo: null, gateOutDate: null,
          grossWeight: { value: '100.000', unit: 'kg' },
          tareWeight: null,
          netWeight: null,
          hasWeighment: true, hasGrn: false, grnDate: null, grnApprovalStatus: null,
          weighments: [{ weighmentDocId: 'W-1', weighSlipNo: null, grossWeight: { value: '100.000', unit: 'kg' }, tareWeight: null, netWeight: null, weighDate: null, weighDateOut: null }],
          grns: [],
        },
        meta: { source: 'erp.sql.server.gate-entry.read', fieldsAvailable: ['docId', 'vType'], fieldsMissing: ['vehicleNo'] },
      }),
    ]);

    const d = await api.getErpGateEntry('GI/2026 001');
    const url = new URL(calls[0]!.url, 'http://kpmpl.local');
    expect(url.pathname).toBe('/api/v1/erp/gate-entries/GI%2F2026%20001');
    expect(calls[0]!.init.method).toBe('GET');

    expect(d.fieldsAvailable).toEqual(['docId', 'vType']);
    expect(d.fieldsMissing).toEqual(['vehicleNo']);
    // No weighment-derived values are computed for missing columns.
    expect(d.tareWeight).toBeNull();
    expect(d.netWeight).toBeNull();
    expect(d.weighments).toHaveLength(1);
    expect(d.grns).toEqual([]);
  });

  it('raises NOT_FOUND for a DocId that is not in ERP', async () => {
    const { api } = setup([json(404, { error: { code: 'NOT_FOUND', message: 'Gate entry with DocId "X" not found in ERP.' } })]);
    const err = await caught(api.getErpGateEntry('X'));
    expect(err.code).toBe('NOT_FOUND');
    expect(err.httpStatus).toBe(404);
    expect(isErpOutage(err)).toBe(false);
  });

  it('raises a 503 ERP outage for the detail route too', async () => {
    const { api } = setup([json(503, { error: { code: 'ERP_UNAVAILABLE', message: 'ERP data source temporarily unavailable.' } })]);
    const err = await caught(api.getErpGateEntry('DEMO-GATE-1001'));
    expect(err.httpStatus).toBe(503);
    expect(isErpOutage(err)).toBe(true);
  });

  it('reports a transport failure as an outage, never as an empty detail', async () => {
    const { api } = setup([new TypeError('fetch failed')]);
    const err = await caught(api.getErpGateEntry('DEMO-GATE-1001'));
    expect(err.code).toBe('NETWORK_UNAVAILABLE');
    expect(isErpOutage(err)).toBe(true);
  });
});

describe('ERP reads are read-only', () => {
  it('issues GET only and sends no idempotency key or body', async () => {
    const { api, calls } = setup([
      json(200, { data: [], meta: { total: 0, page: 1, limit: 20, totalPages: 0 } }),
      json(200, { data: { docId: 'D', weighments: [], grns: [], fieldsAvailable: [] }, meta: {} }),
    ]);
    await api.listErpGateEntries({ page: 1 });
    await api.getErpGateEntry('D');
    for (const c of calls) {
      expect(c.init.method).toBe('GET');
      expect(c.init.body).toBeUndefined();
      expect(new Headers(c.init.headers).has('Idempotency-Key')).toBe(false);
    }
  });
});
