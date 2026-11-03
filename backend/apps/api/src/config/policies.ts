export const backendPolicies = Object.freeze({
  gateEntryUniqueScope: { value: 'global', decision: 'D-01/D-11/KPM-X-003', status: 'pending' },
  qcDeductionCalculation: { value: 'not_configured', decision: 'D-02', status: 'pending' },
  // D-03 decided by KPMPL on 2026-11-03: the QC operator records readings and makes the final QC decision.
  qcDecisionBy: { value: 'qc_operator', decision: 'D-03', status: 'decided' },
  exitRequires: { value: ['tare', 'qc_readings_submitted', 'mill_checks_confirmed'], decision: 'D-04', status: 'pending' },
  documentChecklist: { value: 'demo-checklist-0', decision: 'D-05', status: 'not_approved' },
  reminderChannel: { value: 'in_app_log_only', decision: 'D-09', status: 'pending' },
  weightPrecision: { value: 'kg_3_decimal_places', decision: 'D-12', status: 'pending' },
});
