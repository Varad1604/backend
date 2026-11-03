import { QcReadService } from '../qc/qc-read.service';
import { MovementReadService } from '../movement-grn/movement-read.service';
import { HttpException, Injectable } from '@nestjs/common';
import { Prisma, type ReceivingVisit } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuthService } from '../identity-access/auth.service';
import type { Actor } from '../identity-access/identity.types';
import { AuditService } from '../audit/audit.service';
import { IdempotentWriteService } from '../platform/idempotent-write.service';
import { WeighmentService, readingDto } from '../weighment/weighment.service';
import { ReceivingRepository } from './receiving.repository';
import type { CorrectVisitInput, CreateVisitInput, ListVisitsInput, RecordWeightInput } from './receiving.schemas';

/** Brief §5.2 ReceivingVisit — the exact projection the frontend renders. */
type VisitSnapshot = {
  id: string; officialGateEntryRef: string; vehicleNumber: string; supplierDisplayName: string | null; materialDisplayName: string | null;
  challanRef: string | null; poRef: string | null; arrivedAt: string | null;
  grossWeight: { value: string; unit: 'kg' } | null; tareWeight: { value: string; unit: 'kg' } | null; notes: string | null;
  qcStatus: string; exitStatus: string; grnStatus: string; officialGrnRef: string | null; physicalExitAt: string | null;
  createdAt: string; createdBy: string; updatedAt: string; version: number;
};

