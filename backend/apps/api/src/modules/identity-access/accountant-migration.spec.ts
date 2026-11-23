import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { briefRoleCodes, roleCapabilities } from './policy';

const sql = readFileSync(resolve('prisma/migrations/20261118150000_consolidate_accountant_role/migration.sql'), 'utf8');

describe('Head Accountant retirement migration: static safety contract', () => {
  it('leaves only Accountant as a current role and transfers the exact three capabilities', () => {
    expect(briefRoleCodes).toContain('accountant');
    expect(briefRoleCodes).not.toContain('head_accountant');
    for (const cap of ['accounting.approve', 'accounting.post', 'erp.final_posting']) {
      expect(roleCapabilities.accountant).toContain(cap);
      expect(sql).toContain("'" + cap + "'");
    }
  });

  it('bumps versions of in-flight legacy cases and preserves posted bills and approvals', () => {
    expect(sql).toMatch(/status\s*=\s*'with_accounting',\s*version\s*=\s*version\s*\+\s*1/i);
    expect(sql).toContain("WHERE stage = 'with_head_accountant'");
    expect(sql).not.toMatch(/UPDATE\s+"DocumentPackage"[\s\S]*?WHERE\s+status\s*=\s*'bill_posted'/i);
    expect(sql).not.toMatch(/DELETE\s+FROM\s+"(?:AuditEvent|User|AccountingRecord|AccountingCorrection|PackageHistory|DocumentPackage)"/i);
  });

  it('transfers real user roles and revokes old sessions while preserving historical actor rows', () => {
    expect(sql).toContain('INSERT INTO "UserRole"');
    expect(sql).toContain('ON CONFLICT ("userId", "roleId") DO NOTHING');
    expect(sql).toContain('INSERT INTO "RoleCapability"');
    expect(sql).toContain('ON CONFLICT ("roleId", "capabilityId") DO NOTHING');
    expect(sql).toContain('UPDATE "Session"');
    expect(sql).toContain('UPDATE "User"');
    expect(sql).toContain('"isActive" = FALSE');
    expect(sql).toContain('DELETE FROM "Role"');
  });

  it('handles an empty freshly migrated database without assuming roles were seeded', () => {
    expect(sql).toContain('IF old_role_id IS NOT NULL AND accountant_role_id IS NULL THEN');
    expect(sql).toContain('IF accountant_role_id IS NOT NULL THEN');
    expect(sql).toContain('IF old_role_id IS NOT NULL THEN');
  });
});
