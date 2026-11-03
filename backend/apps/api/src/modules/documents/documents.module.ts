import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { IdentityModule } from '../identity-access/identity.module';
import { WritesModule } from '../platform/writes.module';
import { ReceivingModule } from '../receiving/receiving.module';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { FileStorageService } from './file-storage.service';
import { MalwareScannerService } from './malware-scanner.service';
// ReceivingModule provides the resolved visit snapshots embedded in DocumentPackageView.
@Module({ imports: [IdentityModule, WritesModule, AuditModule, ReceivingModule], controllers: [DocumentsController], providers: [DocumentsService, FileStorageService, MalwareScannerService], exports: [FileStorageService] })
export class DocumentsModule {}
