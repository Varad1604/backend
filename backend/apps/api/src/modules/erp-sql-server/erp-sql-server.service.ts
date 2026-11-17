import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import * as mssql from 'mssql';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../audit/audit.service';
import { IdempotentWriteService } from '../platform/idempotent-write.service';
import { mssqlTypes, typeOf } from './mssql-types';

/**
 * Parameter descriptor for ERP SQL queries.
 * Each parameter has an explicit name, SQL type, and value.
 * Used by executeQuery, executeQuerySingle, and executeScalar.
 */
export type ErpQueryParam = {
  name: string;
  type: string; // SQL type name, e.g. 'Int', 'VarChar', 'NVarChar'
  value: unknown;
};

/**
 * Secure SQL Server read adapter for DataMan ERP integration.
 */

@Injectable()
export class ErpSqlServerService implements OnModuleInit, OnModuleDestroy {
  /**
   * The single host permitted for the temporary local untrusted-certificate test.
   * Any other host keeps full certificate validation, whatever the opt-in says.
   */
  private static readonly LOCAL_TEST_ERP_HOST = '192.168.1.200';

  private pool: any = null;
  private readonly logger: Logger;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly idempotency: IdempotentWriteService,
  ) {
    this.logger = new Logger('ErpSqlServerService');
    this.validateConfiguration();
  }

  /**
   * Validate that required ERP environment variables are present.
   */
  /**
   * Phase 06 (D-04): every ERP_* value arrives from the environment as a string, and mssql
   * rejects a string port outright ("config.options.port property must be of type number"),
   * which meant the pool could never be built even with correct credentials. Coerce and fall
   * back instead of trusting the env type.
   */
  private numberSetting(key: string, fallback: number): number {
    const raw = this.configService.get<string | number>(key);
    const value = typeof raw === 'number' ? raw : Number(raw);
    return Number.isFinite(value) && value >= 0 ? value : fallback;
  }

  /**
   * Phase 06C: strictly local-development certificate exception, off by default and refused
   * outside the one permitted combination.
   *
   * `trustServerCertificate: true` disables SQL Server identity verification, so it is enabled
   * ONLY when all three conditions hold:
   *   1. NODE_ENV is exactly 'development',
   *   2. ERP_HOST is exactly the addressed local test server (192.168.1.200),
   *   3. ERP_LOCAL_TEST_ALLOW_UNTRUSTED_CERT is exactly 'true'.
   *
   * Everything else — a production/staging NODE_ENV, any other host, an absent or non-'true'
   * opt-in — keeps the driver default (`trustServerCertificate: false`). A requested exception
   * that fails a condition is refused loudly and never enabled silently. `encrypt` is always
   * true; this switch only governs certificate *validation*, never transport encryption.
   * The exception is for an authorized, temporary read-only test and must never become the
   * production default.
   */
  private allowUntrustedCertificateForLocalTest(): boolean {
    const optIn = this.configService.get<string>('ERP_LOCAL_TEST_ALLOW_UNTRUSTED_CERT');
    if (optIn !== 'true') {
      if (optIn !== undefined && optIn !== null && optIn !== '') {
        this.logger.warn(`ErpSqlServerService: ERP_LOCAL_TEST_ALLOW_UNTRUSTED_CERT="${optIn}" is not exactly "true" — ignored; certificate validation stays enforced.`);
      }
      return false;
    }

    const nodeEnv = this.configService.get<string>('NODE_ENV');
    const host = this.configService.get<string>('ERP_HOST');

    if (nodeEnv !== 'development' || host !== ErpSqlServerService.LOCAL_TEST_ERP_HOST) {
      this.logger.error(
        `ErpSqlServerService: Refusing ERP_LOCAL_TEST_ALLOW_UNTRUSTED_CERT=true — permitted only for NODE_ENV=development and ERP_HOST=${ErpSqlServerService.LOCAL_TEST_ERP_HOST} ` +
        `(got NODE_ENV=${nodeEnv ?? 'unset'}, ERP_HOST=${host ?? 'unset'}). Certificate validation stays enforced; no connection will be attempted with a weakened TLS setting.`,
      );
      return false;
    }

    this.logger.warn(
      `ErpSqlServerService: TEMPORARY LOCAL TEST — certificate validation disabled for ${host} (NODE_ENV=development, explicit opt-in). Read-only test only; never enable this in production.`,
    );
    return true;
  }

  /**
   * Phase 06 (D-03): the pool needs four discrete settings. `ERP_DATABASE_URL` is accepted
   * by the env schema but the adapter builds its options from HOST/PORT/DB/USER/PASSWORD,
   * so a deployment that sets only the URL would connect with defaults and fail obscurely.
   */
  private validateConfiguration(): boolean {
    const requiredVars = ['ERP_HOST', 'ERP_DB', 'ERP_USER', 'ERP_PASSWORD'];
    const missing = requiredVars.filter(varName => !this.configService.get<string>(varName));
    if (missing.length > 0) {
      this.logger.error(`ErpSqlServerService: Missing required ERP environment variables: ${missing.join(', ')}`);
      return false;
    }
    return true;
  }

  /** Initialize the mssql connection pool on module init. */
  async onModuleInit(): Promise<void> {
    // Never open a connection (or attempt a login) with an incomplete configuration: on the
    // mill LAN that would fire a real, unauthenticated login at the DataMan server on every
    // restart and could trip the read-only account's lockout policy.
    if (!this.validateConfiguration()) {
      this.logger.warn('ErpSqlServerService: ERP configuration incomplete — no connection attempt made; /erp/* will return 503 ERP_UNAVAILABLE.');
      this.pool = null;
      return;
    }

    // Phase 06B: the installed driver (mssql@12.7.14) reads these keys from the TOP LEVEL of
    // its config object — `lib/base/connection-pool.js` sizes the pool from `config.pool`, and
    // `lib/tedious/connection-pool.js` maps `config.connectionTimeout` / `config.requestTimeout`
    // onto the tedious connection options. Nested under `options` they were ignored silently:
    // the pool ran on the driver default (max 10, idle 30s) and the configured timeouts never
    // reached a request. Only TLS/TDS settings belong inside `options`.
    const poolConfig: mssql.config = {
      server: this.configService.get<string>('ERP_HOST') || 'KPMLSERVER',
      port: this.numberSetting('ERP_PORT', 1433),
      database: this.configService.get<string>('ERP_DB') || 'KAYGAONNew24',
      user: this.configService.get<string>('ERP_USER') || 'pravahax_readonly',
      password: this.configService.get<string>('ERP_PASSWORD') || '',
      connectionTimeout: this.numberSetting('ERP_CONNECT_TIMEOUT', 15000),
      requestTimeout: this.numberSetting('ERP_COMMAND_TIMEOUT', 30000),
      pool: {
        max: this.numberSetting('ERP_POOL_MAX', 20),
        min: this.numberSetting('ERP_POOL_MIN', 0),
        idleTimeoutMillis: this.numberSetting('ERP_POOL_IDLE_TIMEOUT', 10000),
      },
      options: {
        encrypt: true, // SSL encryption — always on; no environment switch can disable it
        // false everywhere except the guarded local-development test combination.
        trustServerCertificate: this.allowUntrustedCertificateForLocalTest(),
        // SQL Server 2016 negotiates TDS 7.4; '7_0' predates SQL Server 2012 and is not a
        // supported target here. '7_4' is also the driver's own default.
        tdsVersion: '7_4',
      },
    };

    this.logger.log('ErpSqlServerService: Initializing mssql connection pool...');
    try {
      // @ts-ignore — mssql types via @types/mssql
      this.pool = new mssql.ConnectionPool(poolConfig);

      await this.pool.connect();
      await this.pool.request().query('SELECT 1 AS health');
      this.logger.log('ErpSqlServerService: Connection pool initialized and health check passed.');

      this.logger.log(`ErpSqlServerService: Pool configured — max: ${this.pool.config.pool?.max}, idleTimeoutMillis: ${this.pool.config.pool?.idleTimeoutMillis}, connectionTimeout: ${this.pool.config.connectionTimeout}, requestTimeout: ${this.pool.config.requestTimeout}, encrypt: ${this.pool.config.options?.encrypt}, trustServerCertificate: ${this.pool.config.options?.trustServerCertificate}, tdsVersion: ${this.pool.config.options?.tdsVersion}`);
    } catch (error) {
      this.logger.error(`ErpSqlServerService: Failed to initialize connection pool: ${error instanceof Error ? error.message : String(error)}`);
      this.logger.error('ErpSqlServerService: ERP connection pool will be unavailable; individual requests will return 503 ERP_UNAVAILABLE.');
      this.logger.error('ErpSqlServerService: Production deployment requires ERP DBA confirmation on TLS certificate trust.');
      this.pool = null;
    }
  }

  /** Close the connection pool on module destroy. */
  onModuleDestroy(): Promise<void> {
    this.logger.log('ErpSqlServerService: Shutting down connection pool...');
    if (this.pool) {
      return this.pool.close().then(() => {
        this.logger.log('ErpSqlServerService: Connection pool closed successfully.');
      });
    }
    return Promise.resolve();
  }

  /** Get the underlying mssql connection pool, if initialized. */
  getPool(): any {
    return this.pool;
  }

  /**
   * Resolve a SQL type name such as 'Int', 'VarChar', or 'NVarChar' to the actual
   * mssql@12 type descriptor required by request.input().
   *
   * The old code passed the string directly ("type: 'Int'") and mssql tried to resolve
   * undefined as a type constructor, producing:
   *   Validation failed for parameter 'skip'. Cannot read properties of undefined (reading 'resolve')
   * The resolved descriptor is cached in a module-level Map per unique type name, so the
   * real driver resolution happens once per supported name instead of once per parameter.
   */
  private resolveSqlType(paramName: string, typeName: string): () => mssql.ISqlType {
    const key = typeName;
    if (!mssqlTypes.hasOwnProperty(key)) {
      throw new Error(`unsupported SQL type "${typeName}" for parameter "${paramName}"`);
    }
    const descriptor = mssqlTypes[key];
    if (typeof descriptor !== 'function') {
      throw new Error(`undefined SQL type descriptor for parameter "${paramName}"`);
    }
    return descriptor as () => mssql.ISqlType;
  }

  /**
   * Execute a parameterized SELECT query against the ERP SQL Server.
   *
   * Design goals:
   * - Guarantees: no SQL injection (all values bound as parameters via request.input())
   * - Guarantees: connection from bounded pool, released back in finally (mssql manages this)
   * - Guarantees: timeout enforcement via mssql pool config
   * - Guarantees: error classification (connection vs query vs auth vs TLS)
   * - Guarantees: returns FULL recordset array (NOT just the first row — fixes Defect 04)
   * - Parameter contract: explicit ErpQueryParam array — each param has valid name, type, value (fixes Defect 03)
   *
   * @param query mssql-compatible query string with @parameter placeholders
   * @param params Array of ErpQueryParam objects — may be empty (no filter parameters)
   * @returns Parsed JSON result rows array (full recordset), or empty array if no rows
   */
  async executeQuery<T>(query: string, params: ErpQueryParam[] = []): Promise<T[]> {
    if (!this.pool) {
      const errorMsg = 'ErpSqlServerService: Connection pool not initialized — ERP data source unavailable.';
      this.logger.error(errorMsg);
      throw new Error(errorMsg);
    }

    try {
      const request = this.pool.request();

      // Apply each parameter via request.input(name, type, value)
      // Type names are resolved to real driver descriptors here, before any query is sent.
      for (const param of params) {
        if (param.name !== undefined && param.name !== null) {
          const descriptor = this.resolveSqlType(param.name, param.type);
          request.input(param.name, descriptor, param.value);
        }
      }

      this.logger.debug(`ErpSqlServerService: Executing ERP query (length=${query.length}); ${params.length} params applied.`);

      const result = await request.query(query);

      // mssql returns { recordset: [...] } for SELECT queries
      // CRITICAL FIX: Return the FULL recordset array, not just recordset[0] (fixes Defect 04)
      if (result && result.recordset) {
        return result.recordset as unknown as T[];
      }

      return [] as T[];
    } catch (error) {
      this.classifyAndLogError(error);
      throw error;
    }
  }

  /**
   * Execute a parameterized SELECT query that returns at most one row.
   * Convenience method for existence checks and detail-by-key queries.
   * Returns [row] if found, [] if not found — NEVER returns [firstOfMany].
   * Fixes Defect 04 by separating multi-row and single-row query operations.
   */
  async executeQuerySingle<T>(query: string, params: ErpQueryParam[] = []): Promise<T[]> {
    if (!this.pool) {
      const errorMsg = 'ErpSqlServerService: Connection pool not initialized — ERP data source unavailable.';
      this.logger.error(errorMsg);
      throw new Error(errorMsg);
    }

    try {
      const request = this.pool.request();

      // Apply each parameter via request.input()
      // Type names are resolved to real driver descriptors here, before any query is sent.
      for (const param of params) {
        if (param.name !== undefined && param.name !== null) {
          const descriptor = this.resolveSqlType(param.name, param.type);
          request.input(param.name, descriptor, param.value);
        }
      }

      this.logger.debug(`ErpSqlServerService: Executing single-row ERP query (length=${query.length}); ${params.length} params applied.`);

      const result = await request.query(query);

      if (result && result.recordset && result.recordset.length > 0) {
        return result.recordset.slice(0, 1) as unknown as T[]; // Return at most one row as array
      }

      return [] as T[];
    } catch (error) {
      this.classifyAndLogError(error);
      throw error;
    }
  }

  /**
   * Execute a parameterized query that returns a single scalar value.
   * Convenience method for existence checks and simple validation queries.
   */
  async executeScalar(query: string, params: ErpQueryParam[] = []): Promise<number> {
    if (!this.pool) {
      throw new Error('ErpSqlServerService: Connection pool not initialized.');
    }

    try {
      const request = this.pool.request();

      // Apply each parameter via request.input()
      // Type names are resolved to real driver descriptors here, before any query is sent.
      for (const param of params) {
        if (param.name !== undefined && param.name !== null) {
          const descriptor = this.resolveSqlType(param.name, param.type);
          request.input(param.name, descriptor, param.value);
        }
      }

      const result = await request.query(query);
      const firstRow = result.recordset[0];
      if (!firstRow) { return 0; }
      const keys = Object.keys(firstRow);
      const key = keys?.[0];
      if (!key) { return 0; }
      const scalar = firstRow[key];
      return Number(scalar);
    } catch (error) {
      this.classifyAndLogError(error);
      throw error;
    }
  }

  /** Test ERP connectivity with a minimal SELECT 1 query. */
  async testConnectivity(): Promise<boolean> {
    if (!this.pool) {
      this.logger.warn('ErpSqlServerService: Cannot test connectivity — pool not initialized.');
      return false;
    }

    try {
      const result = await this.pool.request().query('SELECT 1 AS test');
      return result.recordset[0].test === 1;
    } catch (error) {
      this.logger.warn(`ErpSqlServerService: ERP connectivity test failed: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  /** Classify and log ERP errors with appropriate detail, masking internal ERP schema. */
  private classifyAndLogError(error: unknown): void {
    const msg = error instanceof Error ? error.message : String(error);

    if (msg.includes('connection') || msg.includes('Connection') || msg.includes('ECONN') || msg.includes('ETIMEDOUT')) {
      this.logger.warn(`ErpSqlServerService: Connection-level ERP error: ${msg}`);
    } else if (msg.includes('auth') || msg.includes('Auth') || msg.includes('login') || msg.includes('LOGIN') || msg.includes('credentials') || msg.includes('CREDENTIALS')) {
      this.logger.error(`ErpSqlServerService: Authentication error — possible invalid credentials or permission scope: ${msg}`);
    } else if (msg.includes('certificate') || msg.includes('Certificate') || msg.includes('trustServerCertificate') || msg.includes('TRUST')) {
      this.logger.error(`ErpSqlServerService: TLS/SSL certificate error — production certificate trust unresolved: ${msg}`);
    } else if (msg.includes('timeout') || msg.includes('Timeout') || msg.includes('TIMEOUT')) {
      this.logger.warn(`ErpSqlServerService: Query timeout ERP error: ${msg}`);
    } else if (msg.includes('invalid') || msg.includes('Invalid')) {
      this.logger.warn(`ErpSqlServerService: Invalid request/error: ${msg}`);
    } else {
      this.logger.error(`ErpSqlServerService: ERP query error: ${msg}`);
    }
  }
}
