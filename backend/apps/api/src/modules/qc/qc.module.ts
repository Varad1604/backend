import { Module } from '@nestjs/common';
import { ReceivingModule } from '../receiving/receiving.module';
import { WritesModule } from '../platform/writes.module';
import { QcReadModule } from './qc-read.module';
import { QcController } from './qc.controller';
import { QcService } from './qc.service';
@Module({ imports: [ReceivingModule, WritesModule, QcReadModule], providers: [QcService], controllers: [QcController] })
export class QcModule {}
