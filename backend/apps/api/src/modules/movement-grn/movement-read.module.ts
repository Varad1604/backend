import { Module } from '@nestjs/common';
import { MovementReadService } from './movement-read.service';
@Module({ providers: [MovementReadService], exports: [MovementReadService] })
export class MovementReadModule {}
