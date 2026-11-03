import { Body, Controller, Get, Headers, Param, Post, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Requires, RequiresAny } from '../identity-access/access.decorators';
import type { AuthRequest } from '../identity-access/identity.types';
import { idempotencyKeySchema } from '../receiving/receiving.schemas';
import type { WriteResult } from '../platform/idempotent-write.service';
import { accountingActionSchema, ifMatchSchema, packageIdSchema } from './document.schemas';
import { DocumentsService } from './documents.service';

function version(value: string | undefined) { return ifMatchSchema.parse(value); }
function key(request: FastifyRequest) { return idempotencyKeySchema.parse(request.headers['idempotency-key']); }
function response(reply: FastifyReply, result: WriteResult) { reply.status(result.status); if (result.replayed) reply.header('Idempotent-Replay', 'true'); return result.body; }

/** Accounting workflow routes (upgrade 2026-11-03): HO → Accountant → Head Accountant → Bill Posted. */
@Controller()
export class AccountingController {
  constructor(private readonly documents: DocumentsService) {}
  @Get('accounting/queue') @Requires('accounting.inbox') queue(@Req() req: AuthRequest) { return this.documents.accountingList(req.actor); }
  @Post('document-packages/:id/accounting') @RequiresAny('accounting.review', 'accounting.approve', 'accounting.post')
  async action(@Param('id') id: string, @Body() body: unknown, @Headers('if-match') match: string | undefined, @Req() req: AuthRequest & FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    return response(reply, await this.documents.accounting(req.actor, packageIdSchema.parse(id), key(req), version(match), accountingActionSchema.parse(body)));
  }
}
