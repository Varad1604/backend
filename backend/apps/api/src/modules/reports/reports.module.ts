import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity-access/identity.module';
import { ReceivingModule } from '../receiving/receiving.module';
import { QcReadModule } from '../qc/qc-read.module';
import { MovementReadModule } from '../movement-grn/movement-read.module';
import { WeighmentModule } from '../weighment/weighment.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
@Module({ imports: [IdentityModule, ReceivingModule, QcReadModule, MovementReadModule, WeighmentModule], controllers: [ReportsController], providers: [ReportsService] })
export class ReportsModule {}
