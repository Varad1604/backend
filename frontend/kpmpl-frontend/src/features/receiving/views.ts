import type { VisitListQuery } from '../../domain/types';
import { QC_OPEN_STATES, QC_RESULT_STATES } from '../../domain/status';

/**
 * Gate work views. Each maps to server-side filters on the three independent
 * status fields — nothing here invents a combined status.
 */
export const gateViews = {
  all: { label: 'All', query: {}, hint: '' },
  awaiting_qc: { label: 'Waiting for QC', query: { qcStatus: QC_OPEN_STATES }, hint: 'QC readings not submitted' },
  qc_returned: { label: 'Returned by QC', query: { qcStatus: ['returned'] }, hint: 'Sent back to QC for correction' },
  ready_follow_up: { label: 'Ready for tare or exit', query: { qcStatus: QC_RESULT_STATES, exitStatus: 'on_premises' }, hint: 'QC done, truck still inside' },
  exited_grn_pending: { label: 'Out, no GRN', query: { exitStatus: 'exited', grnStatus: 'not_recorded' }, hint: 'Truck left, GRN No. not entered' },
} satisfies Record<string, { label: string; query: VisitListQuery; hint: string }>;

export type GateViewKey = keyof typeof gateViews;
export const isGateViewKey = (k: string | null): k is GateViewKey => !!k && k in gateViews;
