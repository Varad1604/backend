import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity-access/identity.module';
import { IdempotentWriteService } from './idempotent-write.service';
@Module({ imports: [IdentityModule], providers: [IdempotentWriteService], exports: [IdempotentWriteService] })
export class WritesModule {}
