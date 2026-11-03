import { Controller, Get, Query, Req, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { Requires } from '../identity-access/access.decorators';
import type { AuthRequest } from '../identity-access/identity.types';
import { ReportsService } from './reports.service';
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional();
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}
  @Get('overview') @Requires('overview.view') overview(@Req() req: AuthRequest) { return this.reports.overview(req.actor); }
  @Get('receiving.csv') @Requires('overview.view') async csv(@Query('from') from: string | undefined, @Query('to') to: string | undefined, @Req() req: AuthRequest, @Res() reply: FastifyReply) { const body = await this.reports.csv(req.actor, date.parse(from), date.parse(to)); return reply.type('text/csv; charset=utf-8').header('Content-Disposition', 'attachment; filename="receiving.csv"').send(body); }
}
