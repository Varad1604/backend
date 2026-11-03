import { Body, Controller, Get, Headers, Param, Patch, Post, Query, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Requires } from '../identity-access/access.decorators';
import type { AuthRequest } from '../identity-access/identity.types';
import { ReceivingService } from './receiving.service';
import { correctVisitSchema, createVisitSchema, idempotencyKeySchema, listVisitsSchema, recordWeightSchema, visitIdSchema } from './receiving.schemas';
import type { WriteResult } from '../platform/idempotent-write.service';

// The version always arrives in the If-Match header, never in the body (brief §3).
const ifMatch = (value: string | undefined) => z.coerce.number().int().min(1).parse(value);
function replyWrite(reply: FastifyReply, result: WriteResult) {
  reply.status(result.status); if (result.replayed) reply.header('Idempotent-Replay', 'true'); return result.body;
}
@Controller('receiving-visits')
export class ReceivingController {
  constructor(private readonly receiving: ReceivingService) {}
  @Post() @Requires('receiving.create')
  async create(@Body() body: unknown, @Req() request: AuthRequest & FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    return replyWrite(reply, await this.receiving.create(request.actor, idempotencyKeySchema.parse(request.headers['idempotency-key']), createVisitSchema.parse(body)));
  }
  // Brief §5.2: any of receiving.view / docs.prepare — every role holds receiving.view.
  @Get() @Requires('receiving.view')
  list(@Query() query: unknown, @Req() request: AuthRequest) { return this.receiving.list(request.actor, listVisitsSchema.parse(query)); }
  @Get(':id') @Requires('receiving.view')
  get(@Param('id') id: string, @Req() request: AuthRequest) { return this.receiving.get(request.actor, visitIdSchema.parse(id)); }
  @Patch(':id') @Requires('receiving.edit')
  async correct(@Param('id') id: string, @Body() body: unknown, @Headers('if-match') match: string | undefined, @Req() request: AuthRequest & FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    return replyWrite(reply, await this.receiving.correct(request.actor, visitIdSchema.parse(id), idempotencyKeySchema.parse(request.headers['idempotency-key']), ifMatch(match), correctVisitSchema.parse(body)));
  }
  @Get(':id/timeline') @Requires('receiving.view')
  timeline(@Param('id') id: string, @Req() request: AuthRequest) { return this.receiving.timeline(request.actor, visitIdSchema.parse(id)); }
  @Get(':id/weighments') @Requires('receiving.view')
  history(@Param('id') id: string, @Req() request: AuthRequest) { return this.receiving.history(request.actor, visitIdSchema.parse(id)); }
  // Brief §5.3: gate.followup · IK · IM.
  @Post(':id/weighments') @Requires('gate.followup')
  async weight(@Param('id') id: string, @Body() body: unknown, @Headers('if-match') match: string | undefined, @Req() request: AuthRequest & FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    return replyWrite(reply, await this.receiving.recordWeight(request.actor, visitIdSchema.parse(id), idempotencyKeySchema.parse(request.headers['idempotency-key']), ifMatch(match), recordWeightSchema.parse(body)));
  }
}

@Controller('reference-data')
export class ReferenceDataController {
  constructor(private readonly receiving: ReceivingService) {}
  @Get('receiving') @Requires('auth.self') get(@Req() request: AuthRequest) { return this.receiving.referenceData(request.actor); }
}
