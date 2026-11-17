import type { ApiError } from '../../api';
import type { ErpGateEntry, ErpWeight } from '../../domain/types';

/**
 * Pure presentation rules for the DataMan ERP views (Phase 05A).
 * Kept free of React and of the api adapter so they can be unit-tested in the
 * project's node test environment.
 */

/**
 * An ERP outage must never be presented as a legitimate empty result.
 * 503 is the ERP_UNAVAILABLE contract; NETWORK_UNAVAILABLE means the request never
 * got an answer (timeout / transport failure). Both are outages, not "no records".
 */
export function isErpOutage(e: ApiError): boolean {
  return e.httpStatus === 503 || e.code === 'NETWORK_UNAVAILABLE';
}

/** ERP recorded weight, or an explicit dash when the weighment row is absent. */
export function weightText(w: ErpWeight | null): string {
  return w ? `${w.value} ${w.unit}` : '—';
}

/** Weighment status label; absence is a state, never a zero weight. */
export function weighmentLabel(e: Pick<ErpGateEntry, 'hasWeighment'>): 'Recorded' | 'None' {
  return e.hasWeighment ? 'Recorded' : 'None';
}

/** GRN status label: the ERP approval status when a PChallan row exists. */
export function grnLabel(e: Pick<ErpGateEntry, 'hasGrn' | 'grnApprovalStatus'>): string {
  if (!e.hasGrn) return 'None';
  return e.grnApprovalStatus ?? 'Recorded';
}

/**
 * Which empty-state wording applies. Filters produce a different message from an
 * genuinely empty ERP table, and an outage must not reach this function at all.
 */
export function emptyListTitle(docId: string, vType: string): string {
  return docId || vType ? 'No gate entries match these filters.' : 'No gate entries in ERP.';
}

/** Only fields the backend reported as present may be claimed as available. */
export function reportedFields(e: Pick<ErpGateEntry, 'fieldsAvailable'>): string {
  return e.fieldsAvailable.join(', ');
}
