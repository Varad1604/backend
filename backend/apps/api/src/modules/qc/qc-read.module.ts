import { Module } from '@nestjs/common';
import { QcReadService } from './qc-read.service';
@Module({ providers: [QcReadService], exports: [QcReadService] })
export class QcReadModule {}
