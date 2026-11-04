import { z } from 'zod';
export const categories = ['supplier_invoice', 'factory_grn', 'weighbridge_slip', 'qc_slip', 'supporting_bill', 'eway_bill'] as const;
export const milestones = ['plant_head_grn_approval', 'purchase_voucher', 'final_posting'] as const;
// Mock-approved checklist labels (docCategoryMeta) for the missing-rows message (R-12/R-14).
export const categoryLabels: Record<string, string> = {
  supplier_invoice: 'Supplier tax invoice', factory_grn: 'Factory GRN / goods receipt', weighbridge_slip: 'Weighbridge slips (gross & tare)',
  qc_slip: 'QC / moisture / rejection slip', supporting_bill: 'Supplier supporting bill(s)', eway_bill: 'E-way bill',
};
export const milestoneShort: Record<(typeof milestones)[number], string> = {
  plant_head_grn_approval: 'Plant Head approval', purchase_voucher: 'Voucher', final_posting: 'Posting',
};
export const packageIdSchema = z.uuid();
export const createPackageSchema = z.object({ visitIds: z.array(z.uuid()).min(1).max(100), invoiceRef: z.string().max(40).optional() }).strict();
export const updatePackageSchema = z.object({ visitIds: z.array(z.uuid()).min(1).max(100).optional(), invoiceRef: z.string().max(40).nullable().optional() }).strict().refine(value => Object.keys(value).length > 0);
// R-11: the not-applicable reason is capped at 300.
export const applicabilitySchema = z.object({ notApplicableReason: z.string().trim().min(1).max(300).nullable() }).strict();
export const actionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('mark_ready') }).strict(), z.object({ kind: z.literal('back_to_draft'), reason: z.string().trim().min(1).max(1000) }).strict(),
  z.object({ kind: z.literal('submit_to_ho'), confirmComplete: z.literal(true), responseNote: z.string().trim().min(1).max(1000).optional() }).strict(),
  z.object({ kind: z.literal('start_review') }).strict(), z.object({ kind: z.literal('request_correction'), reason: z.string().trim().min(1).max(1000), categories: z.array(z.enum(categories)).min(1) }).strict(),
  z.object({ kind: z.literal('verify') }).strict(),
]);
export const reviewSchema = z.object({ packageId: z.uuid(), category: z.enum(categories), check: z.enum(['ok', 'issue', 'unchecked']), note: z.string().max(500).optional() }).strict().superRefine((v, ctx) => { if (v.check === 'issue' && !v.note?.trim()) ctx.addIssue({ code: 'custom', path: ['note'], message: 'Enter a note for this issue.' }); });
export const erpSchema = z.object({ type: z.enum(milestones), action: z.enum(['confirm', 'reverse']), dataManRef: z.string().max(40).optional(), erpOccurredAt: z.iso.datetime().optional(), note: z.string().max(500).optional(), verifiedInDataManByStaff: z.boolean() }).strict();
export const reminderSchema = z.object({ note: z.string().trim().min(1).max(300) }).strict();
export const ifMatchSchema = z.coerce.number().int().min(1);
export type PackageAction = z.infer<typeof actionSchema>;

// ---------- Accounting workflow (upgrade 2026-11-03) ----------
// States after HO verification. Additive string values on DocumentPackage.status —
// no existing value is renamed or removed (safe-migration rule).
export const ACCOUNTING_STATES = ['with_accounting', 'with_head_accountant', 'accounting_approved', 'bill_posted', 'forwarded_to_head_accountant', 'returned_to_ho', 'returned_to_accountant'] as const;
export type AccountingState = (typeof ACCOUNTING_STATES)[number];
/** Everything an accountant or head accountant may see: verified (hand-off point) plus the accounting chain. */
export const ACCOUNTING_VISIBLE = ['verified', ...ACCOUNTING_STATES] as const;
export const accountingFields = ['accountingRef', 'accountantNote', 'headAccountantNote'] as const;
// Opaque reference, stored byte-for-byte like every DataMan-style ref (max 40 like the brief's refs).
const opaqueRef = z.string().trim().min(1).max(40);
// B-11: money as a decimal string with at most 2 fractional digits (never a JS number).
const moneySchema = z.string().regex(/^(0|[1-9]\d{0,11})(\.\d{1,2})?$/, 'Use a positive amount with at most 2 decimal places.');
export const accountingActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('start_accounting') }).strict(),
  z.object({ kind: z.literal('submit_to_head_accountant'), confirmComplete: z.literal(true), accountantNote: z.string().trim().max(1000).optional() }).strict(),
  z.object({ kind: z.literal('return_to_ho'), reason: z.string().trim().min(1).max(1000), failedChecks: z.array(z.enum(['bill_passed', 'gst_checked', 'tds_checked'])).min(1) }).strict(),
  z.object({ kind: z.literal('return_to_accountant'), reason: z.string().trim().min(1).max(1000) }).strict(),
  z.object({ kind: z.literal('approve_accounting'), headAccountantNote: z.string().trim().max(1000).optional() }).strict(),
  // Duplicate-posting guard lives in the state machine: post_bill is legal only from
  // accounting_approved, and bill_posted is terminal for accounting actions.
  z.object({ kind: z.literal('post_bill'), billRef: opaqueRef, note: z.string().trim().max(500).optional() }).strict(),
  z.object({ kind: z.literal('correct_accounting'), field: z.enum(accountingFields), value: z.string().trim().max(1000), reason: z.string().trim().min(1).max(500) }).strict(),
  // B-11: optional staff-typed money fields. At least one must be present; values are
  // decimal strings with at most 2 fractional digits; clearing a field sends null.
  z.object({
    kind: z.literal('record_amounts'),
    invoiceAmount: moneySchema.nullable().optional(),
    gstAmount: moneySchema.nullable().optional(),
    tdsAmount: moneySchema.nullable().optional(),
    netAmount: moneySchema.nullable().optional(),
  }).strict().refine(value => ['invoiceAmount', 'gstAmount', 'tdsAmount', 'netAmount'].some(field => (value as Record<string, unknown>)[field] !== undefined), { message: 'Enter at least one amount.' }),
]);
export type AccountingAction = z.infer<typeof accountingActionSchema>;

/** Body for POST /accounting/cases/{id}/checks: the three accountant review checks. */
export const accountingCheckStatusSchema = z.enum(['pending', 'ok', 'issue']);
export const singleCheckSchema = z.object({
  type: z.enum(['bill_passed', 'gst_checked', 'tds_checked']),
  status: accountingCheckStatusSchema,
  note: z.string().max(500).optional(),
  checkedBy: z.string().uuid().optional(),
  checkedAt: z.iso.datetime().optional(),
}).strict();
export const accountingChecksSchema = z.object({
  checks: z.array(singleCheckSchema).min(3).max(3),
}).strict();
export type AccountingChecks = z.infer<typeof accountingChecksSchema>;
export type AccountingCheck = z.infer<typeof singleCheckSchema>;
export type AccountingCheckType = 'bill_passed' | 'gst_checked' | 'tds_checked';
export type AccountingCheckStatus = z.infer<typeof accountingCheckStatusSchema>;
