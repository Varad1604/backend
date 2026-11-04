import { beforeEach, describe, expect, it } from 'vitest';
import { mockAdapter as api, mockControls, resetDemoData } from './mockAdapter';
import { MOCK_DEMO_PASSWORD, DEMO_ACCOUNTS } from '../../auth/demoAccounts';
import { ALL_ROLES, can, capsFor } from '../../auth/permissions';

/** D-03 (decided 2026-11-03): the QC operator records the readings AND the final QC decision. */
describe('QC decision by the QC operator (mock adapter, D-03)', () => {
  beforeEach(() => {
    mockControls.set({ latencyMs: 0, failNextWrite: false });
    resetDemoData();
  });

  it('has seven roles and seven demo accounts; only qc holds qc.decide; accounting caps are split', () => {
    expect(ALL_ROLES).toEqual(['gate', 'gate_doc', 'gate_doc_authority', 'qc', 'ho', 'accountant', 'head_accountant', 'admin']);
    expect(DEMO_ACCOUNTS.map((a) => a.username)).toEqual(['demo-gate', 'demo-qc', 'demo-docs', 'demo-ho', 'demo-accountant', 'demo-headacc', 'demo-admin']);
    expect(ALL_ROLES.filter((r) => capsFor(r).includes('qc.decide'))).toEqual(['qc']);
    // Upgrade 2026-11-03: the Accountant works and hands over; only the Head Accountant approves/posts.
    expect(ALL_ROLES.filter((r) => capsFor(r).includes('accounting.review'))).toEqual(['accountant', 'head_accountant']);
    expect(ALL_ROLES.filter((r) => capsFor(r).includes('accounting.approve'))).toEqual(['head_accountant']);
    expect(ALL_ROLES.filter((r) => capsFor(r).includes('accounting.post'))).toEqual(['head_accountant']);
    expect(ALL_ROLES.filter((r) => capsFor(r).includes('erp.confirm'))).toEqual(['ho']);
  });

  it('lets the same QC operator submit readings and then decide; the decision is not a demo record', async () => {
    const gate = await api.login('demo-gate', MOCK_DEMO_PASSWORD);
    const visit = await api.createVisit({ officialGateEntryRef: 'DEMO-D03-1', vehicleNumber: 'DEMO-MH-D03', supplierDisplayName: 'Demo Supplier A',
      materialDisplayName: 'Domestic Waste Paper', grossWeight: { value: '15000.000', unit: 'kg' } }, { idempotencyKey: 'k-create' });
    expect(gate.roles).toEqual(['gate']);
    // Gate cannot decide.
    await expect(api.decideQc(visit.id, { outcome: 'accepted', reason: '' }, { idempotencyKey: 'k-gate', expectedVersion: visit.version })).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const qc = await api.login('demo-qc', MOCK_DEMO_PASSWORD);
    expect(can(qc, 'qc.decide')).toBe(true);
    await api.submitQc(visit.id, { measurements: [{ code: 'moisture', value: '9.50', unit: 'percent' }, { code: 'impurity', value: '1.00', unit: 'percent' }], intent: 'submit' },
      { idempotencyKey: 'k-submit', expectedVersion: visit.version });
    const submitted = await api.getVisit(visit.id);
    expect(submitted.qcStatus).toBe('submitted');
    // The submitted truck waits in the QC operator's own queue.
    expect((await api.getQcQueue()).some((i) => i.visit.id === visit.id && i.visit.qcStatus === 'submitted')).toBe(true);

    const decided = await api.decideQc(visit.id, { outcome: 'accepted', reason: '' }, { idempotencyKey: 'k-decide', expectedVersion: submitted.version });
    expect(decided.qcStatus).toBe('accepted');
    expect(decided.reviews.at(-1)).toMatchObject({ outcome: 'accepted', demonstrationOnly: false, recordedBy: qc.displayName, forRevision: 1 });
    const timeline = await api.getTimeline(visit.id);
    expect(timeline.map((e) => e.action)).toContain('QC accepted');
    expect(timeline.some((e) => /demonstration only/.test(e.action))).toBe(false);
    // A decided inspection cannot be decided again.
    await expect(api.decideQc(visit.id, { outcome: 'rejected', reason: 'x' }, { idempotencyKey: 'k-again', expectedVersion: (await api.getVisit(visit.id)).version }))
      .rejects.toMatchObject({ code: 'DOMAIN_RULE' });
  });
});
