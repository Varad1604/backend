import { Controller, Get, Req } from '@nestjs/common';
import { Requires } from './access.decorators';
import { AuthService } from './auth.service';
import { RecordPolicyService } from './policy.service';
import type { AuthRequest } from './identity.types';
@Controller('identity/users')
export class UsersController {
  constructor(private readonly auth: AuthService, private readonly records: RecordPolicyService) {}
  @Get() @Requires('admin.users')
  async list(@Req() request: AuthRequest) {
    this.records.requireSelf(request.actor, request.actor.userId);
    return { data: await this.auth.listUsers() };
  }
}
