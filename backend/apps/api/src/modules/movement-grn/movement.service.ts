import { HttpException, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { Actor } from '../identity-access/identity.types';
import { IdempotentWriteService } from '../platform/idempotent-write.service';
import { ReceivingService } from '../receiving/receiving.service';
import { MovementReadService } from './movement-read.service';

// Versioning rides in the If-Match header (brief §3); bodies never carry a version.
export const exitSchema = z.object({
  physicalExitAt: z.iso.datetime({ offset: true }).optional(),
  remarks: z.string().max(500).optional(),
  millChecksConfirmed: z.boolean(),
}).strict();
export const grnSchema = z.object({
  officialGrnRef: z.string().min(1).max(40).refine(value => value.trim().length > 0, 'Enter the exact official reference.'),
  verifiedInDataManByStaff: z.boolean(),
  correctionReason: z.string().max(500).optional(),
}).strict();
const domain = (message: string, fields?: Record<string, string>) => new HttpException(fields
  ? { code: 'VALIDATION_FAILED', message: 'Please check the highlighted fields.', fields }
  : { code: 'DOMAIN_RULE', message }, 422);

@Injectable()
export class MovementService {
  constructor(private readonly prisma: PrismaService, private readonly receiving: ReceivingService, private readonly read: MovementReadService,
    private readonly writes: IdempotentWriteService, private readonly audit: AuditService) {}
  exit(actor: Actor, id: string, key: string, version: number, input: z.infer<typeof exitSchema>) {
    return this.writes.run(actor, 'gate.followup', '/receiving-visits/' + id + '/exit', key, { ...input, version }, async (tx, author) => {
      const visit = await this.receiving.claim(tx, author, id, version);
      if (await tx.vehicleExit.findUnique({ where: { visitId: id } })) throw domain('Physical exit is already recorded for this truck.');
      const current = await this.receiving.snapshot(tx, visit);
      // R-05 (policy EXIT_REQUIRES, D-04): tare + submitted QC readings + mill-check confirmation.
      if (!current.tareWeight) throw domain('Record the tare (empty) weight before recording exit.');
      if (current.qcStatus === 'pending' || current.qcStatus === 'in_progress') throw domain('QC has not submitted readings for this truck yet.');
      const fields: Record<string, string> = {};
      if (!input.millChecksConfirmed) fields.millChecksConfirmed = 'Confirm the mill’s exit checks were completed.';
      const at = input.physicalExitAt ? Date.parse(input.physicalExitAt) : Date.now();
      if (Number.isNaN(at)) fields.physicalExitAt = 'Enter the exit date and time.';
      else if (at > Date.now() + 5 * 60_000) fields.physicalExitAt = 'Exit time cannot be in the future.';
      else if (at < visit.createdAt.getTime() - 60_000) fields.physicalExitAt = 'Exit time cannot be before the truck was recorded at the Gate.';
      if (Object.keys(fields).length) throw domain('Please check the highlighted fields.', fields);
      const exit = await tx.vehicleExit.create({ data: { visitId: id, physicalExitAt: new Date(at), remarks: input.remarks, recordedBy: author.userId } });
      await this.audit.append(tx, { entityType: 'VehicleExit', entityId: exit.id, actorId: author.userId, action: 'exit_recorded',
        newValue: { visitId: id, physicalExitAt: exit.physicalExitAt.toISOString(), recordedAt: exit.recordedAt.toISOString(),
          detail: ['Staff confirmed mill exit checks.', current.grnStatus === 'not_recorded' ? 'GRN not yet recorded.' : '', input.remarks?.trim() ? `Remarks: ${input.remarks.trim()}` : ''].filter(Boolean).join(' ') } });
      return { status: 201, body: { data: await this.receiving.snapshot(tx, visit) } };
    });
  }
  recordGrn(actor: Actor, id: string, key: string, version: number, input: z.infer<typeof grnSchema>) {
    return this.writes.run(actor, 'gate.followup', '/receiving-visits/' + id + '/grn-links', key, { ...input, version }, async (tx, author) => {
      const visit = await this.receiving.claim(tx, author, id, version);
      const current = await this.receiving.snapshot(tx, visit);
      // R-06: the GRN is generated after empty weighment, so a tare must exist first.
      if (!current.tareWeight) throw domain('Record the tare weight first. The GRN is generated in DataMan after empty weighment.');
      const fields: Record<string, string> = {};
      if (!input.verifiedInDataManByStaff) fields.verifiedInDataManByStaff = 'Confirm you checked this GRN in DataMan.';
      const isCorrection = current.grnStatus === 'reference_recorded';
      if (isCorrection && input.officialGrnRef === current.officialGrnRef) fields.officialGrnRef = 'This is the same reference already recorded.';
      if (isCorrection && !input.correctionReason?.trim()) fields.correctionReason = 'Enter the reason for changing the GRN reference.';
      if (Object.keys(fields).length) throw domain('Please check the highlighted fields.', fields);
      const reference = await tx.gRNReference.create({ data: { officialGrnRef: input.officialGrnRef, verifiedBy: author.userId, source: 'manual_staff_confirmation' } });
      await tx.gRNLink.create({ data: { visitId: id, grnReferenceId: reference.id, createdBy: author.userId } });
      // R-06/D-01: the same GRN may repeat across visits — note it in the audit, never block.
      const shared = await tx.gRNLink.findMany({ where: { reference: { officialGrnRef: input.officialGrnRef }, visitId: { not: id } }, include: { visit: { select: { officialGateEntryRef: true } } } });
      const sharedRefs = [...new Set(shared.map(link => link.visit.officialGateEntryRef))];
      await this.audit.append(tx, { entityType: 'GRNReference', entityId: reference.id, actorId: author.userId, action: isCorrection ? 'grn_reference_corrected' : 'grn_reference_recorded',
        source: 'manual_staff_confirmation', ...(isCorrection ? { reason: input.correctionReason } : {}), newValue: { visitId: id, officialGrnRef: reference.officialGrnRef, recordedAt: reference.recordedAt.toISOString(),
          detail: [isCorrection ? `${current.officialGrnRef} → ${input.officialGrnRef}. Reason: ${input.correctionReason!.trim()}.` : `${input.officialGrnRef} — staff states it was checked in DataMan.`,
            sharedRefs.length ? `Same GRN also recorded on ${sharedRefs.join(', ')}.` : ''].filter(Boolean).join(' ') } });
      return { status: 201, body: { data: await this.receiving.snapshot(tx, visit) } };
    });
  }
  references(actor: Actor, id: string) {
    return this.prisma.$transaction(async tx => { await this.receiving.assertReadable(tx, actor, id); return { data: await this.read.references(tx, id) }; });
  }
}
