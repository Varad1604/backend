import { QcReadModule } from '../qc/qc-read.module';
import { MovementReadModule } from '../movement-grn/movement-read.module';
import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity-access/identity.module';
import { WeighmentModule } from '../weighment/weighment.module';
import { WritesModule } from '../platform/writes.module';
import { ReceivingController, ReferenceDataController } from './receiving.controller';
import { ReceivingService } from './receiving.service';
import { ReceivingRepository } from './receiving.repository';
@Module({ imports: [IdentityModule, WeighmentModule, WritesModule, QcReadModule, MovementReadModule], controllers: [ReceivingController, ReferenceDataController], providers: [ReceivingService, ReceivingRepository], exports: [ReceivingService] })
export class ReceivingModule {}
