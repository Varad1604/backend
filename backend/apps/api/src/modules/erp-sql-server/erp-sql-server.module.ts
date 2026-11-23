import { Module } from '@nestjs/common';
import { ErpSqlServerService } from './erp-sql-server.service';
import { ErpSqlServerController } from './erp-sql-server.controller';
import { ErpWorkflowReadController } from './erp-workflow-read.controller';
import { ErpGateEvidenceVerifier } from './erp-gate-evidence-verifier';
import { ConfigModule } from '@nestjs/config';
import { WritesModule } from '../platform/writes.module';

// The ERP SQL Server adapter module is intentionally minimal:
// - Provides the ErpSqlServerService (connection pool, query execution, health check)
// - Provides the ErpSqlServerController (read-only API endpoints)
// - Uses existing NestJS conventions (dependency injection, guards, capabilities)
// - Does NOT introduce new infrastructure, databases, message brokers, or workers
// - Keeps SQL Server completely separate from Prisma/PostgreSQL internal data
// - Read-only by design: no write operations; ERP failures isolated via 503; do not cascade
// - Configuration via env vars (ERP_DATABASE_URL, ERP_HOST, ERP_PORT, ERP_DB, ERP_USER, ERP_PASSWORD)
// - TLS defaults: encrypt: true, trustServerCertificate: false (production DBA must confirm cert trust)
// - Pool bounded: max 20, idleTimeout 10s, connectTimeout 15s, commandTimeout 30s
// - Parameterized queries exclusively; no string interpolation; prevent SQL injection
// - On module init: health-check SELECT 1; on failure, pool = null; requests return 503
// - On module destroy: gentle pool close
//
// Dependencies: mssql@12.7.14 (added to @kpmpl/api package), @nestjs/common, @nestjs/config
// No circular dependencies: does not import from receiving, weighment, movement-grn, etc.
// Other modules may import ErpSqlServerService if they need ERP read access (with @Requires capability).
@Module({
  // ConfigService (ERP_* env), IdempotentWriteService (platform WritesModule).
  // PrismaModule and AuditModule are @Global, so they resolve without importing.
  imports: [ConfigModule, WritesModule],
  providers: [ErpSqlServerService, ErpGateEvidenceVerifier],
  controllers: [ErpSqlServerController, ErpWorkflowReadController],
  exports: [ErpSqlServerService, ErpGateEvidenceVerifier], // Export service so other modules can inject it
})
export class ErpSqlServerModule {}