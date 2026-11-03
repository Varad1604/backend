import { Controller, Get } from '@nestjs/common';
import { Requires } from '../identity-access/access.decorators';
import { AuditService } from './audit.service';
@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}
  @Get('verification') @Requires('audit.verify')
  async verify() { return { data: await this.audit.verify() }; }
}
