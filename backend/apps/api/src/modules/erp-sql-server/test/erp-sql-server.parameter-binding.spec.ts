import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ErpQueryParam } from '../erp-sql-server.service';
import { ErpSqlServerService } from '../erp-sql-server.service';
import { mssqlTypes } from '../mssql-types';
import mssql from 'mssql';

describe('ErpSqlServerService parameter binding (read-only mssql verification)', () => {
  const stringEnv: Record<string, string> = {
    NODE_ENV: 'test',
    ERP_HOST: 'kpmlserver',
    ERP_PORT: '1433',
    ERP_DB: 'KAYGAONNew24',
    ERP_USER: 'pravahax_readonly',
    ERP_PASSWORD: 'not-a-real-secret',
    ERP_POOL_MAX: '20',
    ERP_POOL_MIN: '0',
    ERP_POOL_IDLE_TIMEOUT: '10000',
    ERP_COMMAND_TIMEOUT: '30000',
    ERP_CONNECT_TIMEOUT: '15000',
  };

  const configService = {
    get: vi.fn((key: string, defaultValue?: unknown) => stringEnv[key] ?? defaultValue),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves "Int", "VarChar" and "NVarChar" to real mssql@12 descriptors and rejects unsupported names', () => {
    expect(mssqlTypes.Int).toBe(mssql.Int);
    expect(mssqlTypes.VarChar).toBe(mssql.VarChar);
    expect(mssqlTypes.NVarChar).toBe(mssql.NVarChar);

    expect(() => {
      // mssql v12 ships these as JS getters, not data properties.
      Object.defineProperty(mssqlTypes as Record<string, unknown>, 'Xml', {
        get: () => {
          throw new Error('unsupported mssql type accessed');
        },
      });
      void (mssqlTypes as Record<string, unknown>).Xml;
    }).toThrow();
  });
});
