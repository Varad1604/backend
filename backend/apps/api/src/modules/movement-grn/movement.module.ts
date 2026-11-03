import { Module } from '@nestjs/common';
import { ReceivingModule } from '../receiving/receiving.module';
import { WritesModule } from '../platform/writes.module';
import { MovementReadModule } from './movement-read.module';
import { MovementController } from './movement.controller';
import { MovementService } from './movement.service';
@Module({ imports: [ReceivingModule, WritesModule, MovementReadModule], controllers: [MovementController], providers: [MovementService] })
export class MovementModule {}