@Injectable()
export class ReceivingService {
  constructor(private readonly prisma: PrismaService, private readonly auth: AuthService, private readonly audit: AuditService,
    private readonly writes: IdempotentWriteService, private readonly repository: ReceivingRepository, private readonly weights: WeighmentService,
    private readonly qc: QcReadService, private readonly movement: MovementReadService) {}
  async assertReadable(tx: Prisma.TransactionClient, actor: Actor, id: string) {
    await this.auth.authorize(actor, 'receiving.view', tx);
    return this.repository.visible(tx, id);
  }
  async claim(tx: Prisma.TransactionClient, actor: Actor, id: string, version: number) {
    await this.assertReadable(tx, actor, id);
    return this.repository.claimVersion(tx, id, version);
  }
  // Shared with documents (package views) and reports (overview lists).
  async snapshots(tx: Prisma.TransactionClient, visits: ReceivingVisit[]): Promise<VisitSnapshot[]> {
    if (!visits.length) return [];
    const ids = visits.map(visit => visit.id);
    const [readings, qcStates, movementStates, creators] = await Promise.all([
      this.weights.history(tx, ids), this.qc.states(tx, ids), this.movement.states(tx, ids),
      tx.user.findMany({ where: { id: { in: [...new Set(visits.map(visit => visit.createdBy))] } }, select: { id: true, fullName: true } }),
    ]);
    const creatorNames = new Map(creators.map(user => [user.id, user.fullName]));
    return visits.map(visit => {
      const movementState = movementStates.get(visit.id);
      if (!movementState) throw new Error('Missing movement projection');
      const { grossWeight, tareWeight } = this.weights.current(readings.filter(reading => reading.visitId === visit.id));
      return {
        id: visit.id, officialGateEntryRef: visit.officialGateEntryRef, vehicleNumber: visit.vehicleNumber,
        supplierDisplayName: visit.supplierDisplayName, materialDisplayName: visit.materialDisplayName,
        challanRef: visit.challanRef, poRef: visit.poRef, arrivedAt: visit.arrivedAt?.toISOString() ?? null,
        grossWeight, tareWeight, notes: visit.notes,
        qcStatus: qcStates.get(visit.id)!.qcStatus, exitStatus: movementState.exitStatus, grnStatus: movementState.grnStatus,
        officialGrnRef: movementState.officialGrnRef, physicalExitAt: movementState.physicalExitAt,
        createdAt: visit.createdAt.toISOString(), createdBy: creatorNames.get(visit.createdBy) ?? 'Unknown user',
        updatedAt: visit.updatedAt.toISOString(), version: visit.version,
      };
    });
  }
  async snapshot(tx: Prisma.TransactionClient, visit: ReceivingVisit) {
    const [data] = await this.snapshots(tx, [visit]);
    if (!data) throw new Error('Missing visit projection');
    return data;
  }
  create(actor: Actor, key: string, input: CreateVisitInput) {
    return this.writes.run(actor, 'receiving.create', '/receiving-visits', key, input, async (tx, author) => {
      // Serialize only this exact reference for a reliable advisory; it is never a unique key.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(6200011, hashtext(${input.officialGateEntryRef}))`;
      const duplicate = await tx.receivingVisit.findFirst({ where: { officialGateEntryRef: input.officialGateEntryRef, isDemo: true }, select: { id: true, vehicleNumber: true } });
      if (duplicate) throw new HttpException({ code: 'DUPLICATE_CANDIDATE', message: `A receiving visit with Gate Entry Number ${input.officialGateEntryRef} already exists (vehicle ${duplicate.vehicleNumber}).`, meta: { existingId: duplicate.id } }, 409);
      const { grossWeight, ...fields } = input;
      const visit = await tx.receivingVisit.create({ data: { ...fields, createdBy: author.userId, isDemo: true } });
      const reading = await this.weights.append(tx, visit.id, author.userId, { kind: 'gross', ...grossWeight });
      const data = await this.snapshot(tx, visit);
      await this.audit.append(tx, { entityType: 'ReceivingVisit', entityId: visit.id, actorId: author.userId, action: 'receiving_created',
        newValue: { ...data, detail: `Gross ${grossWeight.value} kg recorded. Sent to QC pending list.` } });
      await this.audit.append(tx, { entityType: 'Weighment', entityId: reading.created.id, actorId: author.userId, action: 'weight_recorded', newValue: reading.created });
      return { status: 201, body: { data } };
    });
  }
  recordWeight(actor: Actor, id: string, key: string, version: number, input: RecordWeightInput) {
    const reason = input.correctionReason ?? input.reason;
    return this.writes.run(actor, 'gate.followup', '/receiving-visits/' + id + '/weighments', key, { ...input, version }, async (tx, author) => {
      const visit = await this.repository.claimVersion(tx, id, version);
      // R-04: a tare cannot be recorded after exit.
      if (input.kind === 'tare' && await tx.vehicleExit.findUnique({ where: { visitId: id } })) {
        throw new HttpException({ code: 'DOMAIN_RULE', message: 'The truck has already exited. Tare is locked.' }, 422);
      }
      const readings = await this.weights.history(tx, [id]);
      const current = this.weights.current(readings);
      // R-04: a tare below the recorded gross is rejected with the mock's wording.
      if (input.kind === 'tare' && current.grossWeight && Number(input.value) >= Number(current.grossWeight.value)) {
        throw new HttpException({ code: 'VALIDATION_FAILED', message: 'Please check the highlighted fields.', fields: { value: `Tare must be less than the gross weight (${current.grossWeight.value} kg).` } }, 422);
      }
      // R-04: a second tare is a correction — resolve the current head and require a reason.
      const head = readings.find(reading => reading.kind === input.kind && !readings.some(correction => correction.correctsId === reading.id));
      const correcting = Boolean(head || input.correctsId);
      if (correcting && !reason?.trim()) {
        throw new HttpException({ code: 'VALIDATION_FAILED', message: 'Please check the highlighted fields.', fields: { correctionReason: `Enter the reason for ${input.kind === 'tare' ? 'changing the tare' : 'this correction'}.` } }, 422);
      }
      const effective = { ...input, ...(correcting && head && !input.correctsId ? { correctsId: head.id } : {}), ...(reason ? { reason } : {}) };
      const reading = await this.weights.append(tx, id, author.userId, effective);
      const net = this.weights.current((await this.weights.history(tx, [id]))).netWeight;
      const detail = input.kind === 'tare'
        ? (reading.previous ? `Tare ${reading.previous.value} → ${reading.created.value} kg. Reason: ${reason?.trim()}` : `Tare ${reading.created.value} kg. Net ${net?.value ?? '—'} kg (display only).`)
        : `Gross ${reading.created.value} kg recorded.`;
      await this.audit.append(tx, { entityType: 'Weighment', entityId: reading.created.id, actorId: author.userId,
        action: reading.previous ? 'weight_corrected' : 'weight_recorded', newValue: { ...reading.created, detail },
        ...(reading.previous ? { oldValue: reading.previous } : {}), ...(reason ? { reason } : {}) });
      return { status: 201, body: { data: await this.snapshot(tx, visit) } };
    });
  }
  correct(actor: Actor, id: string, key: string, version: number, input: CorrectVisitInput) {
    return this.writes.run(actor, 'receiving.edit', '/receiving-visits/' + id, key, { version, ...input }, async (tx, author) => {
      if (!Number.isInteger(version) || version < 1) throw new HttpException({ code: 'VALIDATION_FAILED', message: 'Please check the highlighted fields.', fields: { version: 'Reload the visit and try again.' } }, 422);
      const before = await this.repository.visible(tx, id); if (await tx.vehicleExit.findUnique({ where: { visitId: id } })) throw new HttpException({ code: 'DOMAIN_RULE', message: 'This truck has exited. Gate details are locked; a correction after exit needs an authorised process (pending KPMPL).' }, 422);
      if (input.supplierDisplayName !== undefined && input.supplierDisplayName !== before.supplierDisplayName && await tx.packageVisit.findUnique({ where: { visitId: id } })) throw new HttpException({ code: 'DOMAIN_RULE', message: 'This visit is linked to a document package. Remove it from the package before changing the supplier.' }, 422);
      const { reason, grossWeight, ...fields } = input; const changedFields = Object.entries(fields).some(([name, value]) => value !== before[name as keyof typeof before]);
      const readings = await this.weights.history(tx, [id]); const current = this.weights.current(readings); const grossChanged = grossWeight !== undefined && (current.grossWeight?.value !== Number(grossWeight.value).toFixed(3) || current.grossWeight?.unit !== grossWeight.unit);
      if (!changedFields && !grossChanged) throw new HttpException({ code: 'VALIDATION_FAILED', message: 'Please check the highlighted fields.', fields: { reason: 'Change at least one field, or go back.' } }, 422);
      await this.repository.claimVersion(tx, id, version); await tx.receivingVisit.update({ where: { id }, data: fields });
      if (grossWeight) { const previous = readings.filter(row => row.kind === 'gross' && !readings.some(correction => correction.correctsId === row.id)).at(-1); const tare = current.tareWeight; if (tare && (tare.unit !== grossWeight.unit || Number(grossWeight.value) <= Number(tare.value))) throw new HttpException({ code: 'DOMAIN_RULE', message: `Gross must be more than the recorded tare (${tare.value} kg).` }, 422); await this.weights.append(tx, id, author.userId, { kind: 'gross', ...grossWeight, ...(previous ? { correctsId: previous.id } : {}), reason }); }
      const after = await this.snapshot(tx, await this.repository.visible(tx, id));
      await this.audit.append(tx, { entityType: 'ReceivingVisit', entityId: id, actorId: author.userId, action: 'receiving_corrected', oldValue: await this.snapshot(tx, before), newValue: { ...after, detail: `Reason: ${reason.trim()}` }, reason });
      return { status: 200, body: { data: after } };
    }, 'PATCH');
  }
  async get(actor: Actor, id: string) {
    await this.auth.authorize(actor, 'receiving.view');
    return this.prisma.$transaction(async tx => ({ data: await this.snapshot(tx, await this.repository.visible(tx, id)) }), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }
  async list(actor: Actor, query: ListVisitsInput, queue: 'qc' | null = null) {
    await this.auth.authorize(actor, 'receiving.view');
    // Brief §3: paged payloads are a Page wrapped in the envelope — {data: {data, page, pageSize, total}}.
    return this.prisma.$transaction(async tx => {
      const result = await this.repository.page(tx, query, queue);
      return { data: { data: await this.snapshots(tx, result.data), page: query.page, pageSize: query.pageSize, total: result.total } };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }
  /** Brief §5.4: QcQueueItem[] — the QC work queue, oldest first. */
  async queue(actor: Actor) {
    await this.auth.authorize(actor, 'qc.queue.view');
    return this.prisma.$transaction(async tx => {
      const result = await this.repository.page(tx, { page: 1, pageSize: 500 }, 'qc');
      const visits = await this.snapshots(tx, result.data);
      const meta = await this.qc.queueMeta(tx, result.data.map(visit => visit.id));
      return { data: visits.map(visit => ({ visit, latestRevision: meta.get(visit.id)?.latestRevision ?? null,
        lastReturnReason: visit.qcStatus === 'returned' ? meta.get(visit.id)?.lastReturnReason ?? null : null })) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }
  async history(actor: Actor, id: string) {
    await this.auth.authorize(actor, 'receiving.view');
    return this.prisma.$transaction(async tx => { await this.repository.visible(tx, id); return { data: (await this.weights.history(tx, [id])).map(readingDto) }; });
  }
  /** Mock-approved timeline wording for each audit action (CONTRACT_DIFF #83). */
  private timelineAction(event: { action: string; newValue: Prisma.JsonValue | null }): { action: string; detail?: string } {
    const detail = (event.newValue as { detail?: string } | null)?.detail;
    const kind = (event.newValue as { kind?: string } | null)?.kind;
    const known: Record<string, string> = {
      receiving_created: 'Receiving visit created',
      receiving_corrected: 'Gate details corrected',
      weight_recorded: kind === 'tare' ? 'Tare recorded' : 'Gross weight recorded',
      weight_corrected: kind === 'tare' ? 'Tare corrected' : 'Gross weight corrected',
      qc_draft_saved: 'QC draft saved',
      qc_submitted: 'QC readings submitted',
      qc_returned: 'QC returned for correction',
      qc_accepted: 'QC accepted',
      qc_accepted_with_deduction: 'QC accepted with deduction',
      qc_rejected: 'QC rejected',
      exit_recorded: 'Physical exit recorded',
      grn_reference_recorded: 'Official GRN reference recorded',
      grn_reference_corrected: 'Official GRN reference corrected',
      package_linked: 'Linked to a document package',
      documents_sent_to_ho: 'Documents sent to Head Office',
      documents_resubmitted_to_ho: 'Documents resubmitted to Head Office',
    };
    // Decisions recorded before D-03 was decided (2026-11-03) carry demonstrationOnly in their
    // immutable audit row; keep saying so for those, and only for those.
    const legacyDemo = event.action.startsWith('qc_') && (event.newValue as { demonstrationOnly?: boolean } | null)?.demonstrationOnly === true;
    const action = (known[event.action] ?? event.action) + (legacyDemo ? ' (demonstration only)' : '');
    return { action, ...(detail ? { detail } : {}) };
  }
  async timeline(actor: Actor, id: string) {
    await this.auth.authorize(actor, 'receiving.view'); await this.repository.visible(this.prisma, id);
    const events = await this.prisma.auditEvent.findMany({ where: { OR: [{ entityType: 'ReceivingVisit', entityId: id }, { newValue: { path: ['visitId'], equals: id } }] }, orderBy: { recordedAt: 'desc' } });
    const users = await this.prisma.user.findMany({ where: { id: { in: events.flatMap(event => event.actorId ? [event.actorId] : []) } }, select: { id: true, fullName: true } }); const names = new Map(users.map(user => [user.id, user.fullName]));
    return { data: events.map(event => {
      const wording = this.timelineAction(event);
      return { id: event.id.toString(), at: event.recordedAt.toISOString(), actor: event.actorId ? names.get(event.actorId) ?? 'Unknown user' : 'System',
        action: wording.action, ...(wording.detail ? { detail: wording.detail } : event.reason ? { detail: event.reason } : {}), source: event.source as 'app' | 'manual_staff_confirmation' };
    }) };
  }
  async referenceData(actor: Actor) {
    await this.auth.authorize(actor, 'auth.self');
    const [used, seeded] = await Promise.all([
      this.prisma.$transaction(async tx => {
        const [suppliers, materials] = await Promise.all([
          tx.receivingVisit.findMany({ where: { supplierDisplayName: { not: null } }, distinct: ['supplierDisplayName'], select: { supplierDisplayName: true }, orderBy: { supplierDisplayName: 'asc' } }),
          tx.receivingVisit.findMany({ where: { materialDisplayName: { not: null } }, distinct: ['materialDisplayName'], select: { materialDisplayName: true }, orderBy: { materialDisplayName: 'asc' } }),
        ]);
        return { suppliers: suppliers.flatMap(item => item.supplierDisplayName ? [item.supplierDisplayName] : []), materials: materials.flatMap(item => item.materialDisplayName ? [item.materialDisplayName] : []) };
      }),
      this.prisma.referenceValue.findMany({ where: { active: true }, orderBy: { value: 'asc' } }),
    ]);
    // Brief §5.2: distinct values in use plus the seeded admin-managed list.
    const merge = (list: string[], kind: 'supplier' | 'material') => [...new Set([...list, ...seeded.filter(row => row.kind === kind).map(row => row.value)])].sort((a, b) => a.localeCompare(b));
    return { data: { suppliers: merge(used.suppliers, 'supplier'), materials: merge(used.materials, 'material') } };
  }
}
