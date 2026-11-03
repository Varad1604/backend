import { Injectable, NotFoundException } from '@nestjs/common';
import type { Actor } from './identity.types';
@Injectable()
export class RecordPolicyService {
  requireSelf(actor: Actor, userId: string): void {
    if (actor.userId !== userId) throw new NotFoundException();
  }
  requireVisibility(actor: Actor, permittedUserIds: readonly string[]): void {
    if (!permittedUserIds.includes(actor.userId)) throw new NotFoundException();
  }
}
