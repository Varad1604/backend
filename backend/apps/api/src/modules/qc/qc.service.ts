import { HttpException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ACCOUNTING_STATES } from '../documents/document.schemas';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { Actor } from '../identity-access/identity.types';
import { ReceivingService } from '../receiving/receiving.service';
import { IdempotentWriteService } from '../platform/idempotent-write.service';
import { QcReadService } from './qc-read.service';

const domain = (message: string, fields?: Record<string, string>) => new HttpException(fields
  ? { code: 'VALIDATION_FAILED', message: 'Please check the highlighted fields.', fields }
  : { code: 'DOMAIN_RULE', message }, 422);
// Brief §5.4/R-07: percent readings on the two fixture codes; fixed scale 2 (§3).
// B-37: a percentage reading is bounded — 0..100 — not merely well-formed.
const measurementSchema = z.object({
  code: z.enum(['moisture', 'impurity']),
  value: z.string().regex(/^\d{1,3}(\.\d{1,2})?$/, 'Enter a valid reading.').refine(
    value => Number(value) <= 100, 'A percentage reading cannot be above 100.'),
  unit: z.literal('percent'),
}).strict();
export const qcSubmissionSchema = z.object({
  measurements: z.array(measurementSchema).max(2),
  remarks: z.string().max(1000).optional(),
  revisionReason: z.string().max(1000).optional(),
  intent: z.enum(['draft', 'submit']),
}).strict().superRefine((input, ctx) => {
  const codes = new Set(input.measurements.map(measurement => measurement.code));
  if (codes.size !== input.measurements.length) ctx.addIssue({ code: 'custom', message: 'Each reading can be entered once.', path: ['measurements'] });
  if (!input.measurements.length && !input.remarks?.trim()) ctx.addIssue({ code: 'custom', message: 'Enter a QC note or at least one reading.', path: ['remarks'] });
});
export const qcDecisionSchema = z.object({
  outcome: z.enum(['returned', 'accepted', 'accepted_with_deduction', 'rejected']),
  reason: z.string().max(1000).optional(),
}).strict().superRefine((input, ctx) => {
  // R-08: the reason is required for every outcome except accepted.
  if (input.outcome !== 'accepted' && !input.reason?.trim()) ctx.addIssue({ code: 'custom', message: 'Enter the reason for this outcome.', path: ['reason'] });
});

