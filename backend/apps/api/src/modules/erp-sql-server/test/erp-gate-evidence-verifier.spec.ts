import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErpGateEvidenceVerifier } from '../erp-gate-evidence-verifier';
import type { CreateVisitInput } from '../../receiving/receiving.schemas';

const input: CreateVisitInput = {
  officialGateEntryRef: '17110013', vehicleNumber: 'MH15JC1667',
  supplierDisplayName: 'Supplier', materialDisplayName: 'Material',
  grossWeight: { value: '16420.000', unit: 'kg' },
  erpEvidence: { gateNo: '17110013', year: 2026, docId: 'DHOGate 2026 6450',
    fetchedAt: '2026-11-18T07:30:00.000Z' },
};
const row = (over: Record<string, unknown> = {}) => ({
  DocId: 'DHOGate 2026 6450', V_No: '17110013', VehicleNo: 'MH15JC1667',
  grossWeight: 16.42, grnUnit: 'MT', ...over,
});
const setup = () => {
  const executeQuery = vi.fn().mockResolvedValue([row()]);
  const executeScalar = vi.fn().mockResolvedValue(1);
  return { verifier: new ErpGateEvidenceVerifier({ executeQuery, executeScalar } as any), executeQuery, executeScalar };
};
let originalHost: string | undefined;
let originalPassword: string | undefined;
beforeEach(() => {
  originalHost = process.env.ERP_HOST; originalPassword = process.env.ERP_PASSWORD;
  process.env.ERP_HOST = 'read-only-test-host'; process.env.ERP_PASSWORD = 'fake-test-only';
});
afterEach(() => {
  if (originalHost === undefined) delete process.env.ERP_HOST; else process.env.ERP_HOST = originalHost;
  if (originalPassword === undefined) delete process.env.ERP_PASSWORD; else process.env.ERP_PASSWORD = originalPassword;
});
describe('server-side DataMan gate evidence verification (SELECT-only)', () => {
  it('verifies full DocId/year/gate number, vehicle, kg and binds SQL params', async () => {
    const t = setup();
    const evidence = await t.verifier.verify(input);
    expect(evidence?.verification).toBe('server_verified');
    const [sql, args] = t.executeQuery.mock.calls[0]!;
    expect(sql).toContain('g.DocId = @docId AND g.V_No = @gateNo');
    expect(sql).not.toMatch(/\b(?:UPDATE|DELETE|INSERT|MERGE|DROP)\b/i);
    expect(args).toEqual([
      { name: 'docId', type: 'VarChar', value: 'DHOGate 2026 6450' },
      { name: 'gateNo', type: 'VarChar', value: '17110013' },
      { name: 'fromDate', type: 'VarChar', value: '2026-01-01' },
      { name: 'toDate', type: 'VarChar', value: '2027-01-01' },
    ]);
  });
  it('rejects mismatched or ambiguous identity', async () => {
    const t = setup(); t.executeQuery.mockResolvedValueOnce([]);
    await expect(t.verifier.verify(input)).rejects.toMatchObject({ status: 422 });
    t.executeQuery.mockResolvedValueOnce([row(),row()]);
    await expect(t.verifier.verify(input)).rejects.toMatchObject({ status: 422 });
  });
  it('rejects changes in vehicle and gross weight after browser selection', async () => {
    const t = setup(); t.executeQuery.mockResolvedValueOnce([row({ VehicleNo: 'MH20EK6018' })]);
    await expect(t.verifier.verify(input)).rejects.toMatchObject({ status: 422 });
    t.executeQuery.mockResolvedValueOnce([row({ grossWeight: 16.43 })]);
    await expect(t.verifier.verify(input)).rejects.toMatchObject({ status: 422 });
  });
  it('requires a manual exception reason if source unit is unknown', async () => {
    const t = setup(); t.executeQuery.mockResolvedValueOnce([row({ grnUnit: null })]);
    await expect(t.verifier.verify(input)).rejects.toMatchObject({ status: 422 });
    t.executeQuery.mockResolvedValueOnce([row({ grnUnit: null })]);
    const evidence = await t.verifier.verify({ ...input, erpEvidence: { ...input.erpEvidence!, manualReason: 'Unverified weight unit' } });
    expect(evidence?.verification).toBe('server_verified');
  });
  it('manual outage is refused when ERP is actually available', async () => {
    const t = setup(); await expect(t.verifier.verify({
      ...input, erpEvidence: { gateNo: '17110013', year: 2026, manualReason: 'VPN offline observed' },
    })).rejects.toMatchObject({ status: 422 });
  });
  it('manual exception permitted on real connection outage only', async () => {
    const t = setup(); t.executeScalar.mockRejectedValueOnce(Object.assign(new Error('Request timed out'),{code:'ETIMEOUT'}));
    const evidence = await t.verifier.verify({
      ...input, erpEvidence: { gateNo: '17110013', year: 2026, manualReason: 'VPN offline observed' },
    });
    expect(evidence?.verification).toBe('manual_exception');
  });
  it('forbids manual exception for query/configuration/auth errors', async () => {
    const t = setup(); t.executeScalar.mockRejectedValueOnce(Object.assign(new Error('Invalid column'),{code:'EREQUEST'}));
    await expect(t.verifier.verify({ ...input, erpEvidence: { gateNo: '17110013', year: 2026, manualReason: 'VPN offline observed' } })).rejects.toMatchObject({ status: 500 });
    delete process.env.ERP_PASSWORD;
    await expect(t.verifier.verify(input)).rejects.toMatchObject({ status: 500 });
  });
});
