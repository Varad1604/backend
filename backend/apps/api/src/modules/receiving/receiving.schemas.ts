import { z } from 'zod';
// Brief §3 safe charset for refs and names: letters, numbers, space and . , / & ( ) ' _ # : -
// (the mock adapter already enforced the same set — audit KPMPL-001). Notes/reasons stay free text.
const SAFE_REF_CHARS = /^[\p{L}\p{N} .,/&()'_#:-]*$/u;
const text = (max: number) => z.string().min(1).max(max).refine(value => value.trim().length > 0, 'Enter a non-empty value.')
  .refine(value => Array.from(value).every(character => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127), 'Control characters are not allowed.')
  .refine(value => SAFE_REF_CHARS.test(value), 'Contains characters that are not allowed.');
const optionalRef = z.string().max(40).refine(value => Array.from(value).every(character => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127), 'Control characters are not allowed.')
  .refine(value => SAFE_REF_CHARS.test(value), 'Contains characters that are not allowed.').optional();
// Brief §3: kg only, `^\d{1,9}(\.\d{1,3})?$`, always positive.
export const weightValueSchema = z.object({
  value: z.string().regex(/^(?!0+(?:\.0{1,3})?$)\d{1,9}(\.\d{1,3})?$/, 'Use a positive decimal with at most 9 whole and 3 fractional digits.'),
  unit: z.literal('kg'),
}).strict();
// R-01: ref 40, vehicle 30, supplier 80 and material 80 are required; challan/po optional (40).
/** Operator-supplied lookup evidence; never described as server-confirmed ERP truth. */
export const erpEvidenceInputSchema = z.object({
  gateNo: text(40),
  year: z.number().int().min(2000).max(2100),
  docId: z.string().min(1).max(200).optional(),
  fetchedAt: z.iso.datetime({ offset: true }).optional(),
  manualReason: z.string().trim().min(8).max(500).optional(),
}).strict().superRefine((value, ctx) => {
  if (Boolean(value.docId) !== Boolean(value.fetchedAt)) {
    ctx.addIssue({ code: 'custom', path: ['fetchedAt'], message: 'A selected ERP DocId requires a lookup timestamp.' });
  }
  if (!value.docId && !value.manualReason) {
    ctx.addIssue({ code: 'custom', path: ['manualReason'], message: 'A manual ERP exception requires a reason.' });
  }
});

export const createVisitSchema = z.object({
  officialGateEntryRef: text(40), vehicleNumber: text(30), supplierDisplayName: text(80), materialDisplayName: text(80),
  challanRef: optionalRef, poRef: optionalRef, notes: z.string().max(2000).optional(),
  arrivedAt: z.iso.datetime({ offset: true }).optional(), grossWeight: weightValueSchema,
  erpEvidence: erpEvidenceInputSchema.optional(),
}).strict().superRefine((value, ctx) => {
  if (value.erpEvidence && value.erpEvidence.gateNo !== value.officialGateEntryRef) {
    ctx.addIssue({ code: 'custom', path: ['erpEvidence', 'gateNo'], message: 'ERP gate number must match the receiving visit.' });
  }
});
// The version always arrives in the If-Match header (brief §3); the body never carries it.
export const recordWeightSchema = weightValueSchema.extend({
  kind: z.enum(['gross', 'tare']), correctsId: z.uuid().optional(), correctionReason: z.string().max(2000).optional(), reason: z.string().max(2000).optional(),
}).strict().superRefine((value, ctx) => {
  const reason = value.correctionReason ?? value.reason;
  if (value.correctsId && !reason?.trim()) ctx.addIssue({ code: 'custom', message: 'A correction requires a reason.', path: ['correctionReason'] });
});
export const qcStatusSchema = z.enum(['pending', 'in_progress', 'submitted', 'returned', 'accepted', 'accepted_with_deduction', 'rejected']);
export const exitStatusSchema = z.enum(['on_premises', 'exited']);
export const grnStatusSchema = z.enum(['not_recorded', 'reference_recorded']);
export const listVisitsSchema = z.object({
  page: z.coerce.number().int().positive().max(21_474_836).default(1), pageSize: z.coerce.number().int().min(1).max(500).default(50),
  search: z.string().max(100).optional(), officialGateEntryRef: text(40).optional(),
  qcStatus: z.preprocess(value => (value === undefined ? undefined : Array.isArray(value) ? value : [value]), z.array(qcStatusSchema).optional()),
  exitStatus: exitStatusSchema.optional(), grnStatus: grnStatusSchema.optional(),
}).strict();
export const correctVisitSchema = z.object({
  officialGateEntryRef: text(40).optional(), vehicleNumber: text(30).optional(), supplierDisplayName: text(80).nullable().optional(), materialDisplayName: text(80).nullable().optional(),
  challanRef: z.string().max(40).nullable().optional(), poRef: z.string().max(40).nullable().optional(), notes: z.string().max(2000).nullable().optional(), grossWeight: weightValueSchema.optional(),
  reason: z.string().trim().min(1).max(500),
}).strict();
export const visitIdSchema = z.uuid();
export const idempotencyKeySchema = z.string().min(8).max(128);
export type CreateVisitInput = z.infer<typeof createVisitSchema>;
export type RecordWeightInput = z.infer<typeof recordWeightSchema>;
export type ListVisitsInput = z.infer<typeof listVisitsSchema>;
export type CorrectVisitInput = z.infer<typeof correctVisitSchema>;
