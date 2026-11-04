/**
 * Domain types mirroring 06_SHARED_API_CONTRACT_DRAFT (v0.5, provisional).
 *
 * Rules carried from the requirements baseline:
 *  - Official DataMan references (Gate Entry, GRN, PO, challan) are opaque STRINGS.
 *    Never parse them as numbers; preserve leading zeros and suffixes (e.g. "0008-HO").
 *  - Measured quantities are decimal STRINGS ("15000.000"), never JS floats, for storage/transport.
 *  - QC, physical exit and GRN are INDEPENDENT status domains. There is deliberately no
 *    single combined `status` field (02_BUSINESS_WORKFLOWS §4).
 */

export type Iso8601 = string;
export type DecimalString = string;

export type RoleCode = 'gate' | 'gate_doc' | 'gate_doc_authority' | 'qc' | 'ho' | 'accountant' | 'head_accountant' | 'admin';

export interface User {
  id: string;
  username: string;
  displayName: string;
  roles: RoleCode[];
  /** True for synthetic accounts that exist only in prototype mode. */
  synthetic: boolean;
  /** Deactivated accounts cannot sign in; history keeps their name. */
  active: boolean;
  /**
   * Set by the server after an admin creates the account or resets its password (brief §5.6).
   * While true the UI only offers the Change password screen. Optional: absent = false.
   */
  mustChangePassword?: boolean;
}

export type WeightUnit = 'kg';

export interface Quantity {
  value: DecimalString;
  unit: WeightUnit;
}

/** QC states (02 §4). D-03 (2026-11-03): the QC Operator makes the final decision. */
export type QcStatus =
  | 'pending'          // Gate submitted, QC has not started
  | 'in_progress'      // QC saved a draft
  | 'submitted'        // QC submitted readings
  | 'returned'         // QC Operator reopened the readings for a re-check (new revision)
  | 'accepted'         // QC Operator's final decision
  | 'accepted_with_deduction'
  | 'rejected';

export type ExitStatus = 'on_premises' | 'exited';
export type GrnStatus = 'not_recorded' | 'reference_recorded';

export interface ReceivingVisit {
  id: string;
  officialGateEntryRef: string;
  vehicleNumber: string;
  supplierDisplayName: string;
  materialDisplayName: string;
  challanRef: string | null;
  poRef: string | null;
  arrivedAt: Iso8601 | null;
  grossWeight: Quantity | null;
  tareWeight: Quantity | null;
  notes: string | null;
  qcStatus: QcStatus;
  exitStatus: ExitStatus;
  grnStatus: GrnStatus;
  officialGrnRef: string | null;
  physicalExitAt: Iso8601 | null;
  createdAt: Iso8601;
  createdBy: string;
  updatedAt: Iso8601;
  /** Optimistic-concurrency token; echoed on writes. */
  version: number;
}

export interface CreateReceivingVisitInput {
  officialGateEntryRef: string;
  vehicleNumber: string;
  supplierDisplayName: string;
  materialDisplayName: string;
  challanRef?: string;
  poRef?: string;
  arrivedAt?: Iso8601;
  grossWeight: Quantity;
  notes?: string;
}

export interface VisitListQuery {
  search?: string;
  qcStatus?: QcStatus[];
  exitStatus?: ExitStatus;
  grnStatus?: GrnStatus;
  page?: number;
  pageSize?: number;
}

export interface Page<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
}

/* ---------------- QC ---------------- */

/** Fixture measurement codes — candidates only, not a signed QC schedule (08 §2, D-02). */
export type MeasurementCode = 'moisture' | 'impurity';

export interface Measurement {
  code: MeasurementCode;
  value: DecimalString;
  unit: 'percent';
}

export interface QcRevision {
  revision: number;
  state: 'draft' | 'submitted';
  measurements: Measurement[];
  remarks: string | null;
  revisionReason: string | null;
  recordedBy: string;
  recordedAt: Iso8601;
}

export interface QcReviewNote {
  outcome: 'returned' | 'accepted' | 'accepted_with_deduction' | 'rejected';
  reason: string;
  /** True only on decisions recorded before D-03 was decided (2026-11-03). */
  demonstrationOnly: boolean;
  recordedBy: string;
  recordedAt: Iso8601;
  forRevision: number;
}

export interface QcInspection {
  inspectionId: string;
  visitId: string;
  qcStatus: QcStatus;
  revisions: QcRevision[];
  reviews: QcReviewNote[];
  deductionCalculation: { status: 'not_configured'; value: null };
}

export interface QcSubmitInput {
  measurements: Measurement[];
  remarks?: string;
  revisionReason?: string;
  /** 'draft' keeps the case In Progress; 'submit' sends it to Gate and makes it ready for the QC decision. */
  intent: 'draft' | 'submit';
}

export interface QcQueueItem {
  visit: ReceivingVisit;
  latestRevision: number | null;
  lastReturnReason: string | null;
}

/* ---------------- Timeline / audit ---------------- */

export interface TimelineEvent {
  id: string;
  at: Iso8601;
  actor: string;
  action: string;
  detail?: string;
  source: 'app' | 'manual_staff_confirmation';
}

