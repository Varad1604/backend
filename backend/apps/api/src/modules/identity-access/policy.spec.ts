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
    // B-23: `gate_doc_authority` joined the matrix as a first-class role (docs.prepare +
    // docs.submit + Plant Head approval); `gate_doc` remains as the legacy alias row.
    expect(briefRoleCodes).toEqual(['gate', 'gate_doc', 'gate_doc_authority', 'qc', 'ho', 'accountant', 'admin']);
    expect(roleCapabilities.gate_doc_authority).toBeDefined();
    expect(Object.keys(roleCapabilities)).not.toContain('qc_reviewer');
    expect(permits(roleCapabilities.qc, 'qc.measure')).toBe(true);
    expect(permits(roleCapabilities.qc, 'qc.decide')).toBe(true);
    for (const role of briefRoleCodes.filter(code => code !== 'qc')) expect(permits(roleCapabilities[role], 'qc.decide')).toBe(false);
    expect(Object.keys(roleCapabilities)).not.toContain('qc_reviewer');
  });
  it('consolidates accounting review, approval and posting into Accountant only', () => {
    expect(permits(roleCapabilities.accountant, 'accounting.inbox')).toBe(true);
    expect(permits(roleCapabilities.accountant, 'accounting.review')).toBe(true);
    expect(permits(roleCapabilities.accountant, 'accounting.approve')).toBe(true);
    expect(permits(roleCapabilities.accountant, 'accounting.post')).toBe(true);
    expect(permits(roleCapabilities.accountant, 'erp.final_posting')).toBe(true);
    expect(permits(roleCapabilities.accountant, 'ho.review')).toBe(false);
    expect(permits(roleCapabilities.accountant, 'erp.confirm')).toBe(false);
    expect(permits(roleCapabilities.accountant, 'admin.users')).toBe(false);
    expect(Object.keys(roleCapabilities)).not.toContain('head_accountant');
    for (const role of ['gate', 'gate_doc', 'gate_doc_authority', 'qc', 'ho', 'admin'] as const) {
      expect(permits(roleCapabilities[role], 'accounting.review')).toBe(false);
      expect(permits(roleCapabilities[role], 'accounting.post')).toBe(false);
    }
  });
  it('allows all existing operational roles to use scoped gate lookup without exposing the full ERP browser', () => {
    for (const role of briefRoleCodes) {
      expect(permits(roleCapabilities[role], 'receiving.view')).toBe(true);
    }
    for (const role of briefRoleCodes.filter(role => role !== 'ho')) {
      expect(permits(roleCapabilities[role], 'erp.read')).toBe(false);
    }
    expect(permits(roleCapabilities.ho, 'erp.read')).toBe(true);
  });

  it('keeps package preparation away from the plain Gate operator (Phase 1-2 RBAC)', () => {
    expect(permits(roleCapabilities.gate, 'docs.prepare')).toBe(false);
    expect(permits(roleCapabilities.gate, 'docs.submit')).toBe(false);
    expect(permits(roleCapabilities.gate_doc_authority, 'docs.prepare')).toBe(true);
    expect(permits(roleCapabilities.gate_doc_authority, 'docs.submit')).toBe(true);
    // The Plant Head approval milestone moved to its own capability.
    expect(permits(roleCapabilities.gate_doc_authority, 'erp.plant_head_approval')).toBe(true);
    expect(permits(roleCapabilities.ho, 'erp.purchase_voucher')).toBe(true);
    expect(permits(roleCapabilities.accountant, 'erp.final_posting')).toBe(true);
    expect(permits(roleCapabilities.ho, 'erp.final_posting')).toBe(false);
  });
  it('does not give administrators a record visibility bypass', () => {
    const policy = new RecordPolicyService();
    const actor = { userId: 'DEMO-A', sessionId: 'DEMO-S', roles: ['admin'], capabilities: [...roleCapabilities.admin], mustChangePassword: false };
    expect(() => policy.requireVisibility(actor, ['DEMO-B'])).toThrow();
    expect(() => policy.requireSelf(actor, 'DEMO-B')).toThrow();
    expect(() => policy.requireVisibility(actor, ['DEMO-A'])).not.toThrow();
  });
});