@Injectable()
export class QcService {
  constructor(private readonly prisma: PrismaService, private readonly receiving: ReceivingService, private readonly read: QcReadService,
    private readonly writes: IdempotentWriteService, private readonly audit: AuditService) {}
  submit(actor: Actor, id: string, key: string, version: number, input: z.infer<typeof qcSubmissionSchema>) {
    return this.writes.run(actor, 'qc.measure', '/receiving-visits/' + id + '/qc-inspections', key, { ...input, version }, async (tx, author) => {
      const visit = await this.receiving.claim(tx, author, id, version);
      // B-15: readings and decisions are locked once the truck has exited or its package
      // has passed Head Office verification (the documents are being accounted/posted).
      if (await tx.vehicleExit.findUnique({ where: { visitId: id } })) throw domain('This truck has exited. QC readings and decisions are locked.');
      const packageLink = await tx.packageVisit.findUnique({ where: { visitId: id }, include: { package: { select: { status: true } } } });
      if (packageLink && ['verified', ...ACCOUNTING_STATES].includes(packageLink.package.status)) throw domain('This truck is past Head Office verification. QC can no longer be changed.');
      const existing = await tx.qCInspection.findFirst({ where: { visitId: id }, include: { revisions: { orderBy: { revisionNo: 'desc' }, take: 1 } } });
      const currentStatus = existing?.qcStatus ?? 'pending';
      // R-07: readings can be entered only while the case is pending, in progress or returned.
      if (!['pending', 'in_progress', 'returned'].includes(currentStatus)) throw domain('This inspection has already been submitted. Corrections are possible only after it is returned.');
      const fields: Record<string, string> = {};
      if (input.intent === 'submit') for (const code of ['moisture', 'impurity'] as const) {
        if (!input.measurements.some(measurement => measurement.code === code)) fields[code] = `Enter the ${code} reading before submitting.`;
      }
      const isResubmission = currentStatus === 'returned' || existing?.revisions.some(revision => revision.state === 'submitted') === true;
      if (input.intent === 'submit' && isResubmission && !input.revisionReason?.trim()) fields.revisionReason = 'Enter the reason for this revised submission.';
      if (Object.keys(fields).length) throw domain('Please check the highlighted fields.', fields);

      const inspection = existing ?? await tx.qCInspection.create({ data: { visitId: id, createdBy: author.userId, qcStatus: 'pending' } });
      const last = existing?.revisions[0];
      const overwriteDraft = last?.state === 'draft';
      const revisionNo = overwriteDraft ? last!.revisionNo : (last?.revisionNo ?? 0) + 1;
      const state = input.intent === 'submit' ? 'submitted' : 'draft';
      const supersedes = !overwriteDraft && last?.state === 'submitted' ? last.id : null;
      const revision = overwriteDraft
        ? await tx.qCRevision.update({ where: { id: last!.id }, data: { state, remarks: input.remarks, revisionReason: input.revisionReason, reason: input.revisionReason,
            measurements: input.measurements, submittedBy: author.userId, submittedAt: new Date() } })
        : await tx.qCRevision.create({ data: { inspectionId: inspection.id, revisionNo, state, visitVersion: version, measurements: input.measurements,
            remarks: input.remarks, revisionReason: input.revisionReason, reason: input.revisionReason, submittedBy: author.userId, supersedesId: supersedes } });
      // Numeric measurement rows with the contract's fixed scale (brief §6 qc_measurement).
      if (overwriteDraft) await tx.qCMeasurement.deleteMany({ where: { revisionId: revision.id } });
      for (const measurement of input.measurements) {
        await tx.qCMeasurement.create({ data: { id: randomUUID(), revisionId: revision.id, code: measurement.code, value: measurement.value, unit: 'percent' } });
      }
      // A returned case stays returned while a draft correction is prepared (R-07).
      const newStatus = input.intent === 'submit' ? 'submitted' : currentStatus === 'returned' ? 'returned' : 'in_progress';
      await tx.qCInspection.update({ where: { id: inspection.id }, data: { currentRevisionId: revision.id, qcStatus: newStatus } });
      await this.audit.append(tx, { entityType: 'QCInspection', entityId: inspection.id, actorId: author.userId,
        action: input.intent === 'submit' ? 'qc_submitted' : 'qc_draft_saved',
        newValue: { visitId: id, revision: revisionNo, detail: input.intent === 'submit'
          ? (input.revisionReason?.trim() ? `Revision reason: ${input.revisionReason.trim()}` : 'No automatic deduction configured.')
          : 'Draft saved; readings are not visible to the Gate yet.' } });
      void visit;
      const [dto] = await this.read.inspectionDtos(tx, id);
      return { status: 201, body: { data: dto } };
    });
  }
  async decide(actor: Actor, inspectionId: string, key: string, version: number, input: z.infer<typeof qcDecisionSchema>) {
    return this.writes.run(actor, 'qc.decide', '/qc-inspections/' + inspectionId + '/decisions', key, { ...input, version }, async (tx, author) => {
      const inspection = await tx.qCInspection.findFirst({ where: { id: inspectionId }, include: { visit: true, revisions: { orderBy: { revisionNo: 'desc' }, take: 1 } } });
      if (!inspection) throw new NotFoundException();
      // Every QC write checks and bumps the VISIT version (brief §3).
      await this.receiving.claim(tx, author, inspection.visitId, version);
      // B-15: decisions are locked after exit or once the package is past HO verification.
      if (await tx.vehicleExit.findUnique({ where: { visitId: inspection.visitId } })) throw domain('This truck has exited. QC readings and decisions are locked.');
      const packageLink = await tx.packageVisit.findUnique({ where: { visitId: inspection.visitId }, include: { package: { select: { status: true } } } });
      if (packageLink && ['verified', ...ACCOUNTING_STATES].includes(packageLink.package.status)) throw domain('This truck is past Head Office verification. QC can no longer be changed.');
      // R-08: a decision can be recorded only on submitted readings. D-03: the QC operator
      // who submitted them makes the decision, so there is no separation-of-duties check.
      if (inspection.qcStatus !== 'submitted') throw domain('A QC decision can be recorded only after the readings are submitted. Refresh to see its current state.');
      const forRevision = inspection.revisions.find(revision => revision.state === 'submitted')?.revisionNo ?? inspection.revisions[0]?.revisionNo ?? 0;
      await tx.qCReview.create({ data: { inspectionId: inspection.id, outcome: input.outcome, reason: input.reason?.trim() || 'No remarks.',
        demonstrationOnly: false, forRevision, recordedBy: author.userId } });
      await tx.qCInspection.update({ where: { id: inspection.id }, data: { qcStatus: input.outcome } });
      const detail = [input.reason?.trim(), input.outcome === 'accepted_with_deduction' ? 'Deduction amount not calculated. Formula pending KPMPL confirmation.' : ''].filter(Boolean).join(' ');
      await this.audit.append(tx, { entityType: 'QCInspection', entityId: inspection.id, actorId: author.userId, action: `qc_${input.outcome}`,
        newValue: { visitId: inspection.visitId, outcome: input.outcome, ...(detail ? { detail } : {}) } });
      const [dto] = await this.read.inspectionDtos(tx, inspection.visitId);
      return { status: 200, body: { data: dto } };
    });
  }
  /** GET /receiving-visits/{id}/qc-inspections — array with 0 or 1 QcInspection (the frontend reads [0]). */
  history(actor: Actor, id: string) {
    return this.prisma.$transaction(async tx => {
      await this.receiving.assertReadable(tx, actor, id);
      return { data: await this.read.inspectionDtos(tx, id) };
    });
  }
}
