import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { AuditModule } from '../audit/audit.module';
import { AuditController } from '../audit/audit.controller';
import { FeaturesController } from '../platform/features.controller';
import { PoliciesController } from '../platform/policies.controller';
import { DocsController } from '../platform/docs.controller';
import { HttpErrorFilter } from '../common/http-error.filter';
import { AuthController } from './auth.controller';
import { UsersController } from './users.controller';
import { AdminUsersController } from './admin-users.controller';
import { AuthService } from './auth.service';
import { AuthGuard } from './auth.guard';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';
import { RecordPolicyService } from './policy.service';
import { RateLimitService } from './rate-limit.service';
@Module({
  imports: [AuditModule],
  controllers: [AuthController, UsersController, AdminUsersController, AuditController, FeaturesController, PoliciesController, DocsController],
  providers: [AuthService, PasswordService, TokenService, RecordPolicyService, RateLimitService,
    { provide: APP_GUARD, useClass: AuthGuard }, { provide: APP_FILTER, useClass: HttpErrorFilter }],
  exports: [AuthService, RecordPolicyService],
})
export class IdentityModule {}
