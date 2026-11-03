import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
@Injectable()
export class MovementReadService {
  async states(tx: Prisma.TransactionClient, ids: string[]) {
    const [exits, links] = await Promise.all([
      tx.vehicleExit.findMany({ where: { visitId: { in: ids } }, orderBy: { recordedAt: 'asc' } }),
      tx.gRNLink.findMany({ where: { visitId: { in: ids } }, include: { reference: { select: { officialGrnRef: true } } }, orderBy: { createdAt: 'asc' } }),
    ]);
    const exited = new Map(exits.map(exit => [exit.visitId, exit]));
    // The latest linked reference is the visit's current official GRN (brief §5.2 officialGrnRef).
    const grnRefs = new Map<string, string>();
    for (const link of links) grnRefs.set(link.visitId, link.reference.officialGrnRef);
    return new Map(ids.map(id => {
      const exit = exited.get(id);
      return [id, { exitStatus: exit ? 'exited' : 'on_premises', grnStatus: grnRefs.has(id) ? 'reference_recorded' : 'not_recorded',
        officialGrnRef: grnRefs.get(id) ?? null, physicalExitAt: exit ? exit.physicalExitAt.toISOString() : null }];
    }));
  }
  async references(tx: Prisma.TransactionClient, id: string) {
    const links = await tx.gRNLink.findMany({ where: { visitId: id }, include: { reference: true }, orderBy: { createdAt: 'asc' } });
    return links.map(link => ({ ...link.reference, recordedAt: link.reference.recordedAt.toISOString() }));
  }
}
