import { describe, expect, it } from 'vitest';
import { briefRoleCodes, permits, roleCapabilities, type Capability } from './policy';
import { RecordPolicyService } from './policy.service';
describe('identity policies', () => {
  it('derives capabilities from the brief §4 matrix and denies unknown capabilities', () => {
    for (const role of briefRoleCodes) expect(roleCapabilities[role]).toBeDefined();
    expect(permits(roleCapabilities.gate, 'identity.manage')).toBe(false);
    expect(permits(roleCapabilities.admin, 'admin.users')).toBe(true);
    expect(permits(roleCapabilities.admin, 'unknown' as Capability)).toBe(false);
  });
  it('gives the final QC decision to the QC operator only (D-03, 2026-11-03)', () => {
    expect(briefRoleCodes).toEqual(['gate', 'gate_doc', 'qc', 'ho', 'accountant', 'head_accountant', 'admin']);
    expect(permits(roleCapabilities.qc, 'qc.measure')).toBe(true);
    expect(permits(roleCapabilities.qc, 'qc.decide')).toBe(true);
    for (const role of briefRoleCodes.filter(code => code !== 'qc')) expect(permits(roleCapabilities[role], 'qc.decide')).toBe(false);
    expect(Object.keys(roleCapabilities)).not.toContain('qc_reviewer');
  });
  it('scopes the accounting roles to the accounting workflow (upgrade 2026-11-03)', () => {
    // The Accountant sees and works the queue but cannot approve or post.
    expect(permits(roleCapabilities.accountant, 'accounting.inbox')).toBe(true);
    expect(permits(roleCapabilities.accountant, 'accounting.review')).toBe(true);
    expect(permits(roleCapabilities.accountant, 'accounting.approve')).toBe(false);
    expect(permits(roleCapabilities.accountant, 'accounting.post')).toBe(false);
    // The Head Accountant inherits the accountant set and holds approve + post.
    expect(permits(roleCapabilities.head_accountant, 'accounting.inbox')).toBe(true);
    expect(permits(roleCapabilities.head_accountant, 'accounting.approve')).toBe(true);
    expect(permits(roleCapabilities.head_accountant, 'accounting.post')).toBe(true);
    // Least privilege: neither accounting role touches HO review or ERP confirmation,
    // and nobody outside Accounts can drive the accounting workflow.
    expect(permits(roleCapabilities.accountant, 'ho.review')).toBe(false);
    expect(permits(roleCapabilities.accountant, 'erp.confirm')).toBe(false);
    expect(permits(roleCapabilities.accountant, 'admin.users')).toBe(false);
    for (const role of ['gate', 'gate_doc', 'qc', 'ho', 'admin'] as const) {
      expect(permits(roleCapabilities[role], 'accounting.review')).toBe(false);
      expect(permits(roleCapabilities[role], 'accounting.post')).toBe(false);
    }
  });
  it('does not give administrators a record visibility bypass', () => {
    const policy = new RecordPolicyService();
    const actor = { userId: 'DEMO-A', sessionId: 'DEMO-S', roles: ['admin'], capabilities: [...roleCapabilities.admin], mustChangePassword: false };
    expect(() => policy.requireVisibility(actor, ['DEMO-B'])).toThrow();
    expect(() => policy.requireSelf(actor, 'DEMO-B')).toThrow();
    expect(() => policy.requireVisibility(actor, ['DEMO-A'])).not.toThrow();
  });
});
