import { HttpException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../identity-access/auth.service';
import type { Actor } from '../identity-access/identity.types';
import type { Capability } from '../identity-access/policy';
import { conflict, IdempotentWriteService } from '../platform/idempotent-write.service';
import { ReceivingService } from '../receiving/receiving.service';
import { categories, categoryLabels, milestones, milestoneShort, type PackageAction } from './document.schemas';
import { createHash, randomUUID } from 'node:crypto';
import { FileStorageService } from './file-storage.service';
import { MalwareScannerService } from './malware-scanner.service';

const HO_VISIBLE = ['submitted_to_ho', 'under_ho_review', 'correction_requested', 'resubmitted', 'verified'];
// R-10: gate-side edit states (ready packages go back to draft on any checklist change).
const GATE_EDITABLE = ['draft', 'ready_for_gate_check', 'correction_requested'];
const CHECKLIST_VERSION = 'demo-checklist-0 (not approved)';
const REMINDER_RECIPIENT = 'Plant Head (recipient and channel pending, D-09)';
const domain = (message: string, fields?: Record<string, string>, meta?: object) => new HttpException(fields
  ? { code: 'VALIDATION_FAILED', message: 'Please check the highlighted fields.', fields, ...(meta ? { meta } : {}) }
  : { code: 'DOMAIN_RULE', message, ...(meta ? { meta } : {}) }, 422);
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const safeFilename = (value: string) => Array.from(value).map(character => { const code = character.charCodeAt(0); return character === '/' || character === '\\' || code < 32 || code === 127 ? '_' : character; }).join('').slice(0, 120);

const include = {
  visits: { include: { visit: true } }, items: { orderBy: { position: 'asc' as const } },
  files: { where: { deletedAt: null }, orderBy: { uploadedAt: 'asc' as const } },
  corrections: { orderBy: { requestedAt: 'asc' as const } }, erp: true,
  reminders: { orderBy: { recordedAt: 'asc' as const } },
  history: { include: { actor: true }, orderBy: { recordedAt: 'asc' as const } },
};

/** Mock-approved history wording for each stored action (CONTRACT_DIFF #83). */
const HISTORY_WORDS: Record<string, string> = {
  package_created: 'Package created', package_updated: 'Package details updated', mark_ready: 'Marked ready for authority check',
  back_to_draft: 'Sent back to Gate for changes', submit_to_ho: 'Sent to Head Office', start_review: 'Head Office review started',
  request_correction: 'Correction requested', verify: 'Documents verified by Head Office',
  document_checked: 'Document checked', applicability_changed: 'Checklist updated', file_attached: 'File attached', file_removed: 'File removed',
  reminder_logged: 'Approval reminder logged',
};

type PackageRow = Prisma.DocumentPackageGetPayload<{ include: typeof include }>;

@Injectable()
export class DocumentsService {
  constructor(private readonly prisma: PrismaService, private readonly auth: AuthService, private readonly writes: IdempotentWriteService,
    private readonly audit: AuditService, private readonly storage: FileStorageService, private readonly scanner: MalwareScannerService,
    private readonly receiving: ReceivingService) {}

  private async row(tx: Prisma.TransactionClient, id: string): Promise<PackageRow> {
    const found = await tx.documentPackage.findUnique({ where: { id }, include });
    if (!found) throw new NotFoundException();
    return found;
  }
  /** Brief §5.7/§5.8 DocumentPackageView — exact shapes and the resolved visits. */
  private async view(tx: Prisma.TransactionClient, row: PackageRow) {
    const nameIds = [...new Set([
      ...row.files.map(file => file.uploadedBy),
      ...row.erp.flatMap(item => item.confirmedBy ? [item.confirmedBy] : []),
      ...row.reminders.map(item => item.recordedBy),
      ...row.corrections.flatMap(item => item.requestedBy ? [item.requestedBy] : []),
      row.createdBy, ...(row.submittedBy ? [row.submittedBy] : []),
    ])];
    const people = await tx.user.findMany({ where: { id: { in: nameIds } }, select: { id: true, fullName: true } });
    const names = new Map(people.map(user => [user.id, user.fullName]));
    const nameOf = (id: string | null | undefined) => (id ? names.get(id) ?? 'Unknown user' : null);
    const files = row.files.map(file => ({ id: file.id, category: file.category, name: file.originalName, sizeBytes: file.size, mimeType: 'application/pdf',
      uploadedAt: file.uploadedAt.toISOString(), uploadedBy: nameOf(file.uploadedBy)!, synthetic: false }));
    const visitSnapshots = await Promise.all(row.visits.map(link => this.receiving.snapshot(tx, link.visit)));
    return {
      id: row.id, packageRef: row.packageRef, visitIds: row.visits.map(link => link.visitId), invoiceRef: row.invoiceRef,
      supplierDisplayName: row.supplierDisplayName, status: row.status, checklistVersion: CHECKLIST_VERSION,
      items: row.items.map(item => {
        const itemFiles = files.filter(file => file.category === item.category);
        // R-11: a row is resolved when attached (≥1 clean file) or explicitly not applicable.
        const state = item.notApplicableReason ? 'not_applicable' : itemFiles.length ? 'attached' : 'missing';
        return { category: item.category, state, files: itemFiles, notApplicableReason: item.notApplicableReason, hoCheck: item.hoCheck, hoNote: item.hoNote };
      }),
      submittedBy: nameOf(row.submittedBy), submittedAt: row.submittedAt?.toISOString() ?? null,
      corrections: row.corrections.map(item => ({ id: item.id, reason: item.reason, categories: item.categories, requestedBy: nameOf(item.requestedBy) ?? 'Head Office',
        requestedAt: item.requestedAt.toISOString(), resolvedAt: item.resolvedAt?.toISOString() ?? null, responseNote: item.responseNote })),
      erp: milestones.map(type => { const item = row.erp.find(value => value.type === type)!; return { type, status: item.status as 'pending' | 'confirmed',
        dataManRef: item.dataManRef, erpOccurredAt: item.erpOccurredAt?.toISOString() ?? null, note: item.note,
        confirmedBy: nameOf(item.confirmedBy), confirmedAt: item.confirmedAt?.toISOString() ?? null, source: item.source as 'manual_staff_confirmation' | 'staff_confirmed' }; }),
      reminders: row.reminders.map(item => ({ id: item.id, recipient: REMINDER_RECIPIENT, note: item.note, sentBy: nameOf(item.recordedBy)!, sentAt: item.recordedAt.toISOString() })),
      history: row.history.map(item => ({ id: item.id, at: item.recordedAt.toISOString(), actor: item.actor.fullName,
        action: HISTORY_WORDS[item.action] ?? item.action, ...(item.detail ? { detail: item.detail } : {}), source: item.source as 'app' | 'manual_staff_confirmation' })),
      visits: visitSnapshots,
      createdBy: nameOf(row.createdBy)!, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), version: row.version,
    };
  }
  private async present(tx: Prisma.TransactionClient, id: string) {
    return this.view(tx, await this.row(tx, id));
  }
  private async editable(tx: Prisma.TransactionClient, id: string) {
    const before = await this.row(tx, id);
    if (!GATE_EDITABLE.includes(before.status)) throw domain('This package is with Head Office and cannot be changed now.');
    return before;
  }
  private async claim(tx: Prisma.TransactionClient, id: string, version: number) {
    const changed = await tx.documentPackage.updateMany({ where: { id, version }, data: { version: { increment: 1 } } });
    if (!changed.count) {
      const current = await tx.documentPackage.findUnique({ where: { id }, select: { version: true } });
      throw conflict('VERSION_CONFLICT', 'The package changed. Reload before retrying.', { currentVersion: current?.version });
    }
    return this.row(tx, id);
  }
  private async history(tx: Prisma.TransactionClient, packageId: string, actorId: string, action: string, detail?: string, source = 'app') {
    await tx.packageHistory.create({ data: { packageId, actorId, action, detail, source } });
  }
  /** R-12/R-14: rows still missing a clean attachment or an explicit not-applicable reason. */
  private unresolved(row: PackageRow) {
    return row.items.filter(item => !item.notApplicableReason && !row.files.some(file => file.category === item.category && file.scanStatus === 'clean')).map(item => item.category);
  }
  private missingMessage(missing: string[]) {
    return `Attach or mark not applicable: ${missing.map(category => categoryLabels[category as keyof typeof categoryLabels] ?? category).join(', ')}.`;
  }
  private async assertMembership(tx: Prisma.TransactionClient, visitIds: string[], ignorePackageId?: string) {
    // R-09: one truck, one package; conflicts name the Gate Entry No.
    const taken = await tx.packageVisit.findFirst({ where: { visitId: { in: visitIds }, packageId: ignorePackageId ? { not: ignorePackageId } : undefined }, include: { visit: { select: { officialGateEntryRef: true } } } });
    if (taken) throw domain('Please check the highlighted fields.', { visitIds: `${taken.visit.officialGateEntryRef} is already linked to another document package.` });
  }
  private async linkedVisits(tx: Prisma.TransactionClient, ids: string[]) {
    const visits = await tx.receivingVisit.findMany({ where: { id: { in: ids } }, include: { packageLink: true } });
    if (visits.length !== ids.length) throw domain('Please check the highlighted fields.', { visitIds: 'One of the selected visits no longer exists.' });
    const suppliers = new Set(visits.map(visit => visit.supplierDisplayName));
    if (suppliers.size !== 1 || visits[0]?.supplierDisplayName === null) throw domain('Please check the highlighted fields.', { visitIds: 'All linked trucks must be from the same supplier.' });
    return visits;
  }
  private async noteVisitLinks(tx: Prisma.TransactionClient, packageRef: string, actorId: string, visitIds: string[], action: string, detail?: string) {
    for (const visitId of visitIds) {
      await this.audit.append(tx, { entityType: 'ReceivingVisit', entityId: visitId, actorId, action, newValue: { visitId, packageRef, ...(detail ? { detail } : {}) } });
    }
  }

  async list(actor: Actor, hoOnly = false) {
    await this.auth.authorize(actor, hoOnly ? 'ho.inbox' : 'docs.prepare');
    return this.prisma.$transaction(async tx => {
      const rows = await tx.documentPackage.findMany({ where: hoOnly ? { status: { in: HO_VISIBLE } } : {}, include, orderBy: { updatedAt: 'desc' } });
      const views = await Promise.all(rows.map(row => this.view(tx, row)));
      return { data: views };
    });
  }
  async get(actor: Actor, id: string) {
    const ho = actor.capabilities.includes('ho.inbox') && !actor.capabilities.includes('docs.prepare');
    await this.auth.authorize(actor, ho ? 'ho.inbox' : 'docs.prepare');
    return this.prisma.$transaction(async tx => {
      const row = await this.row(tx, id);
      // Record-level visibility: HO sees packages only in HO_VISIBLE states, else NOT_FOUND.
      if (ho && !HO_VISIBLE.includes(row.status)) throw new NotFoundException();
      return { data: await this.view(tx, row) };
    });
  }
  create(actor: Actor, key: string, input: { visitIds: string[]; invoiceRef?: string }) {
    return this.writes.run(actor, 'docs.prepare', '/document-packages', key, input, async (tx, current) => {
      const unique = [...new Set(input.visitIds)];
      if (unique.length !== input.visitIds.length) throw domain('Please check the highlighted fields.', { visitIds: 'Select each truck only once.' });
      const visits = await this.linkedVisits(tx, unique);
      await this.assertMembership(tx, unique);
      const sequence = await tx.$queryRaw<{ value: bigint }[]>`SELECT nextval('"PackageRefSeq"') AS value`;
      const packageRef = 'DEMO-PKG-' + String(sequence[0]!.value).padStart(4, '0');
      const created = await tx.documentPackage.create({ data: { packageRef, invoiceRef: input.invoiceRef, supplierDisplayName: visits[0]!.supplierDisplayName, createdBy: current.userId,
        visits: { create: unique.map(visitId => ({ visitId })) }, items: { create: categories.map((category, position) => ({ category, position })) },
        erp: { create: milestones.map(type => ({ type })) }, history: { create: { actorId: current.userId, action: 'package_created', detail: `Linked ${visits.map(visit => visit.officialGateEntryRef).join(', ')}.` } } } });
      await this.audit.append(tx, { entityType: 'DocumentPackage', entityId: created.id, actorId: current.userId, action: 'package_created', newValue: { packageRef, visitIds: unique } });
      await this.noteVisitLinks(tx, packageRef, current.userId, unique, 'package_linked', `Linked to document package ${packageRef}.`);
      return { status: 201, body: json({ data: await this.present(tx, created.id) }) };
    });
  }
  update(actor: Actor, id: string, key: string, version: number, input: { visitIds?: string[]; invoiceRef?: string | null }) {
    return this.writes.run(actor, 'docs.prepare', '/document-packages/' + id, key, { version, ...input }, async (tx, current) => {
      const before = await this.editable(tx, id);
      await this.claim(tx, id, version);
      const parts: string[] = [];
      if (input.visitIds) {
        const unique = [...new Set(input.visitIds)];
        if (unique.length !== input.visitIds.length) throw domain('Please check the highlighted fields.', { visitIds: 'Select each truck only once.' });
        await this.linkedVisits(tx, unique);
        await this.assertMembership(tx, unique, id);
        const beforeVisits = before.visits.map(link => link.visit.officialGateEntryRef);
        await tx.packageVisit.deleteMany({ where: { packageId: id } }); await tx.packageVisit.createMany({ data: unique.map(visitId => ({ packageId: id, visitId })) });
        const after = await this.linkedVisits(tx, unique);
        await tx.documentPackage.update({ where: { id }, data: { supplierDisplayName: after[0]!.supplierDisplayName } });
        const added = after.map(visit => visit.officialGateEntryRef).filter(ref => !beforeVisits.includes(ref));
        const removed = beforeVisits.filter(ref => !after.map(visit => visit.officialGateEntryRef).includes(ref));
        if (added.length) parts.push(`Added ${added.join(', ')}`);
        if (removed.length) parts.push(`Removed ${removed.join(', ')}`);
      }
      if (input.invoiceRef !== undefined) {
        const next = input.invoiceRef?.trim() || null;
        if (next !== before.invoiceRef) parts.push(`Invoice ref ${before.invoiceRef ?? '—'} → ${next ?? '—'}`);
        await tx.documentPackage.update({ where: { id }, data: { invoiceRef: next } });
      }
      if (parts.length) await this.history(tx, id, current.userId, 'package_updated', parts.join('; ') + '.');
      return { status: 200, body: json({ data: await this.present(tx, id) }) };
    }, 'PATCH');
  }
  applicability(actor: Actor, id: string, category: string, key: string, version: number, reason: string | null) {
    return this.writes.run(actor, 'docs.prepare', `/document-packages/${id}/items/${category}/applicability`, key, { version, notApplicableReason: reason }, async (tx, current) => {
      const before = await this.editable(tx, id);
      await this.claim(tx, id, version);
      if (reason !== null) {
        // R-11: not applicable is not allowed while files are attached.
        if (before.files.some(file => file.category === category)) throw domain('Remove the attached files before marking this document not applicable.');
        await tx.packageItem.update({ where: { packageId_category: { packageId: id, category } }, data: { notApplicableReason: reason, hoCheck: 'unchecked', hoNote: null } });
        await this.history(tx, id, current.userId, 'applicability_changed', `${categoryLabels[category]}: ${reason}`);
      } else {
        await tx.packageItem.update({ where: { packageId_category: { packageId: id, category } }, data: { notApplicableReason: null, hoCheck: 'unchecked', hoNote: null } });
        await this.history(tx, id, current.userId, 'applicability_changed', `Not-applicable mark removed: ${categoryLabels[category]}`);
      }
      // R-11: any checklist change sends a ready package back to draft, with the audit note.
      if (before.status === 'ready_for_gate_check') {
        await tx.documentPackage.update({ where: { id }, data: { status: 'draft' } });
        await this.history(tx, id, current.userId, 'back_to_draft', 'Checklist changed after it was marked ready.');
      }
      return { status: 200, body: json({ data: await this.present(tx, id) }) };
    }, 'PUT');
  }
  action(actor: Actor, id: string, key: string, version: number, input: PackageAction) {
    const capability: Capability = ['mark_ready'].includes(input.kind) ? 'docs.prepare' : ['back_to_draft', 'submit_to_ho'].includes(input.kind) ? 'docs.submit' : 'ho.review';
    return this.writes.run(actor, capability, `/document-packages/${id}/actions`, key, { version, ...input }, async (tx, current) => {
      const before = await this.row(tx, id); await this.claim(tx, id, version); let status = before.status;
      if (input.kind === 'mark_ready') {
        // R-12: only from draft, every row resolved, missing rows listed by label.
        if (status !== 'draft') throw domain('Only a draft package can be marked ready.');
        const missing = this.unresolved(before); if (missing.length) throw domain(this.missingMessage(missing), undefined, { categories: missing });
        status = 'ready_for_gate_check';
      }
      // R-13: only from ready, with a reason — the reason is persisted in the history detail.
      if (input.kind === 'back_to_draft') { if (status !== 'ready_for_gate_check') throw domain('Only a package waiting for authority check can be sent back.'); status = 'draft'; }
      if (input.kind === 'submit_to_ho') {
        // R-14: all rows resolved, confirmComplete true, resubmission needs a response note.
        if (!['ready_for_gate_check', 'correction_requested'].includes(status)) throw domain('This package is not waiting to be sent.');
        const missing = this.unresolved(before); if (missing.length) throw domain(this.missingMessage(missing), undefined, { categories: missing });
        if (status === 'correction_requested' && !input.responseNote) throw domain('Please check the highlighted fields.', { responseNote: 'Enter what was corrected before resending.' });
        const resubmit = status === 'correction_requested'; status = resubmit ? 'resubmitted' : 'submitted_to_ho';
        await tx.documentPackage.update({ where: { id }, data: { submittedBy: current.userId, submittedAt: new Date() } });
        if (resubmit) await tx.packageCorrection.updateMany({ where: { packageId: id, resolvedAt: null }, data: { resolvedAt: new Date(), responseNote: input.responseNote } });
      }
      if (input.kind === 'start_review') { if (!['submitted_to_ho', 'resubmitted'].includes(status)) throw domain('This package is not waiting for review.'); status = 'under_ho_review'; }
      if (input.kind === 'request_correction') {
        // R-17: only under review, reason + at least one category; rows are marked issue.
        if (status !== 'under_ho_review') throw domain('Start the review before requesting a correction.');
        await tx.packageItem.updateMany({ where: { packageId: id, category: { in: input.categories } }, data: { hoCheck: 'issue' } });
        await tx.packageCorrection.create({ data: { packageId: id, reason: input.reason, categories: input.categories, requestedBy: current.userId } });
        status = 'correction_requested';
      }
      if (input.kind === 'verify') {
        // R-18: every attached row must be checked ok.
        if (status !== 'under_ho_review') throw domain('Start the review before verifying.');
        const blocked = before.items.filter(item => before.files.some(file => file.category === item.category) && item.hoCheck !== 'ok').map(item => categoryLabels[item.category as keyof typeof categoryLabels] ?? item.category);
        if (blocked.length) throw domain(`Mark every attached document as checked first: ${blocked.join(', ')}.`);
        status = 'verified';
      }
      await tx.documentPackage.update({ where: { id }, data: { status } });
      const detail = input.kind === 'back_to_draft' ? input.reason.trim()
        : input.kind === 'submit_to_ho' ? (input.responseNote?.trim() ? `Correction note: ${input.responseNote.trim()}` : 'Authority confirmed the packet is complete. Head Office can open the PDFs now.')
        : input.kind === 'request_correction' ? `${input.categories.map(category => categoryLabels[category]).join(', ')} — ${input.reason.trim()}` : undefined;
      await this.history(tx, id, current.userId, input.kind, detail);
      await this.audit.append(tx, { entityType: 'DocumentPackage', entityId: id, actorId: current.userId, action: input.kind, oldValue: { status: before.status }, newValue: { status } });
      if (input.kind === 'submit_to_ho') {
        await this.noteVisitLinks(tx, before.packageRef, current.userId, before.visits.map(link => link.visitId), `documents_${status === 'resubmitted' ? 'resubmitted' : 'sent'}_to_ho`, `Documents ${status === 'resubmitted' ? 'resubmitted' : 'sent'} to Head Office (${before.packageRef}).`);
      }
      return { status: 200, body: json({ data: await this.present(tx, id) }) };
    });
  }
  review(actor: Actor, key: string, version: number, input: { packageId: string; category: string; check: string; note?: string }) {
    return this.writes.run(actor, 'ho.review', '/head-office/reviews', key, { version, ...input }, async (tx, current) => {
      const before = await this.row(tx, input.packageId);
      // R-16: only under review, only attached rows, issue requires a note (max 500 by schema).
      if (before.status !== 'under_ho_review') throw domain('Start the review to check documents.');
      if (!before.files.some(file => file.category === input.category)) throw domain('Only attached documents can be checked.');
      await this.claim(tx, input.packageId, version);
      await tx.packageItem.update({ where: { packageId_category: { packageId: input.packageId, category: input.category } }, data: { hoCheck: input.check, hoNote: input.check === 'issue' ? input.note : null } });
      await this.history(tx, input.packageId, current.userId, 'document_checked', `${categoryLabels[input.category]}${input.check === 'issue' && input.note ? `: ${input.note.trim()}` : ''}`);
      return { status: 200, body: json({ data: await this.present(tx, input.packageId) }) };
    });
  }
  erp(actor: Actor, id: string, key: string, version: number, input: { type: (typeof milestones)[number]; action: 'confirm'|'reverse'; dataManRef?: string; erpOccurredAt?: string; note?: string; verifiedInDataManByStaff: boolean }) {
    return this.writes.run(actor, 'erp.confirm', `/head-office/cases/${id}/erp-milestones`, key, { version, ...input }, async (tx, current) => {
      const before = await this.row(tx, id); if (!HO_VISIBLE.includes(before.status)) throw new NotFoundException(); await this.claim(tx, id, version);
      const index = milestones.indexOf(input.type); const currentMilestone = before.erp.find(item => item.type === input.type)!;
      if (input.action === 'confirm') {
        // R-19: strict order, DataMan proof, refs for the first two, no future event time.
        if (currentMilestone.status === 'confirmed') throw domain('This milestone is already confirmed. Reverse it first to change it.');
        if (index > 0 && before.erp.find(item => item.type === milestones[index - 1])?.status !== 'confirmed') throw domain(`Confirm “${milestoneShort[milestones[index - 1]!]}” first.`);
        if (index < 2 && !input.dataManRef?.trim()) throw domain('Please check the highlighted fields.', { dataManRef: `Enter the ${milestoneShort[input.type].toLowerCase()} reference.` });
        if (!input.verifiedInDataManByStaff) throw domain('Please check the highlighted fields.', { verifiedInDataManByStaff: 'Confirm you checked this in DataMan.' });
        const occurred = input.erpOccurredAt ? new Date(input.erpOccurredAt) : new Date(); if (occurred.getTime() > Date.now() + 5 * 60_000) throw domain('Please check the highlighted fields.', { erpOccurredAt: 'This time cannot be in the future.' });
        await tx.erpMilestone.update({ where: { packageId_type: { packageId: id, type: input.type } }, data: { status: 'confirmed', dataManRef: input.dataManRef, note: input.note ?? null, erpOccurredAt: occurred, confirmedAt: new Date(), confirmedBy: current.userId, reversedAt: null, reversalReason: null } });
      } else {
        // R-20: only a confirmed milestone with no later confirmed one; a reason is required.
        if (currentMilestone.status !== 'confirmed') throw domain('Only a confirmed milestone can be reversed.');
        const later = milestones.slice(index + 1).find(type => before.erp.find(item => item.type === type)?.status === 'confirmed');
        if (later) throw domain(`Reverse “${milestoneShort[later]}” first.`);
        if (!input.note?.trim()) throw domain('Please check the highlighted fields.', { note: 'Enter the reason for reversing this milestone.' });
        const was = currentMilestone.dataManRef;
        await tx.erpMilestone.update({ where: { packageId_type: { packageId: id, type: input.type } }, data: { status: 'pending', dataManRef: null, erpOccurredAt: null, note: null, confirmedAt: null, confirmedBy: null, reversedAt: new Date(), reversalReason: input.note } });
        await this.history(tx, id, current.userId, 'erp_reverse', `${milestoneShort[input.type]} reversed. Previously ${was ?? 'no reference'}. Reason: ${input.note.trim()}`, 'manual_staff_confirmation');
      }
      if (input.action === 'confirm') await this.history(tx, id, current.userId, 'erp_confirm', `${milestoneShort[input.type]} confirmed — ${input.dataManRef ?? 'No reference'} — staff states it was checked in DataMan.${input.note ? ` ${input.note.trim()}` : ''}`, 'manual_staff_confirmation');
      await this.audit.append(tx, { entityType: 'DocumentPackage', entityId: id, actorId: current.userId, action: `erp_${input.action}`, reason: input.note, source: 'manual_staff_confirmation', newValue: { type: input.type, dataManRef: input.dataManRef } });
      return { status: 200, body: json({ data: await this.present(tx, id), message: 'Manually confirmed by staff (not an ERP feed)' }) };
    });
  }
  reminder(actor: Actor, id: string, key: string, version: number, note: string) {
    return this.writes.run(actor, 'erp.confirm', `/head-office/cases/${id}/reminders`, key, { version, note }, async (tx, current) => {
      const before = await this.row(tx, id);
      // R-21: in-app record only, and only while Plant Head approval is pending.
      if (!HO_VISIBLE.includes(before.status)) throw new NotFoundException();
      if (before.erp.find(item => item.type === milestones[0])?.status === 'confirmed') throw domain('Plant Head approval is already confirmed for this package.');
      await this.claim(tx, id, version);
      await tx.reminder.create({ data: { packageId: id, note, recordedBy: current.userId, recipient: 'Plant Head', channel: 'pending' } });
      await this.history(tx, id, current.userId, 'reminder_logged', `In-app reminder only; no message was sent.${note.trim() ? ` Note: ${note.trim()}` : ''}`);
      return { status: 200, body: json({ data: await this.present(tx, id) }) };
    });
  }
  async upload(actor: Actor, id: string, key: string, version: number, category: string, file: { filename: string; mimetype: string; buffer: Buffer }) {
    // Brief §5.9: trust the magic bytes, never the client MIME type or extension.
    if (!file.buffer.length) throw domain('Please check the highlighted fields.', { file: 'The file is empty.' });
    if (file.buffer.subarray(0, 5).toString('ascii') !== '%PDF-') throw domain('Please check the highlighted fields.', { file: 'Only PDF files can be attached.' });
    const fileId = randomUUID();
    const storageKey = `packages/${id}/${fileId}.pdf`;
    const verdict = await this.scanner.scan(file.buffer).catch(() => { throw domain('The security scanner is unavailable. Try again later.'); });
    if (verdict === 'infected') throw domain('This file failed the security scan.');
    await this.storage.put(storageKey, file.buffer);
    try {
      return await this.writes.run(actor, 'docs.prepare', `/document-packages/${id}/files`, key, { version, category, sha256: createHash('sha256').update(file.buffer).digest('hex'), size: file.buffer.length, filename: file.filename }, async (tx, current) => {
        const before = await this.editable(tx, id); await this.claim(tx, id, version);
        await tx.documentFile.create({ data: { id: fileId, packageId: id, category, storageKey, sha256: createHash('sha256').update(file.buffer).digest('hex'), size: file.buffer.length, originalName: safeFilename(file.filename), scanStatus: 'clean', uploadedBy: current.userId } });
        await tx.packageItem.update({ where: { packageId_category: { packageId: id, category } }, data: { notApplicableReason: null, hoCheck: 'unchecked', hoNote: null } });
        if (before.status === 'ready_for_gate_check') {
          await tx.documentPackage.update({ where: { id }, data: { status: 'draft' } });
          await this.history(tx, id, current.userId, 'back_to_draft', 'Files changed after it was marked ready.');
        }
        await this.history(tx, id, current.userId, 'file_attached', `${categoryLabels[category as keyof typeof categoryLabels] ?? category}: ${safeFilename(file.filename)}`);
        return { status: 201, body: json({ data: await this.present(tx, id) }) };
      });
    } catch (error) { await this.storage.delete(storageKey).catch(() => undefined); throw error; }
  }
  removeFile(actor: Actor, id: string, fileId: string, category: string, key: string, version: number) {
    return this.writes.run(actor, 'docs.prepare', `/document-packages/${id}/files/${fileId}`, key, { version, category }, async (tx, current) => {
      const before = await this.editable(tx, id); await this.claim(tx, id, version);
      const target = before.files.find(file => file.id === fileId && file.category === category);
      if (!target) throw new NotFoundException();
      const changed = await tx.documentFile.updateMany({ where: { id: fileId, packageId: id, category, deletedAt: null }, data: { deletedAt: new Date() } }); if (!changed.count) throw new NotFoundException();
      await tx.packageItem.update({ where: { packageId_category: { packageId: id, category } }, data: { hoCheck: 'unchecked', hoNote: null } });
      await this.history(tx, id, current.userId, 'file_removed', `${categoryLabels[category]}: ${target.originalName}`);
      if (before.status === 'ready_for_gate_check') {
        await tx.documentPackage.update({ where: { id }, data: { status: 'draft' } });
        await this.history(tx, id, current.userId, 'back_to_draft', 'Files changed after it was marked ready.');
      }
      return { status: 200, body: json({ data: await this.present(tx, id) }) };
    }, 'DELETE');
  }
  async content(actor: Actor, fileId: string) {
    const file = await this.prisma.documentFile.findUnique({ where: { id: fileId }, include: { package: true } }); if (!file || file.deletedAt || file.scanStatus !== 'clean') throw new NotFoundException();
    const gate = actor.capabilities.includes('docs.prepare'); const ho = actor.capabilities.includes('ho.inbox') && HO_VISIBLE.includes(file.package.status); if (!gate && !ho) throw new NotFoundException();
    const body = await this.storage.get(file.storageKey); if (!body) throw new NotFoundException(); return { body: Buffer.from(body), filename: file.originalName };
  }
}
