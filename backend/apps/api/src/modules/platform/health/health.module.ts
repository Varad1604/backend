import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { DocumentsModule } from '../../documents/documents.module';

@Module({
  imports: [DocumentsModule], controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
