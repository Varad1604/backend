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
    expect(briefRoleCodes).toEqual(['gate', 'gate_doc', 'qc', 'ho', 'admin']);
    expect(permits(roleCapabilities.qc, 'qc.measure')).toBe(true);
    expect(permits(roleCapabilities.qc, 'qc.decide')).toBe(true);
    for (const role of briefRoleCodes.filter(code => code !== 'qc')) expect(permits(roleCapabilities[role], 'qc.decide')).toBe(false);
    expect(Object.keys(roleCapabilities)).not.toContain('qc_reviewer');
  });
  it('does not give administrators a record visibility bypass', () => {
    const policy = new RecordPolicyService();
    const actor = { userId: 'DEMO-A', sessionId: 'DEMO-S', roles: ['admin'], capabilities: [...roleCapabilities.admin], mustChangePassword: false };
    expect(() => policy.requireVisibility(actor, ['DEMO-B'])).toThrow();
    expect(() => policy.requireSelf(actor, 'DEMO-B')).toThrow();
    expect(() => policy.requireVisibility(actor, ['DEMO-A'])).not.toThrow();
  });
});
