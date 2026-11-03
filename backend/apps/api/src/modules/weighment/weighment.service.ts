import { ConflictException, Injectable, UnprocessableEntityException } from '@nestjs/common';
import type { Prisma, Weighment } from '@prisma/client';
import { decimalWeight, netWeight, scaledWeight } from './weight';
export type ReadingInput = { kind: 'gross' | 'tare'; value: string; unit: 'kg' | 'mt'; correctsId?: string; reason?: string };
export const readingDto = (reading: Weighment) => ({ ...reading, value: reading.value.toFixed(3), recordedAt: reading.recordedAt.toISOString() });
@Injectable()
export class WeighmentService {
  async history(tx: Prisma.TransactionClient, visitIds: string[]): Promise<Weighment[]> {
    return tx.weighment.findMany({ where: { visitId: { in: visitIds } }, orderBy: [{ recordedAt: 'asc' }, { id: 'asc' }] });
  }
  current(readings: readonly Weighment[]) {
    const superseded = new Set(readings.flatMap(reading => reading.correctsId ? [reading.correctsId] : []));
    const heads = readings.filter(reading => !superseded.has(reading.id));
    const gross = heads.find(reading => reading.kind === 'gross');
    const tare = heads.find(reading => reading.kind === 'tare');
    // kg only (brief §3): the schema no longer accepts other units.
    const weight = (reading?: Weighment) => reading ? { value: reading.value.toFixed(3), unit: 'kg' as const } : null;
    const grossWeight = weight(gross), tareWeight = weight(tare);
    return { grossWeight, tareWeight, netWeight: grossWeight && tareWeight ? netWeight(grossWeight, tareWeight) : null };
  }
  async append(tx: Prisma.TransactionClient, visitId: string, actorId: string, input: ReadingInput) {
    const readings = await this.history(tx, [visitId]);
    const superseded = new Set(readings.flatMap(reading => reading.correctsId ? [reading.correctsId] : []));
    const head = readings.find(reading => reading.kind === input.kind && !superseded.has(reading.id));
    if ((head && input.correctsId !== head.id) || (!head && input.correctsId)) throw new ConflictException('Correct the current reading; previous readings cannot be replaced.');
    if (input.correctsId && !input.reason?.trim()) throw new UnprocessableEntityException('A correction requires a reason.');
    const current = this.current(readings);
    const replacement = { value: input.value, unit: input.unit };
    const gross = input.kind === 'gross' ? replacement : current.grossWeight;
    const tare = input.kind === 'tare' ? replacement : current.tareWeight;
    try {
      scaledWeight(input.value);
      if (gross && tare) netWeight(gross, tare);
    } catch (error) { throw new UnprocessableEntityException(error instanceof Error ? error.message : 'Invalid weight.'); }
    const created = await tx.weighment.create({ data: { visitId, kind: input.kind, value: decimalWeight(scaledWeight(input.value)), unit: input.unit,
      recordedBy: actorId, correctsId: input.correctsId, reason: input.reason } });
    return { created: readingDto(created), previous: head ? readingDto(head) : null };
  }
}
