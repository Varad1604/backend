import { Body, Controller, Get, Headers, Param, Post, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Requires } from '../identity-access/access.decorators';
import type { AuthRequest } from '../identity-access/identity.types';
import { idempotencyKeySchema, visitIdSchema } from '../receiving/receiving.schemas';
import { ReceivingService } from '../receiving/receiving.service';
import { QcService, qcDecisionSchema, qcSubmissionSchema } from './qc.service';
import type { WriteResult } from '../platform/idempotent-write.service';

// QC writes take the VISIT version from If-Match (brief §3).
const ifMatch = (value: string | undefined) => z.coerce.number().int().min(1).parse(value);
function replyWrite(reply: FastifyReply, result: WriteResult) {
  reply.status(result.status); if (result.replayed) reply.header('Idempotent-Replay', 'true'); return result.body;
}
@Controller()
export class QcController {
  constructor(private readonly qc: QcService, private readonly receiving: ReceivingService) {}
  // Brief §5.4: QcQueueItem[] for pending/in_progress/returned/submitted, oldest first.
  // `submitted` rows are the ones waiting for the QC operator's final decision (D-03).
  @Get('qc/queue') @Requires('qc.queue.view')
  queue(@Req() request: AuthRequest) { return this.receiving.queue(request.actor); }
  // Any of qc.queue.view / receiving.view / ho.inbox — every role holds receiving.view.
  @Get('receiving-visits/:id/qc-inspections') @Requires('receiving.view')
  history(@Param('id') id: string, @Req() request: AuthRequest) { return this.qc.history(request.actor, visitIdSchema.parse(id)); }
  @Post('receiving-visits/:id/qc-inspections') @Requires('qc.measure')
  async submit(@Param('id') id: string, @Body() body: unknown, @Headers('if-match') match: string | undefined, @Req() request: AuthRequest & FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    return replyWrite(reply, await this.qc.submit(request.actor, visitIdSchema.parse(id), idempotencyKeySchema.parse(request.headers['idempotency-key']), ifMatch(match), qcSubmissionSchema.parse(body)));
  }
  // POST /qc-inspections/{inspectionId}/decisions — qc.decide · IK · IM(visit) (brief §5.4).
  // D-03 (2026-11-03): the QC operator who submitted the readings records the final decision.
  @Post('qc-inspections/:inspectionId/decisions') @Requires('qc.decide')
  async decide(@Param('inspectionId') inspectionId: string, @Body() body: unknown, @Headers('if-match') match: string | undefined, @Req() request: AuthRequest & FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    return replyWrite(reply, await this.qc.decide(request.actor, z.uuid().parse(inspectionId), idempotencyKeySchema.parse(request.headers['idempotency-key']), ifMatch(match), qcDecisionSchema.parse(body)));
  }
}
