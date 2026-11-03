import { Body, Controller, Get, Headers, Param, Post, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Requires } from '../identity-access/access.decorators';
import type { AuthRequest } from '../identity-access/identity.types';
import { idempotencyKeySchema, visitIdSchema } from '../receiving/receiving.schemas';
import { MovementService, exitSchema, grnSchema } from './movement.service';
import type { WriteResult } from '../platform/idempotent-write.service';

// The version arrives in the If-Match header (brief §3).
const ifMatch = (value: string | undefined) => z.coerce.number().int().min(1).parse(value);
@Controller('receiving-visits/:id')
export class MovementController {
  constructor(private readonly movement: MovementService) {}
  private response(reply: FastifyReply, result: WriteResult) { reply.status(result.status); if (result.replayed) reply.header('Idempotent-Replay', 'true'); return result.body; }
  // Brief §5.3: gate.followup · IK · IM for all three writes.
  @Post('exit') @Requires('gate.followup')
  async exit(@Param('id') id: string, @Body() body: unknown, @Headers('if-match') match: string | undefined, @Req() request: AuthRequest & FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    return this.response(reply, await this.movement.exit(request.actor, visitIdSchema.parse(id), idempotencyKeySchema.parse(request.headers['idempotency-key']), ifMatch(match), exitSchema.parse(body)));
  }
  @Post('grn-links') @Requires('gate.followup')
  async grn(@Param('id') id: string, @Body() body: unknown, @Headers('if-match') match: string | undefined, @Req() request: AuthRequest & FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    return this.response(reply, await this.movement.recordGrn(request.actor, visitIdSchema.parse(id), idempotencyKeySchema.parse(request.headers['idempotency-key']), ifMatch(match), grnSchema.parse(body)));
  }
  @Get('grn-links') @Requires('receiving.view')
  references(@Param('id') id: string, @Req() request: AuthRequest) { return this.movement.references(request.actor, visitIdSchema.parse(id)); }
}
