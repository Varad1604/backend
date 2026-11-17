import { describe, it, expect } from 'vitest';
import { ApiError } from '../../api';
import type { ErpGateEntry } from '../../domain/types';
import { emptyListTitle, grnLabel, isErpOutage, reportedFields, weighmentLabel, weightText } from './erpView';

/**
 * Phase 05A — presentation rules for the ERP views, driven by fixtures that match the
 * accepted backend DTO shape (kg weights, nullable weighment/GRN, fieldsAvailable).
 * These are contract-consistent fixtures, NOT live ERP data.
 */

const entry = (over: Partial<ErpGateEntry> = {}): ErpGateEntry => ({
  docId: 'DEMO-GATE-1001',
  vType: 'GRN',
  vNo: 'V-1001',
  vDate: '2026-11-10T00:00:00.000Z',
  vTime: '1900-01-01T09:15:00.000Z',
  partyCode: 'P-100',
  vehicleNo: 'MH-14-AB-1001',
  gateOutDate: '2026-11-10T11:20:00.000Z',
  grossWeight: { value: '18420.500', unit: 'kg' },
  tareWeight: { value: '6120.250', unit: 'kg' },
  netWeight: { value: '12300.250', unit: 'kg' },
  hasWeighment: true,
  hasGrn: true,
  grnDate: '2026-11-10T00:00:00.000Z',
  grnApprovalStatus: 'APPROVED',
  fieldsAvailable: ['docId', 'grossWeight', 'tareWeight', 'netWeight'],
  ...over,
});

describe('isErpOutage — an outage is never an empty result', () => {
  it('treats the 503 ERP_UNAVAILABLE contract as an outage', () => {
    expect(isErpOutage(new ApiError('SERVER_ERROR', 'ERP data source temporarily unavailable.', 503))).toBe(true);
  });

  it('treats a transport failure / timeout as an outage', () => {
    expect(isErpOutage(new ApiError('NETWORK_UNAVAILABLE', 'The server could not be reached.', 0))).toBe(true);
  });

  it('does not treat a missing gate entry (404) as an outage', () => {
    expect(isErpOutage(new ApiError('NOT_FOUND', 'Gate entry with DocId "X" not found in ERP.', 404))).toBe(false);
  });

  it('does not treat a permission refusal (403) as an outage', () => {
    expect(isErpOutage(new ApiError('FORBIDDEN', 'Your account does not have permission for this action.', 403))).toBe(false);
  });
});

describe('weightText — display only, never recomputed', () => {
  it('renders the ERP value with its kg unit', () => {
    expect(weightText({ value: '18420.500', unit: 'kg' })).toBe('18420.500 kg');
  });

  it('renders a dash when the weighment row is absent', () => {
    expect(weightText(null)).toBe('—');
  });

  it('does not derive net weight from gross and tare', () => {
    const e = entry({ netWeight: null });
    expect(weightText(e.netWeight)).toBe('—');
    expect(e.grossWeight?.value).toBe('18420.500');
    expect(e.tareWeight?.value).toBe('6120.250');
  });
});

describe('weighment and GRN states', () => {
  it('reports a recorded weighment', () => {
    expect(weighmentLabel(entry())).toBe('Recorded');
  });

  it('reports a gate entry with no weighment as None, not as zero weight', () => {
    const e = entry({ hasWeighment: false, grossWeight: null, tareWeight: null, netWeight: null });
    expect(weighmentLabel(e)).toBe('None');
    expect(weightText(e.grossWeight)).toBe('—');
  });

  it('reports the ERP approval status when a GRN exists', () => {
    expect(grnLabel(entry())).toBe('APPROVED');
    expect(grnLabel(entry({ grnApprovalStatus: 'PENDING' }))).toBe('PENDING');
  });

  it('reports a gate entry with no GRN as None', () => {
    const e = entry({ hasGrn: false, grnDate: null, grnApprovalStatus: null });
    expect(grnLabel(e)).toBe('None');
  });

  it('falls back to Recorded when ERP returns a GRN row without an approval status', () => {
    expect(grnLabel(entry({ grnApprovalStatus: null }))).toBe('Recorded');
  });
});

describe('empty states distinguish filters from an empty ERP', () => {
  it('says filters matched nothing when filters are applied', () => {
    expect(emptyListTitle('GI-1', '')).toBe('No gate entries match these filters.');
    expect(emptyListTitle('', 'PCHLG')).toBe('No gate entries match these filters.');
  });

  it('says the ERP has no gate entries when no filters are applied', () => {
    expect(emptyListTitle('', '')).toBe('No gate entries in ERP.');
  });
});

describe('reportedFields', () => {
  it('lists only the fields the backend reported as available', () => {
    expect(reportedFields(entry())).toBe('docId, grossWeight, tareWeight, netWeight');
  });
});
