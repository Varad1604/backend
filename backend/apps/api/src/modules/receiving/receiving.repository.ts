import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { ListVisitsInput } from './receiving.schemas';
import { conflict } from '../platform/idempotent-write.service';
const QC_QUEUE_STATUSES = ['in_progress', 'returned', 'submitted'];
@Injectable()
export class ReceivingRepository {
  async visible(tx: Prisma.TransactionClient, id: string) {
    const visit = await tx.receivingVisit.findFirst({ where: { id } });
    if (!visit) throw new NotFoundException();
    return visit;
  }
  async claimVersion(tx: Prisma.TransactionClient, id: string, version: number) {
    await this.visible(tx, id);
    const changed = await tx.receivingVisit.updateMany({ where: { id, version }, data: { version: { increment: 1 } } });
    // Brief §3: a version mismatch carries the row's current version in meta.
    if (!changed.count) {
      const current = await tx.receivingVisit.findUnique({ where: { id }, select: { version: true } });
      throw conflict('VERSION_CONFLICT', 'The visit changed. Reload before retrying.', { currentVersion: current?.version });
    }
    return this.visible(tx, id);
  }
  /** Effective QC status per visit: the newest inspection's status, or 'pending' before the first one. */
  async page(tx: Prisma.TransactionClient, query: ListVisitsInput, queue: 'qc' | null = null) {
    let where: Prisma.ReceivingVisitWhereInput = {
      ...(query.officialGateEntryRef !== undefined ? { officialGateEntryRef: query.officialGateEntryRef } : {}),
      ...(query.exitStatus !== undefined ? { vehicleExit: query.exitStatus === 'exited' ? { isNot: null } : null } : {}),
      ...(query.grnStatus !== undefined ? { grnLinks: query.grnStatus === 'reference_recorded' ? { some: {} } : { none: {} } } : {}),
    };
    if (query.search) {
      // Brief §5.2: search is case-insensitive over gate entry ref, vehicle, supplier and GRN ref.
      const grnVisits = await tx.gRNLink.findMany({ where: { reference: { officialGrnRef: { contains: query.search, mode: 'insensitive' } } }, select: { visitId: true } });
      where = { ...where, OR: [
        { officialGateEntryRef: { contains: query.search, mode: 'insensitive' } },
        { vehicleNumber: { contains: query.search, mode: 'insensitive' } },
        { supplierDisplayName: { contains: query.search, mode: 'insensitive' } },
        ...(grnVisits.length ? [{ id: { in: grnVisits.map(link => link.visitId) } }] : []),
      ] };
    }
    if (query.qcStatus?.length) {
      // Explicit qcStatus filters match the effective status, including 'pending' for visits without an inspection.
      const matching = await this.visitsWithStatus(tx, where, new Set(query.qcStatus));
      where = { ...where, id: { in: matching } };
    }
    if (queue === 'qc') where = { ...where, id: { in: await this.visitsWithStatus(tx, where, new Set(['pending', ...QC_QUEUE_STATUSES])) } };
    const [data, total] = await Promise.all([
      tx.receivingVisit.findMany({
        where, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize, take: query.pageSize,
      }),
      tx.receivingVisit.count({ where }),
    ]);
    return { data, total };
  }
  /** Ids of visits whose effective QC status is one of `wanted` (includes un-inspected visits when 'pending'). */
  private async visitsWithStatus(tx: Prisma.TransactionClient, where: Prisma.ReceivingVisitWhereInput, wanted: Set<string>) {
    const includePending = wanted.has('pending');
    const inspected = wanted.size - (includePending ? 1 : 0) > 0
      ? await tx.qCInspection.findMany({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { visitId: true, qcStatus: true } })
      : [];
    const latest = new Map<string, string>();
    for (const row of inspected) if (!latest.has(row.visitId) && wanted.has(row.qcStatus)) latest.set(row.visitId, row.qcStatus);
    const ids = [...latest.keys()];
    if (includePending) {
      const unstarted = await tx.receivingVisit.findMany({ where: { ...where, qcInspections: { none: {} } }, select: { id: true } });
      ids.push(...unstarted.map(visit => visit.id));
    }
    return ids;
  }
}
