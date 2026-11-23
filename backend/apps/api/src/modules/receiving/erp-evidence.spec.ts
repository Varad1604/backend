import { describe, expect, it } from 'vitest';
import { createVisitSchema } from './receiving.schemas';

const sample = {
  officialGateEntryRef: '17110013',
  vehicleNumber: 'MH15JC1667',
  supplierDisplayName: 'Supplier',
  materialDisplayName: 'Waste Paper',
  grossWeight: { value: '16420.000', unit: 'kg' },
};

describe('receiving ERP provenance input validation', () => {
  it('accepts legacy receiving inputs without new evidence', () => {
    expect(createVisitSchema.safeParse(sample).success).toBe(true);
  });
  it('accepts selected DataMan DocId with a lookup timestamp (not asserting server verification)', () => {
    const parsed = createVisitSchema.safeParse({ ...sample, erpEvidence: {
      gateNo: sample.officialGateEntryRef, year: 2026,
      docId: 'DHOGate 2026 6450', fetchedAt: '2026-11-18T07:30:00.000Z',
    } });
    expect(parsed.success).toBe(true);
  });
  it('requires lookup timestamp whenever a full document id is supplied', () => {
    const parsed = createVisitSchema.safeParse({ ...sample, erpEvidence: {
      gateNo: sample.officialGateEntryRef, year: 2026, docId: 'DHOGate 2026 6450',
    } });
    expect(parsed.success).toBe(false);
  });
  it('requires a reason for an ERP outage fallback without a source document', () => {
    const parsed = createVisitSchema.safeParse({ ...sample, erpEvidence: {
      gateNo: sample.officialGateEntryRef, year: 2026,
    } });
    expect(parsed.success).toBe(false);
    expect(createVisitSchema.safeParse({ ...sample, erpEvidence: {
      gateNo: sample.officialGateEntryRef, year: 2026, manualReason: 'VPN temporarily unavailable',
    } }).success).toBe(true);
  });
  it('rejects mismatched reference, bad year and forbidden client-supplied verification', () => {
    expect(createVisitSchema.safeParse({ ...sample, erpEvidence: {
      gateNo: '17110014', year: 2026, manualReason: 'VPN unavailable',
    } }).success).toBe(false);
    expect(createVisitSchema.safeParse({ ...sample, erpEvidence: {
      gateNo: sample.officialGateEntryRef, year: 1999, manualReason: 'VPN unavailable',
    } }).success).toBe(false);
    expect(createVisitSchema.safeParse({ ...sample, erpEvidence: {
      gateNo: sample.officialGateEntryRef, year: 2026, manualReason: 'VPN unavailable',
      verification: 'server_verified',
    } }).success).toBe(false);
  });
});
