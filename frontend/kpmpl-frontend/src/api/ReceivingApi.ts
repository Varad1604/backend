/**
 * The ONLY boundary between UI and data. Two adapters implement it:
 *   - mock/mockAdapter.ts  — synthetic, in-browser (demo / offline)
 *   - http/httpAdapter.ts  — real backend per KPMPL_Backend_Build_Brief §3/§5 (endpoint table in README)
 * Swapping adapters must not change UI state meaning (17 §5).
 */
import type {
  AccountingAction, AccountingChecks, AttachFileInput, ChangePasswordInput, CorrectVisitInput, CreatedUser, CreatePackageInput, CreateReceivingVisitInput, CreateUserInput,
  DocCategory, DocumentPackageView, ErpMilestoneInput, OverviewData, Page, QcInspection, QcQueueItem,
  QcDecisionInput, QcSubmitInput, ReceivingVisit, RecordExitInput, RecordGrnInput, RecordTareInput,
  ReferenceData, TemporaryPasswordResult, TimelineEvent, UpdatePackageInput, UpdateUserInput, User, VisitListQuery,
} from '../domain/types';

export interface WriteOptions {
  /** Same key on retry ⇒ server returns the original result instead of a duplicate. */
  idempotencyKey: string;
}
export type VersionedWrite = WriteOptions & { expectedVersion: number };

export interface ReceivingApi {
  // auth
  login(username: string, password: string): Promise<User>;
  me(): Promise<User | null>;
  logout(): Promise<void>;
  /** Any signed-in user. Server clears `mustChangePassword`; the UI then re-reads `me()`. */
  changePassword(input: ChangePasswordInput, opts: WriteOptions): Promise<void>;

  // receiving
  listVisits(q: VisitListQuery): Promise<Page<ReceivingVisit>>;
  getVisit(id: string): Promise<ReceivingVisit>;
  createVisit(input: CreateReceivingVisitInput, opts: WriteOptions): Promise<ReceivingVisit>;
  correctVisit(id: string, input: CorrectVisitInput, opts: VersionedWrite): Promise<ReceivingVisit>;
  getTimeline(visitId: string): Promise<TimelineEvent[]>;
  getReferenceData(): Promise<ReferenceData>;

  // gate follow-up (three independent writes, 06 §3)
  recordTare(id: string, input: RecordTareInput, opts: VersionedWrite): Promise<ReceivingVisit>;
  recordExit(id: string, input: RecordExitInput, opts: VersionedWrite): Promise<ReceivingVisit>;
  recordGrn(id: string, input: RecordGrnInput, opts: VersionedWrite): Promise<ReceivingVisit>;

  // QC
  getQcQueue(): Promise<QcQueueItem[]>;
  getQcInspection(visitId: string): Promise<QcInspection | null>;
  submitQc(visitId: string, input: QcSubmitInput, opts: VersionedWrite): Promise<QcInspection>;
  /** Final QC decision, recorded by the QC Operator once readings are submitted (D-03). */
  decideQc(visitId: string, input: QcDecisionInput, opts: VersionedWrite): Promise<QcInspection>;

  // overview and reports
  getOverview(): Promise<OverviewData>;
  /** Receiving register CSV. http: server endpoint `GET /reports/receiving.csv`; mock: built in the browser. */
  exportReceivingCsv(range?: { from?: string; to?: string }): Promise<CsvExport>;

  // administration
  listUsers(): Promise<User[]>;
  createUser(input: CreateUserInput, opts: WriteOptions): Promise<CreatedUser>;
  updateUser(id: string, input: UpdateUserInput, opts: WriteOptions): Promise<User>;
  /** Returns a new temporary password exactly once and revokes the user's sessions. */
  adminResetPassword(userId: string, opts: WriteOptions): Promise<TemporaryPasswordResult>;

  // module 2 — documents, Head Office, ERP milestones
  /** scope: 'gate' = the preparer's list (all states), 'ho' = HO-visible cases,
   *  'accounting' = packages from HO verification onward (upgrade 2026-11-03). */
  listPackages(scope: 'gate' | 'ho' | 'accounting'): Promise<DocumentPackageView[]>;
  getPackage(id: string): Promise<DocumentPackageView>;
  createPackage(input: CreatePackageInput, opts: WriteOptions): Promise<DocumentPackageView>;
  updatePackage(id: string, input: UpdatePackageInput, opts: VersionedWrite): Promise<DocumentPackageView>;
  attachFile(id: string, input: AttachFileInput, opts: VersionedWrite): Promise<DocumentPackageView>;
  removeFile(id: string, category: DocCategory, fileId: string, opts: VersionedWrite): Promise<DocumentPackageView>;
  setNotApplicable(id: string, category: DocCategory, reason: string | null, opts: VersionedWrite): Promise<DocumentPackageView>;
  packageAction(id: string, action: PackageAction, opts: VersionedWrite): Promise<DocumentPackageView>;
  hoCheckItem(id: string, category: DocCategory, check: 'ok' | 'issue' | 'unchecked', note: string | null, opts: VersionedWrite): Promise<DocumentPackageView>;
  recordErpMilestone(id: string, input: ErpMilestoneInput, opts: VersionedWrite): Promise<DocumentPackageView>;
  sendReminder(id: string, note: string, opts: VersionedWrite): Promise<DocumentPackageView>;
  /** Accounting workflow actions: start, hand over, approve, post, return, correct (upgrade 2026-11-03). */
  accountingAction(id: string, action: AccountingAction, opts: VersionedWrite): Promise<DocumentPackageView>;
  /**
   * Record the three accountant-review checks for a package (accounting.review).
   * Called while the package is with the Accountant (with_accounting).
   */
  recordAccountingChecks(id: string, checks: AccountingChecks, opts: WriteOptions): Promise<DocumentPackageView>;
  /**
   * Packages currently with the Head Accountant (with_head_accountant) plus those approved
   * but not yet posted (accounting_approved) — the Head Accountant's working set.
   */
  headAccountantCases(): Promise<DocumentPackageView[]>;
  /**
   * URL the PDF viewer loads for a stored file, or null when no content is available.
   * http: `${base}/document-files/{id}/content` (same-origin, cookie-authorised, server checks access).
   * mock: an in-tab blob: URL, lost on reload.
   */
  fileContentUrl(fileId: string): string | null;
}

export interface CsvExport {
  filename: string;
  blob: Blob;
}

export type PackageAction =
  | { kind: 'mark_ready' }
  | { kind: 'back_to_draft'; reason: string }
  | { kind: 'submit_to_ho'; confirmComplete: boolean; responseNote?: string }
  | { kind: 'start_review' }
  | { kind: 'request_correction'; reason: string; categories: DocCategory[] }
  | { kind: 'verify' };
