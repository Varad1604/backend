import { describe, it, expect, beforeEach, vi } from 'vitest';

// Phase 06 (D-03): `mssql` was referenced without being imported, so pool init always died
// with "mssql is not defined". Mocking the driver lets us assert the pool is actually built
// (and never *attempted* when configuration is incomplete) instead of relying on timing.
const { poolCtor } = vi.hoisted(() => ({ poolCtor: vi.fn() }));
vi.mock('mssql', async (importOriginal) => {
  const actual = await importOriginal<typeof import('mssql')>();
  const original = (actual as unknown as {
    default?: typeof import('mssql')
  }).default ?? actual;

  return {
    ...actual,
    ...original,
    ConnectionPool: poolCtor,
    default: {
      ...original,
      ConnectionPool: poolCtor,
    },
  };
});
import { Test, TestingModule } from '@nestjs/testing';
import { ErpSqlServerService } from '../erp-sql-server.service';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { IdempotentWriteService } from '../../platform/idempotent-write.service';

describe('ErpSqlServerService (unit tests, mocked mssql)', () => {
  let service: ErpSqlServerService;

  /** Default environment: complete except ERP_PASSWORD, so no pool is built unless a test says so. */
  const baseEnv: Record<string, unknown> = {
    NODE_ENV: 'test',
    ERP_DATABASE_URL: undefined,
    ERP_HOST: 'KPMLSERVER',
    ERP_LOCAL_TEST_ALLOW_UNTRUSTED_CERT: undefined,
    ERP_PORT: 1433,
    ERP_DB: 'KAYGAONNew24',
    ERP_USER: 'pravahax_readonly',
    ERP_PASSWORD: undefined,
    ERP_TLS_ENFORCE: 'true',
    ERP_POOL_MAX: 20,
    ERP_POOL_MIN: 0,
    ERP_POOL_IDLE_TIMEOUT: 10000,
    ERP_COMMAND_TIMEOUT: 30000,
    ERP_CONNECT_TIMEOUT: 15000,
  };

  const mockConfigService = {
    get: vi.fn((key: string, defaultValue?: unknown) => baseEnv[key] ?? defaultValue),
  };

  const mockPrisma = {};
  const mockAudit = {
    append: vi.fn().mockResolvedValue(undefined),
  };
  const mockIdempotency = {
    run: vi.fn().mockResolvedValue({ status: 201, body: { data: {} }, replayed: false }),
  };

  // D-04: ConfigService hands every ERP_* value back exactly as the environment holds it —
  // a string — so numeric settings are strings here or the test proves nothing.
  const stringEnv: Record<string, unknown> = {
    ERP_HOST: 'erp.test', ERP_PORT: '1433', ERP_DB: 'KAYGAONNew24', ERP_USER: 'pravahax_readonly', ERP_PASSWORD: 'not-a-real-secret',
    ERP_POOL_MAX: '20', ERP_POOL_MIN: '0', ERP_POOL_IDLE_TIMEOUT: '10000', ERP_COMMAND_TIMEOUT: '30000', ERP_CONNECT_TIMEOUT: '15000',
  };

  /** Build a complete-config service, capture the config object handed to mssql's ConnectionPool. */
  const connectWithEnv = async (env: Record<string, unknown>): Promise<Record<string, any>> => {
    mockConfigService.get.mockImplementation((key: string, defaultValue?: unknown) => env[key] ?? defaultValue);
    poolCtor.mockClear();
    // A plain `function` so `new mssql.ConnectionPool(...)` can construct it.
    poolCtor.mockImplementation(function (config: unknown) {
      return {
        connect: vi.fn().mockResolvedValue(undefined),
        request: () => ({ query: vi.fn().mockResolvedValue({ recordset: [{ health: 1 }] }) }),
        close: vi.fn().mockResolvedValue(undefined),
        config,
      } as unknown;
    });

    await service.onModuleInit();

    expect(poolCtor).toHaveBeenCalledTimes(1);
    return poolCtor.mock.calls[0]![0] as Record<string, any>;
  };

  const connectWithCompleteEnv = (overrides: Record<string, unknown> = {}): Promise<Record<string, any>> =>
    connectWithEnv({ ...stringEnv, ...overrides });

  beforeEach(async () => {
    vi.clearAllMocks();
    // Config overrides set by one test must never leak into the next one.
    mockConfigService.get.mockReset();
    mockConfigService.get.mockImplementation((key: string, defaultValue?: unknown) => baseEnv[key] ?? defaultValue);
    poolCtor.mockReset();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ErpSqlServerService,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService, useValue: mockAudit },
        { provide: IdempotentWriteService, useValue: mockIdempotency },
      ],
    }).compile();

    service = module.get<ErpSqlServerService>(ErpSqlServerService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('configuration validation', () => {
    it('should initialize service with default config values', () => {
      // Service should not throw on init even if ERP_DATABASE_URL is missing
      // (missing config → runtime 503, not startup fail)
      expect(service).toBeDefined();
    });
  });

  describe('pool initialisation (D-03)', () => {
    it('does not construct a pool, and does not attempt a login, when ERP config is incomplete', async () => {
      await expect(service.onModuleInit()).resolves.toBeUndefined();
      expect(poolCtor).not.toHaveBeenCalled();
      expect(service.getPool()).toBeNull();
    });

    it('builds a TLS-verifying pool when the ERP config is complete', async () => {
      const config = await connectWithCompleteEnv();

      // Certificate verification must never be weakened to make a connection work.
      expect(config.options.encrypt).toBe(true);
      expect(config.options.trustServerCertificate).toBe(false);
      expect(service.getPool()).not.toBeNull();
    });
  });

  /**
   * Phase 06B: mssql@12.7.14 reads `pool`, `connectionTimeout` and `requestTimeout` from the
   * TOP LEVEL of its config object (`lib/base/connection-pool.js`, `lib/tedious/connection-pool.js`).
   * These tests pin the shape, so a future edit cannot quietly put them back under `options`,
   * where the driver ignores them and the pool/timeout settings stop having any effect.
   */
  describe('mssql connection configuration (Phase 06B)', () => {
    it('puts the pool block at the top level, not under options', async () => {
      const config = await connectWithCompleteEnv();

      expect(config.pool).toEqual({ max: 20, min: 0, idleTimeoutMillis: 10000 });
      expect(config.options.pool).toBeUndefined();
    });

    it('puts connectionTimeout and requestTimeout at the top level, where mssql 12 reads them', async () => {
      const config = await connectWithCompleteEnv();

      expect(config.connectionTimeout).toBe(15000);
      expect(config.requestTimeout).toBe(30000);
      expect(config.options.connectionTimeout).toBeUndefined();
      expect(config.options.requestTimeout).toBeUndefined();
    });

    it('requests TDS 7.4 (SQL Server 2016) instead of the unsupported 7_0', async () => {
      const config = await connectWithCompleteEnv();

      expect(config.options.tdsVersion).toBe('7_4');
      expect(config.options.tdsVersion).not.toBe('7_0');
      // TLS stays inside options, which is the only place mssql forwards to tedious.
      expect(config.options.encrypt).toBe(true);
      expect(config.options.trustServerCertificate).toBe(false);
    });

    it('coerces string ERP_* values to numbers and falls back on unusable values', async () => {
      const config = await connectWithCompleteEnv({
        ERP_PORT: '1500',
        ERP_CONNECT_TIMEOUT: '2500',
        ERP_COMMAND_TIMEOUT: 'not-a-number',
        ERP_POOL_MAX: '-1',
        ERP_POOL_IDLE_TIMEOUT: '4500',
      });

      expect(config.port).toBe(1500);
      expect(config.connectionTimeout).toBe(2500);
      // Unparseable or negative values fall back to the documented defaults.
      expect(config.requestTimeout).toBe(30000);
      expect(config.pool.max).toBe(20);
      expect(config.pool.idleTimeoutMillis).toBe(4500);
    });

    it('keeps the documented numeric defaults when the optional tuning env values are absent', async () => {
      // HOST/DB/USER/PASSWORD stay set: they are required, and the service must not connect
      // without them. Only the optional numeric tuning values are omitted here.
      const config = await connectWithCompleteEnv({
        ERP_PORT: undefined,
        ERP_POOL_MAX: undefined, ERP_POOL_MIN: undefined, ERP_POOL_IDLE_TIMEOUT: undefined,
        ERP_COMMAND_TIMEOUT: undefined, ERP_CONNECT_TIMEOUT: undefined,
      });

      expect(config.port).toBe(1433);
      expect(config.connectionTimeout).toBe(15000);
      expect(config.requestTimeout).toBe(30000);
      expect(config.pool).toEqual({ max: 20, min: 0, idleTimeoutMillis: 10000 });
      expect(config.options.tdsVersion).toBe('7_4');
    });
  });

  /**
   * Phase 06C: temporary local-development certificate exception. `trustServerCertificate: true`
   * disables SQL Server identity verification, so it must require NODE_ENV=development, the exact
   * local test host, and an explicit `true` — and must fail closed for every other combination.
   */
  describe('local-only certificate exception (Phase 06C)', () => {
    const localTestEnv = {
      NODE_ENV: 'development',
      ERP_HOST: '192.168.1.200',
      ERP_LOCAL_TEST_ALLOW_UNTRUSTED_CERT: 'true',
    };

    it('allows the exception for development + 192.168.1.200 + exact opt-in, with encryption on', async () => {
      const warn = vi.spyOn(service['logger'], 'warn');

      const config = await connectWithCompleteEnv(localTestEnv);

      expect(config.options.trustServerCertificate).toBe(true);
      expect(config.options.encrypt).toBe(true);
      expect(config.options.tdsVersion).toBe('7_4');
      // The exception is never silent.
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('TEMPORARY LOCAL TEST'));
    });

    it('keeps certificate validation when the opt-in is absent', async () => {
      const config = await connectWithCompleteEnv({ NODE_ENV: 'development', ERP_HOST: '192.168.1.200' });

      expect(config.options.trustServerCertificate).toBe(false);
      expect(config.options.encrypt).toBe(true);
    });

    it('refuses the opt-in outside NODE_ENV=development and says so', async () => {
      const error = vi.spyOn(service['logger'], 'error');

      const config = await connectWithCompleteEnv({ ...localTestEnv, NODE_ENV: 'production' });

      expect(config.options.trustServerCertificate).toBe(false);
      expect(config.options.encrypt).toBe(true);
      expect(error).toHaveBeenCalledWith(expect.stringContaining('Refusing ERP_LOCAL_TEST_ALLOW_UNTRUSTED_CERT=true'));
    });

    it('refuses the opt-in for any other ERP_HOST', async () => {
      const error = vi.spyOn(service['logger'], 'error');

      const config = await connectWithCompleteEnv({ ...localTestEnv, ERP_HOST: '10.0.0.5' });

      expect(config.options.trustServerCertificate).toBe(false);
      expect(config.options.encrypt).toBe(true);
      expect(error).toHaveBeenCalledWith(expect.stringContaining('Refusing ERP_LOCAL_TEST_ALLOW_UNTRUSTED_CERT=true'));
    });

    it('refuses opt-in values that are not exactly "true"', async () => {
      for (const value of ['TRUE', 'True', '1', 'yes', 'true ', ' true']) {
        const config = await connectWithCompleteEnv({ ...localTestEnv, ERP_LOCAL_TEST_ALLOW_UNTRUSTED_CERT: value });

        expect(config.options.trustServerCertificate, `opt-in value ${JSON.stringify(value)} must not be honoured`).toBe(false);
        expect(config.options.encrypt).toBe(true);
      }
    });

    it('never disables encryption, whichever exception state applies', async () => {
      for (const env of [
        { NODE_ENV: 'production', ERP_HOST: '192.168.1.200', ERP_LOCAL_TEST_ALLOW_UNTRUSTED_CERT: 'true' },
        { NODE_ENV: 'development', ERP_HOST: '192.168.1.200', ERP_LOCAL_TEST_ALLOW_UNTRUSTED_CERT: 'true' },
      ]) {
        const config = await connectWithCompleteEnv(env);
        expect(config.options.encrypt).toBe(true);
      }
    });
  });

  describe('executeQuery', () => {
    it('should throw when pool not initialized and no ERP config', async () => {
      // When ERP config is missing, pool stays null; executeQuery should surface the issue
      await expect(service.executeQuery('SELECT 1')).rejects.toThrow(
        'ErpSqlServerService: Connection pool not initialized — ERP data source unavailable.',
      );
    });

    it('should support parameterized query with docId', async () => {
      // This test verifies the method signature and parameter handling.
      // Actual mssql execution requires a running pool; we test the code path.
      const promise = service.executeQuery(
        'SELECT @docId AS doc',
        [{ name: 'docId', type: 'VarChar', value: 'test-doc' }],
      );
      // If pool is not initialized, should throw
      await expect(promise).rejects.toThrow();
    });
  });

  describe('executeScalar', () => {
    it('should throw when pool not initialized', async () => {
      await expect(service.executeScalar('SELECT COUNT(*)')).rejects.toThrow(
        'ErpSqlServerService: Connection pool not initialized.',
      );
    });
  });

  describe('testConnectivity', () => {
    it('should return false when pool not initialized', async () => {
      const result = await service.testConnectivity();
      expect(result).toBeFalsy();
    });
  });

  describe('classifyAndLogError', () => {
    it('should log connection errors appropriately', () => {
      const connectionError = new Error('ECONNREFUSED on 192.168.1.200:1433');
      service['classifyAndLogError'](connectionError);
      // Should not throw
    });

    it('should log auth errors appropriately', () => {
      const authError = new Error('Login failed for user pravahax_readonly');
      service['classifyAndLogError'](authError);
      // Should not throw
    });

    it('should log TLS certificate errors appropriately', () => {
      const certError = new Error('Certificate chain failed: self-signed certificate');
      service['classifyAndLogError'](certError);
      // Should not throw
    });

    it('should log timeout errors appropriately', () => {
      const timeoutError = new Error('Query timeout exceeded 30000ms');
      service['classifyAndLogError'](timeoutError);
      // Should not throw
    });
  });
});