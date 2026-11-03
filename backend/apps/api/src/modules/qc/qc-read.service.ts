import { Injectable } from '@nestjs/common';
import type { Prisma, QCInspection, QCRevision, QCReview } from '@prisma/client';
type RevisionWithRows = QCRevision & { measurementRows?: { code: string; value: Prisma.Decimal; unit: string }[] };
type InspectionFull = QCInspection & { revisions: RevisionWithRows[]; reviews: (QCReview & { recorder: { fullName: string } })[] };
const NOT_CONFIGURED = { status: 'not_configured', value: null } as const;

const revisionDto = (revision: RevisionWithRows, recordedBy: string) => ({
  revision: revision.revisionNo,
  state: revision.state as 'draft' | 'submitted',
  // Fixed scale 2 strings (brief §3); numeric rows are authoritative, the JSON column keeps the audit trail.
  measurements: revision.measurementRows?.length
    ? revision.measurementRows.map(row => ({ code: row.code, value: row.value.toFixed(2), unit: row.unit }))
    : (revision.measurements as { code: string; value: string; unit: string }[]),
  remarks: revision.remarks,
  revisionReason: revision.revisionReason,
  recordedBy,
  recordedAt: revision.submittedAt.toISOString(),
});

@Injectable()
export class QcReadService {
  async userNames(tx: Prisma.TransactionClient, ids: string[]) {
    if (!ids.length) return new Map<string, string>();
    const users = await tx.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } });
    return new Map(users.map(user => [user.id, user.fullName]));
  }
  async inspectionsDto(tx: Prisma.TransactionClient, visitId: string): Promise<InspectionFull[]> {
    return tx.qCInspection.findMany({
      where: { visitId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: {
        revisions: { orderBy: { revisionNo: 'asc' }, include: { measurementRows: { orderBy: { recordedAt: 'asc' } } } },
        reviews: { orderBy: { recordedAt: 'asc' }, include: { recorder: { select: { fullName: true } } } },
      },
    });
  }
  /** Brief §5.4 QcInspection shape: {inspectionId, visitId, qcStatus, revisions, reviews, deductionCalculation}. */
  async inspectionDtos(tx: Prisma.TransactionClient, visitId: string) {
    const inspections = await this.inspectionsDto(tx, visitId);
    const names = await this.userNames(tx, [
      ...inspections.flatMap(inspection => inspection.revisions.map(revision => revision.submittedBy)),
      ...inspections.flatMap(inspection => inspection.reviews.map(review => review.recordedBy)),
    ]);
    return inspections.map(inspection => ({
      inspectionId: inspection.id,
      visitId: inspection.visitId,
      qcStatus: inspection.qcStatus,
      revisions: inspection.revisions.map(revision => revisionDto(revision, names.get(revision.submittedBy) ?? 'Unknown user')),
      reviews: inspection.reviews.map(review => ({
        outcome: review.outcome as 'returned' | 'accepted' | 'accepted_with_deduction' | 'rejected',
        reason: review.reason,
        demonstrationOnly: review.demonstrationOnly,
        recordedBy: names.get(review.recordedBy) ?? 'Unknown user',
        recordedAt: review.recordedAt.toISOString(),
        forRevision: review.forRevision,
      })),
      deductionCalculation: NOT_CONFIGURED,
    }));
  }
  /** Effective visit QC status: newest inspection wins, 'pending' before the first inspection (brief §5.2). */
  async states(tx: Prisma.TransactionClient, ids: string[]) {
    const inspections = await tx.qCInspection.findMany({ where: { visitId: { in: ids } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { visitId: true, qcStatus: true } });
    const latest = new Map<string, string>();
    for (const inspection of inspections) if (!latest.has(inspection.visitId)) latest.set(inspection.visitId, inspection.qcStatus);
    return new Map(ids.map(id => [id, { qcStatus: (latest.get(id) ?? 'pending') as string }]));
  }
  /** latestRevision + lastReturnReason per visit for the QcQueueItem shape. */
  async queueMeta(tx: Prisma.TransactionClient, ids: string[]) {
    const inspections = await tx.qCInspection.findMany({
      where: { visitId: { in: ids } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: { revisions: { orderBy: { revisionNo: 'desc' }, take: 1, select: { revisionNo: true } }, reviews: { where: { outcome: 'returned' }, orderBy: { recordedAt: 'desc' }, take: 1, select: { reason: true } } },
    });
    const meta = new Map<string, { latestRevision: number | null; lastReturnReason: string | null }>();
    for (const inspection of inspections) if (!meta.has(inspection.visitId)) {
      meta.set(inspection.visitId, { latestRevision: inspection.revisions[0]?.revisionNo ?? null, lastReturnReason: inspection.reviews[0]?.reason ?? null });
    }
    return meta;
  }
}
