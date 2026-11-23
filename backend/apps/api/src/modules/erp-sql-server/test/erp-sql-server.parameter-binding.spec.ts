import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * SQL parameter-binding regression — the test that was previously quarantined as
 * malformed, now rebuilt properly against the REAL production binding path.
 *
 * The original defect: the adapter passed the type NAME (`type: 'Int'`, a string)
 * straight into mssql's `request.input(name, type, value)`. mssql@12 resolves the
 * second argument as a type constructor, so the string produced
 *   "Validation failed for parameter 'skip'. Cannot read properties of undefined (reading 'resolve')"
 * on every parameterized query — i.e. every real ERP read failed at runtime even
 * though the service looked wired correctly.
 *
 * These tests therefore assert the actual runtime contract, not a parallel mock:
 *   1. mssqlTypes carries the REAL driver descriptors (identity with the mssql module),
 *   2. through a complete `onModuleInit` → `executeQuery` flow every value reaches
 *      `request.input(name, typeDescriptor, value)` with a FUNCTION descriptor —
 *      never a string — and the descriptor is the exact mssql type the parameter
 *      declared,
 *   3. an unsupported type name fails loudly before any query is sent.
 */
const { poolCtor, requestFactory } = vi.hoisted(() => ({ poolCtor: vi.fn(), requestFactory: vi.fn() }));
vi.mock('mssql', async (importOriginal) => {
  const actual = await importOriginal<typeof import('mssql')>();
  const original = (actual as unknown as { default?: typeof import('mssql') }).default ?? actual;
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
import mssql from 'mssql';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ErpSqlServerService } from '../erp-sql-server.service';
import { mssqlTypes } from '../mssql-types';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { IdempotentWriteService } from '../../platform/idempotent-write.service';

describe('ErpSqlServerService parameter binding (real mssql descriptor contract)', () => {
  let service: ErpSqlServerService;
  /** `.input()` calls recorded off the real binding path: [name, type, value]. */
  let inputCalls: Array<[string, unknown, unknown]>;

  const stringEnv: Record<string, unknown> = {
    NODE_ENV: 'test',
    ERP_HOST: 'kpmlserver', ERP_PORT: '1433', ERP_DB: 'KAYGAONNew24',
    ERP_USER: 'pravahax_readonly', ERP_PASSWORD: 'not-a-real-secret',
    ERP_POOL_MAX: '20', ERP_POOL_MIN: '0', ERP_POOL_IDLE_TIMEOUT: '10000',
    ERP_COMMAND_TIMEOUT: '30000', ERP_CONNECT_TIMEOUT: '15000',
  };
  const mockConfigService = {
    get: vi.fn((key: string, defaultValue?: unknown) => stringEnv[key] ?? defaultValue),
  };
  const mockPrisma = {};
  const mockAudit = { append: vi.fn().mockResolvedValue(undefined) };
  const mockIdempotency = { run: vi.fn().mockResolvedValue({ status: 201, body: { data: {} }, replayed: false }) };

  beforeEach(async () => {
    vi.clearAllMocks();
    inputCalls = [];
    // A plain `function` so `new mssql.ConnectionPool(...)` can construct it; the pool's
    // request() records every `.input()` exactly as the real driver would receive it.
    poolCtor.mockImplementation(function () {
      return {
        connect: vi.fn().mockResolvedValue(undefined),
        request: () => {
          const requestObj = {
            input: (name: string, type: unknown, value: unknown) => {
              inputCalls.push([name, type, value]);
              return requestObj;
            },
            query: vi.fn().mockResolvedValue({ recordset: [{ health: 1 }] }),
          };
          requestFactory(requestObj);
          return requestObj;
        },
        close: vi.fn().mockResolvedValue(undefined),
        // The service's success log reads pool.config.pool?.max — include it so init completes.
        config: { pool: { max: 20, min: 0, idleTimeoutMillis: 10000 } },
      } as unknown;
    });
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
    await service.onModuleInit();
    expect(service.getPool()).not.toBeNull();
  });

  it('carries the REAL mssql@12 type descriptors, not name strings', () => {
    expect(mssqlTypes.Int).toBe(mssql.Int);
    expect(mssqlTypes.VarChar).toBe(mssql.VarChar);
    expect(mssqlTypes.NVarChar).toBe(mssql.NVarChar);
    expect(typeof mssqlTypes.Int).toBe('function');
    expect(typeof mssqlTypes.VarChar).toBe('function');
  });

  it('binds every parameter through request.input(name, typeDescriptor, value) with a FUNCTION descriptor', async () => {
    await service.executeQuery(
      'SELECT @skip AS s, @docId AS d, @party AS p',
      [
        { name: 'skip', type: 'Int', value: 20 },
        { name: 'docId', type: 'VarChar', value: '17110013' },
        { name: 'party', type: 'NVarChar', value: 'P-100' },
      ],
    );

    expect(inputCalls).toHaveLength(3);
    for (const [name, type, value] of inputCalls) {
      // The original runtime failure mode: a STRING type reaching the driver.
      expect(typeof type, `parameter "${name}" must bind a descriptor, not a name`).toBe('function');
      expect(value).toBeDefined();
    }
    // And the descriptor must be the EXACT mssql type the parameter declared.
    expect(inputCalls[0]![1]).toBe(mssql.Int);
    expect(inputCalls[0]![2]).toBe(20);
    expect(inputCalls[1]![1]).toBe(mssql.VarChar);
    expect(inputCalls[1]![2]).toBe('17110013');
    expect(inputCalls[2]![1]).toBe(mssql.NVarChar);
    expect(inputCalls[2]![2]).toBe('P-100');
  });

  it('binds the controller pagination contract (Int skip/limit) the same way', async () => {
    await service.executeQuery(
      'SELECT * FROM GatePage WHERE rn > @skip AND rn <= @skip + @limit',
      [
        { name: 'skip', type: 'Int', value: 0 },
        { name: 'limit', type: 'Int', value: 100 },
      ],
    );

    expect(inputCalls).toHaveLength(2);
    expect(inputCalls[0]![0]).toBe('skip');
    expect(inputCalls[0]![1]).toBe(mssql.Int);
    expect(inputCalls[1]![0]).toBe('limit');
    expect(inputCalls[1]![1]).toBe(mssql.Int);
  });

  it('rejects unsupported SQL type names loudly before any query is sent', async () => {
    await expect(
      service.executeQuery('SELECT @x AS x', [{ name: 'x', type: 'Xml', value: 'nope' }]),
    ).rejects.toThrow('unsupported SQL type "Xml" for parameter "x"');
    expect(inputCalls).toHaveLength(0); // nothing reached the driver
  });

  it('ignores malformed parameter entries without sending them to the driver', async () => {
    await service.executeQuery('SELECT 1', [
      { name: null as unknown as string, type: 'Int', value: 1 },
      { name: 'skip', type: 'Int', value: 5 },
    ]);
    expect(inputCalls).toHaveLength(1);
    expect(inputCalls[0]![0]).toBe('skip');
  });
});
