import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { hashRow, verifyRows } from './audit-chain';
interface AuditInput {
  entityType: string; entityId: string; action: string; actorId?: string;
  oldValue?: Prisma.InputJsonValue; newValue?: Prisma.InputJsonValue; reason?: string; source?: 'app' | 'manual_staff_confirmation';
}
@Injectable()
export class AuditService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private readonly logger = new Logger(AuditService.name);
  constructor(private readonly prisma: PrismaService) {}
  onModuleInit() {
    this.timer = setInterval(() => { void this.verify().then(result => {
      if (!result.valid) this.logger.error({ message: 'Audit chain verification failed', ...result });
    }).catch(() => this.logger.error('Audit chain verification could not run')); }, 86_400_000);
    this.timer.unref();
  }
  onModuleDestroy() { clearInterval(this.timer); }
  async append(tx: Prisma.TransactionClient, input: AuditInput): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(6200002)`;
    const last = await tx.auditEvent.findFirst({ orderBy: { id: 'desc' }, select: { rowHash: true } });
    const [meta] = await tx.$queryRaw<{ id: bigint; recordedAt: Date }[]>`SELECT nextval(pg_get_serial_sequence('"AuditEvent"', 'id')) AS id, clock_timestamp() AS "recordedAt"`;
    if (!meta) throw new Error('Audit event allocation failed');
    const content = { ...meta, entityType: input.entityType, entityId: input.entityId, action: input.action,
      actorId: input.actorId ?? null, oldValue: input.oldValue ?? null, newValue: input.newValue ?? null,
      reason: input.reason ?? null, source: input.source ?? 'app', prevHash: last?.rowHash ?? null };
    await tx.auditEvent.create({ data: { ...content, oldValue: input.oldValue ?? Prisma.DbNull,
      newValue: input.newValue ?? Prisma.DbNull, rowHash: hashRow(content) } });
  }
  async verify() {
    let cursor: bigint | undefined;
    let previous: string | null = null;
    let checked = 0;
    // Anchor a finite snapshot so new appends cannot extend a running verification forever.
    const head = await this.prisma.auditEvent.findFirst({ orderBy: { id: 'desc' }, select: { id: true } });
    while (head) {
      const rows = await this.prisma.auditEvent.findMany({ where: { id: { ...(cursor ? { gt: cursor } : {}), lte: head.id } }, orderBy: { id: 'asc' }, take: 100 });
      if (!rows.length) break;
      const result = verifyRows(rows, previous);
      if (!result.valid) return { ...result, checked: checked + result.checked };
      checked += rows.length;
      previous = rows.at(-1)!.rowHash;
      cursor = rows.at(-1)!.id;
    }
    return { valid: true, checked };
  }
}
