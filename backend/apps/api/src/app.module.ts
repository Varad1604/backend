import { QcModule } from './modules/qc/qc.module';
import { MovementModule } from './modules/movement-grn/movement.module';
import { ReceivingModule } from './modules/receiving/receiving.module';
import { IdentityModule } from './modules/identity-access/identity.module';
import { Module } from '@nestjs/common';
import { PrismaModule } from './infra/prisma/prisma.module';
import { RedisModule } from './infra/redis/redis.module';
import { HealthModule } from './modules/platform/health/health.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { ReportsModule } from './modules/reports/reports.module';

/**
 * Root module. Domain modules (receiving, weighment, qc, movement-grn, documents,
 * ho-review, reminders, reports) are registered in their build phases (P2-P6) and
 * must respect the module boundaries in build prompt section 4.3.
 */
@Module({
  imports: [PrismaModule, RedisModule, HealthModule, IdentityModule, ReceivingModule, QcModule, MovementModule, DocumentsModule, ReportsModule],
})
export class AppModule {}
