import { Module } from '@nestjs/common';
import { WeighmentService } from './weighment.service';
@Module({ providers: [WeighmentService], exports: [WeighmentService] })
export class WeighmentModule {}