/* ---------------- Reference data ---------------- */

export interface ReferenceData {
  suppliers: string[];
  materials: string[];
}

/* ---------------- Gate follow-up (SCR-08) ---------------- */

export interface RecordTareInput {
  value: DecimalString;
  /** Required when a tare is already recorded (correction with history, 02 §5). */
  correctionReason?: string;
}

export interface RecordExitInput {
  physicalExitAt: Iso8601;
  remarks?: string;
  /** Staff states the mill's own checks were done. Eligibility rules are TBC (D-04). */
  millChecksConfirmed: boolean;
}

export interface RecordGrnInput {
  officialGrnRef: string;
  /** Staff states they checked the GRN in DataMan; not a live interface (06 §3). */
  verifiedInDataManByStaff: boolean;
  correctionReason?: string;
}

export interface CorrectVisitInput {
  vehicleNumber: string;
  supplierDisplayName: string;
  materialDisplayName: string;
  challanRef?: string;
  poRef?: string;
  notes?: string;
  grossWeight: Quantity;
  reason: string;
}

/* ---------------- QC decision (D-03: recorded by the QC Operator) ---------------- */

export type QcDecisionOutcome = QcReviewNote['outcome'];
export interface QcDecisionInput {
  outcome: QcDecisionOutcome;
  reason: string;
}

/* ---------------- Accounting checks (upgrade 2026-11-03) ---------------- */

export type AccountingCheckStatus = 'pending' | 'ok' | 'issue';

/** Per-check state for the accountant review. Each check has its own status, note and author. */
export interface AccountingCheck {
  type: 'bill_passed' | 'gst_checked' | 'tds_checked';
  status: AccountingCheckStatus;
  note: string | null;
  checkedBy: string | null;
  checkedAt: Iso8601 | null;
}

export interface AccountingChecks {
  checks: AccountingCheck[];
}

/** One entry in the accountant-review checks list on a package view. */
export interface AccountingCheckEntry {
  id: string;
  checks: AccountingCheck[];
  checkedBy: string;
  checkedAt: Iso8601;
}

/* ---------------- Overview (SCR-09) ---------------- */

export interface OverviewData {
  generatedAt: Iso8601;
  receiving: { total: number; today: number; onPremises: number };
  qc: { awaitingInspection: number; inProgress: number; returned: number; awaitingReview: number; decided: number };
  gate: { needsTare: number; readyToExit: number; exitedToday: number; grnPending: number };
  documents: { draft: number; withHo: number; correctionRequested: number; verified: number; withAccounting: number; billPosted: number };
  erp: { approvalPending: number; voucherPending: number; postingPending: number; posted: number };
  oldestAwaitingQc: ReceivingVisit[];
  longestOnPremises: ReceivingVisit[];
  grnPendingList: ReceivingVisit[];
}

/* ---------------- Administration (SCR-10) ---------------- */

export interface CreateUserInput { username: string; displayName: string; roles: RoleCode[] }
export interface UpdateUserInput { displayName?: string; roles?: RoleCode[]; active?: boolean }
/** `POST /admin/users` response: the temporary password appears in this response only (brief §5.6). */
export type CreatedUser = User & { temporaryPassword?: string };
/** `POST /admin/users/{id}/reset-password` response. Shown once, never stored by the UI. */
export interface TemporaryPasswordResult { temporaryPassword: string }
/** `POST /auth/change-password` body (brief §5.6). Min 10 characters; breach list checked server-side. */
export interface ChangePasswordInput { currentPassword: string; newPassword: string }
export const MIN_PASSWORD_LENGTH = 10;

/* ---------------- Module 2: documents, Head Office, ERP milestones ---------------- */

/** Candidate categories from the 14-page sample (09 §2). NOT an approved mandatory list (D-05). */
export type DocCategory = 'supplier_invoice' | 'factory_grn' | 'weighbridge_slip' | 'qc_slip' | 'supporting_bill' | 'eway_bill';

export interface DocumentFile {
  id: string;
  name: string;
  sizeBytes: number;
  mimeType: string;
  uploadedAt: Iso8601;
  uploadedBy: string;
  /** Synthetic fixture rows have no file content. */
  synthetic: boolean;
}

export type HoItemCheck = 'unchecked' | 'ok' | 'issue';

export interface DocumentItem {
  category: DocCategory;
  state: 'missing' | 'attached' | 'not_applicable';
  files: DocumentFile[];
  notApplicableReason: string | null;
  hoCheck: HoItemCheck;
  hoNote: string | null;
}

/** Proposed package states (09 §3), not final KPMPL terminology. After HO verification the
 * package moves to Accounts (upgrade 2026-11-03): HO → Accountant → Head Accountant → Bill Posted. */
export type PackageStatus =
  | 'draft' | 'ready_for_gate_check' | 'submitted_to_ho' | 'under_ho_review'
  | 'correction_requested' | 'resubmitted' | 'verified'
  | 'with_accounting' | 'with_head_accountant' | 'accounting_approved' | 'bill_posted'
  | 'forwarded_to_head_accountant' | 'returned_to_ho' | 'returned_to_accountant';

