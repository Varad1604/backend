import type { AccountingStage, DocCategory, ErpMilestoneType, ExitStatus, GrnStatus, PackageStatus, QcStatus } from './types';

export type Tone = 'neutral' | 'info' | 'progress' | 'warning' | 'success' | 'danger';

export const qcStatusMeta: Record<QcStatus, { label: string; tone: Tone }> = {
  pending: { label: 'QC pending', tone: 'warning' },
  in_progress: { label: 'QC in progress', tone: 'progress' },
  submitted: { label: 'QC submitted', tone: 'info' }, // readings in; awaiting the QC Operator's decision
  returned: { label: 'QC returned', tone: 'danger' },
  accepted: { label: 'QC accepted', tone: 'success' },
  accepted_with_deduction: { label: 'QC accepted with deduction', tone: 'success' },
  rejected: { label: 'QC rejected', tone: 'danger' },
};

export const exitStatusMeta: Record<ExitStatus, { label: string; tone: Tone }> = {
  on_premises: { label: 'On premises', tone: 'neutral' },
  exited: { label: 'Exited', tone: 'success' },
};

export const grnStatusMeta: Record<GrnStatus, { label: string; tone: Tone }> = {
  not_recorded: { label: 'GRN pending', tone: 'neutral' },
  reference_recorded: { label: 'GRN recorded', tone: 'success' },
};

export const QC_OPEN_STATES: QcStatus[] = ['pending', 'in_progress'];
export const QC_RESULT_STATES: QcStatus[] = ['submitted', 'accepted', 'accepted_with_deduction', 'rejected'];


export const packageStatusMeta: Record<PackageStatus, { label: string; tone: Tone; owner: string }> = {
  draft: { label: 'Draft', tone: 'neutral', owner: 'Gate' },
  ready_for_gate_check: { label: 'Ready for checking', tone: 'warning', owner: 'Gate document authority' },
  submitted_to_ho: { label: 'Sent to Head Office', tone: 'info', owner: 'Head Office' },
  under_ho_review: { label: 'Under HO review', tone: 'progress', owner: 'Head Office' },
  correction_requested: { label: 'Correction requested', tone: 'danger', owner: 'Gate' },
  resubmitted: { label: 'Resubmitted to HO', tone: 'info', owner: 'Head Office' },
  verified: { label: 'Documents verified', tone: 'success', owner: 'Accounts' },
  // Accounting chain (upgrade 2026-11-03): HO → Accountant → Head Accountant → Bill Posted.
  with_accounting: { label: 'With Accounts', tone: 'progress', owner: 'Accountant' },
  with_head_accountant: { label: 'With Head Accountant', tone: 'progress', owner: 'Head Accountant' },
  accounting_approved: { label: 'Accounting approved', tone: 'info', owner: 'Head Accountant' },
  bill_posted: { label: 'Bill posted', tone: 'success', owner: '—' },
};

/** Candidate document rows from the domestic waste-paper sample. Not a mandatory list. */
export const docCategoryMeta: Record<DocCategory, { label: string; hint: string }> = {
  supplier_invoice: { label: 'Supplier tax invoice', hint: '' },
  factory_grn: { label: 'Factory GRN / goods receipt', hint: 'Print from DataMan after the GRN is made' },
  weighbridge_slip: { label: 'Weighbridge slips (gross & tare)', hint: 'One per truck' },
  qc_slip: { label: 'QC / moisture / rejection slip', hint: 'Whether needed is pending KPMPL confirmation' },
  supporting_bill: { label: 'Supplier supporting bill(s)', hint: 'If applicable. Pending KPMPL confirmation' },
  eway_bill: { label: 'E-way bill', hint: 'If applicable. Pending KPMPL confirmation' },
};
export const DOC_CATEGORIES = Object.keys(docCategoryMeta) as DocCategory[];

export const erpMilestoneMeta: Record<ErpMilestoneType, { label: string; short: string; refLabel: string; hint: string }> = {
  plant_head_grn_approval: { label: 'Plant Head GRN approval (DataMan)', short: 'Plant Head approval', refLabel: 'Approved GRN No.', hint: 'Needed before the purchase voucher.' },
  purchase_voucher: { label: 'Purchase Bill / Voucher (DataMan)', short: 'Voucher', refLabel: 'Voucher No.', hint: 'After Plant Head approval.' },
  final_posting: { label: 'Final posting (DataMan)', short: 'Posting', refLabel: 'Posting Ref.', hint: 'Procedure pending KPMPL confirmation.' },
};
export const ERP_ORDER: ErpMilestoneType[] = ['plant_head_grn_approval', 'purchase_voucher', 'final_posting'];

/** Packages Head Office sees; drafts stay with the Gate. After verification the package moves
 * through Accounts — HO keeps sight of it the whole way (its DataMan milestones continue). */
export const HO_VISIBLE: PackageStatus[] = [
  'submitted_to_ho', 'under_ho_review', 'correction_requested', 'resubmitted', 'verified',
  'with_accounting', 'with_head_accountant', 'accounting_approved', 'bill_posted',
];

/** Packages the accounting roles see, from HO verification onward. */
export const ACCOUNTING_VISIBLE: PackageStatus[] = ['verified', 'with_accounting', 'with_head_accountant', 'accounting_approved', 'bill_posted'];

export const accountingStageMeta: Record<AccountingStage, { label: string; tone: Tone }> = {
  with_accountant: { label: 'With Accountant', tone: 'progress' },
  with_head_accountant: { label: 'With Head Accountant', tone: 'progress' },
  approved: { label: 'Approved for posting', tone: 'info' },
  posted: { label: 'Posted', tone: 'success' },
};
