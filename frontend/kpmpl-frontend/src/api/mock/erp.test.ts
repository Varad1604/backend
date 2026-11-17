import { describe, expect, it } from 'vitest';
import { api } from '../index';
import { ApiError } from '../errors';
import { MOCK_DEMO_PASSWORD } from '../../auth/demoAccounts';

/**
 * Phase 05A — the demo adapter's ERP reads enforce the same rules as the backend:
 * `erp.read` is required, pagination is server-side, and a missing weighment/GRN is a
 * state (empty arrays, null weights) rather than an error or a zero.
 * Demo fixtures only — not live ERP data.
 */

describe('ERP reads in the demo adapter', () => {
  it('refuses a signed-in user without erp.read', async () => {
    await api.login('demo-gate', MOCK_DEMO_PASSWORD);
    await expect(api.listErpGateEntries({ page: 1 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(api.getErpGateEntry('DEMO-GATE-1001')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('allows Head Office and paginates on the server', async () => {
    await api.login('demo-ho', MOCK_DEMO_PASSWORD);
    const page = await api.listErpGateEntries({ page: 1, limit: 2 });
    expect(page.total).toBe(4);
    expect(page.totalPages).toBe(2);
    expect(page.data).toHaveLength(2);
    const second = await api.listErpGateEntries({ page: 2, limit: 2 });
    expect(second.data).toHaveLength(2);
    expect(second.data[0]!.docId).not.toBe(page.data[0]!.docId);
  });

  it('reports a gate entry with no weighment as null weights, not zero', async () => {
    await api.login('demo-ho', MOCK_DEMO_PASSWORD);
    const d = await api.getErpGateEntry('DEMO-GATE-1003');
    expect(d.hasWeighment).toBe(false);
    expect(d.grossWeight).toBeNull();
    expect(d.tareWeight).toBeNull();
    expect(d.netWeight).toBeNull();
    expect(d.weighments).toEqual([]);
  });

  it('reports a gate entry with no GRN as hasGrn false', async () => {
    await api.login('demo-ho', MOCK_DEMO_PASSWORD);
    const d = await api.getErpGateEntry('DEMO-GATE-1002');
    expect(d.hasGrn).toBe(false);
    expect(d.grns).toEqual([]);
    expect(d.hasWeighment).toBe(true);
  });

  it('returns every related weighment and GRN row', async () => {
    await api.login('demo-ho', MOCK_DEMO_PASSWORD);
    const d = await api.getErpGateEntry('DEMO-GATE-1004');
    expect(d.weighments).toHaveLength(2);
    expect(d.grns).toHaveLength(2);
  });

  it('raises NOT_FOUND for an unknown DocId', async () => {
    await api.login('demo-ho', MOCK_DEMO_PASSWORD);
    const err: unknown = await api.getErpGateEntry('NOPE').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('NOT_FOUND');
    expect((err as ApiError).httpStatus).toBe(404);
  });

  it('filters by exact DocId and returns an empty page (not an error) when nothing matches', async () => {
    await api.login('demo-ho', MOCK_DEMO_PASSWORD);
    const hit = await api.listErpGateEntries({ docId: 'DEMO-GATE-1002' });
    expect(hit.data.map((e) => e.docId)).toEqual(['DEMO-GATE-1002']);
    const miss = await api.listErpGateEntries({ docId: 'NOPE-123' });
    expect(miss.total).toBe(0);
    expect(miss.data).toEqual([]);
  });

  it('filters by exact V_Type against the related GRN rows', async () => {
    await api.login('demo-ho', MOCK_DEMO_PASSWORD);
    const pchlg = await api.listErpGateEntries({ vType: 'PCHLG' });
    expect(pchlg.data.every((e) => e.hasGrn)).toBe(true);
    const none = await api.listErpGateEntries({ vType: 'NOT-A-TYPE' });
    expect(none.total).toBe(0);
  });
});