export interface CorrectionRequest {
  id: string;
  reason: string;
  categories: DocCategory[];
  requestedBy: string;
  requestedAt: Iso8601;
  resolvedAt: Iso8601 | null;
  responseNote: string | null;
}

export type ErpMilestoneType = 'plant_head_grn_approval' | 'purchase_voucher' | 'final_posting';

export interface ErpMilestone {
  type: ErpMilestoneType;
  status: 'pending' | 'confirmed';
  dataManRef: string | null;
  /** When it happened in DataMan, as reported by staff (not verified). */
  erpOccurredAt: Iso8601 | null;
  note: string | null;
  confirmedBy: string | null;
  confirmedAt: Iso8601 | null;
  /** Brief §6 names the column default `manual_staff_confirmation`; v0.5 fixtures used `staff_confirmed`. Both accepted. */
  source: 'manual_staff_confirmation' | 'staff_confirmed';
}

export interface Reminder {
  id: string;
  recipient: string;
  note: string;
  sentBy: string;
  sentAt: Iso8601;
}

export interface DocumentPackage {
  id: string;
  packageRef: string;
  visitIds: string[];
  invoiceRef: string | null;
  supplierDisplayName: string;
  status: PackageStatus;
  checklistVersion: string;
  items: DocumentItem[];
  submittedBy: string | null;
  submittedAt: Iso8601 | null;
  corrections: CorrectionRequest[];
  erp: ErpMilestone[];
  reminders: Reminder[];
  history: TimelineEvent[];
  /** Present once accounting has started on a verified package; null before that. */
  accounting: AccountingInfo | null;
  /** Accountant-review checks recorded while the package is with the Accountant. */
  accountingChecks: AccountingCheckEntry[];
  createdBy: string;
  createdAt: Iso8601;
  updatedAt: Iso8601;
  version: number;
}

/** Package with the linked visits resolved, for display. */
export interface DocumentPackageView extends DocumentPackage {
  visits: ReceivingVisit[];
}

/* ---------------- Accounting workflow (upgrade 2026-11-03) ---------------- */

/** Where the package is inside the accounting chain (mirrors the server's AccountingRecord). */
export type AccountingStage = 'with_accountant' | 'with_head_accountant' | 'approved' | 'posted';

/** Fields an authorized accountant may correct, each with a mandatory reason. `accountingRef`
 * is an opaque string stored exactly as typed; whether it is the internal bill reference or a
 * DataMan voucher reference is PENDING KPMPL. No amounts, tax or ledger fields exist yet. */
export type AccountingField = 'accountingRef' | 'accountantNote' | 'headAccountantNote';

export interface AccountingCorrectionRecord {
  id: string;
  field: AccountingField;
  oldValue: string | null;
  newValue: string | null;
  reason: string;
  correctedBy: string;
  correctedAt: Iso8601;
}

export interface AccountingInfo {
  stage: AccountingStage;
  accountingRef: string | null;
  accountantNote: string | null;
  headAccountantNote: string | null;
  /** B-11: staff-typed optional money amounts, fixed 2-decimal strings; never computed. */
  invoiceAmount: string | null;
  gstAmount: string | null;
  tdsAmount: string | null;
  netAmount: string | null;
  startedBy: string;
  startedAt: Iso8601;
  submittedBy: string | null;
  submittedAt: Iso8601 | null;
  approvedBy: string | null;
  approvedAt: Iso8601 | null;
  postedBy: string | null;
  postedAt: Iso8601 | null;
  corrections: AccountingCorrectionRecord[];
}

export type AccountingAction =
  | { kind: 'start_accounting' }
  | { kind: 'submit_to_head_accountant'; confirmComplete: boolean; accountantNote?: string }
  | { kind: 'return_to_ho'; reason: string; failedChecks: string[] }
  | { kind: 'return_to_accountant'; reason: string }
  | { kind: 'approve_accounting'; headAccountantNote?: string }
  /** billRef is the bill reference as typed (opaque). Duplicate posting is refused server-side. */
  | { kind: 'post_bill'; billRef: string; note?: string }
  | { kind: 'correct_accounting'; field: AccountingField; value: string; reason: string }
  /** B-11: at least one amount per call; null clears a previously typed amount. */
  | { kind: 'record_amounts'; invoiceAmount?: string | null; gstAmount?: string | null; tdsAmount?: string | null; netAmount?: string | null };

export interface CreatePackageInput { visitIds: string[]; invoiceRef?: string }
export interface UpdatePackageInput { visitIds?: string[]; invoiceRef?: string }
/** Upload input. The http adapter sends multipart/form-data with fields `category` and `file` (brief §5.7). */
export interface AttachFileInput { category: DocCategory; file: File }
export interface ErpMilestoneInput {
  type: ErpMilestoneType;
  action: 'confirm' | 'reverse';
  dataManRef?: string;
  erpOccurredAt?: Iso8601;
  note?: string;
  verifiedInDataManByStaff: boolean;
}
