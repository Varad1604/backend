import { HttpException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { canonical } from '../audit/audit-chain';
import { AuthService } from '../identity-access/auth.service';
import type { Actor } from '../identity-access/identity.types';
import type { Capability } from '../identity-access/policy';
export interface WriteResult { status: number; body: Prisma.InputJsonValue; replayed: boolean }
export const conflict = (code: string, message: string, meta?: object) => new HttpException({ code, message, ...(meta ? { meta } : {}) }, 409);
@Injectable()
export class IdempotentWriteService {
  constructor(private readonly prisma: PrismaService, private readonly auth: AuthService) {}
  async run(actor: Actor, capability: Capability, path: string, key: string, input: unknown,
    work: (tx: Prisma.TransactionClient, actor: Actor) => Promise<{ status: number; body: Prisma.InputJsonValue }>, method = 'POST'): Promise<WriteResult> {
    const requestHash = createHash('sha256').update(canonical(input)).digest('hex');
    return this.prisma.$transaction(async tx => {
      const currentActor = await this.auth.authorize(actor, capability, tx);
      const scope = currentActor.userId + ':' + method + ':' + path + ':' + key;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(6200010, hashtext(${scope}))`;
      const identity = { userId: currentActor.userId, method, path, key };
      const previous = await tx.idempotencyRecord.findUnique({ where: { userId_method_path_key: identity } });
      if (previous && previous.expiresAt > new Date()) {
        if (previous.requestHash !== requestHash) throw new HttpException({ code: 'VALIDATION_FAILED', message: 'Idempotency key reused with different data' }, 422);
        if (previous.status !== 'completed' || previous.responseStatus === null || previous.responseBody === null) throw conflict('IDEMPOTENCY_IN_PROGRESS', 'The original request is not complete.');
        return { status: previous.responseStatus, body: previous.responseBody, replayed: true };
      }
      if (previous) await tx.idempotencyRecord.delete({ where: { id: previous.id } });
      const result = await work(tx, currentActor);
      await tx.idempotencyRecord.create({ data: { ...identity, requestHash, responseStatus: result.status, responseBody: result.body,
        status: 'completed', expiresAt: new Date(Date.now() + 86_400_000) } });
      return { ...result, replayed: false };
    }, { timeout: 10_000 });
  }
}
