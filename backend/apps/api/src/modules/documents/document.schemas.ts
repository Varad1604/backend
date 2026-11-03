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
