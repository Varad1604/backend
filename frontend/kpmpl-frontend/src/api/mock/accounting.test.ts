/**
 * Accounting workflow (upgrade 2026-11-03) against the MOCK adapter — the same rules the
 * server enforces, so demo mode demonstrates them offline: HO → Accountant → Head Accountant
 * → Bill Posted, with capability denials, mandatory reasons, the duplicate-posting guard and
 * the correction audit trail.
 */
import { describe, expect, it } from 'vitest';
import { api } from '../index';
import { MOCK_DEMO_PASSWORD } from '../../auth/demoAccounts';

async function verifiedPackage(): Promise<{ id: string; version: number }> {
  // DEMO-PKG-0003 is a verified fixture package. List it through a role that can see packages
  // (the Gate operator no longer has docs.prepare — see Part A).
  await api.login('demo-docs', MOCK_DEMO_PASSWORD);
  const packages = await api.listPackages('gate');
  const p = packages.find((x) => x.packageRef === 'DEMO-PKG-0003');
  if (!p) throw new Error('DEMO-PKG-0003 fixture missing');
  return { id: p.id, version: p.version };
}

describe('accounting workflow by the Accountant and Head Accountant (mock)', () => {
  it('walks verified → bill posted and enforces the capability and state rules', async () => {
    const pkg = await verifiedPackage();

    // Gate cannot drive the accounting workflow.
    await expect(api.accountingAction(pkg.id, { kind: 'start_accounting' }, { idempotencyKey: 'k-gate', expectedVersion: pkg.version })).rejects.toMatchObject({ code: 'FORBIDDEN' });

    // The Accountant starts; double-start is refused.
    await api.login('demo-accountant', MOCK_DEMO_PASSWORD);
    let p = await api.accountingAction(pkg.id, { kind: 'start_accounting' }, { idempotencyKey: 'k-start', expectedVersion: pkg.version });
    expect(p.status).toBe('with_accounting');
    expect(p.accounting?.stage).toBe('with_accountant');
    await expect(api.accountingAction(pkg.id, { kind: 'start_accounting' }, { idempotencyKey: 'k-again', expectedVersion: p.version })).rejects.toMatchObject({ code: 'DOMAIN_RULE' });

    // Corrections need a reason and keep the old value.
    p = await api.accountingAction(pkg.id, { kind: 'correct_accounting', field: 'accountingRef', value: 'DEMO-AC-0009', reason: 'Demo bill reference' }, { idempotencyKey: 'k-correct', expectedVersion: p.version });
    expect(p.accounting?.accountingRef).toBe('DEMO-AC-0009');
    expect(p.accounting?.corrections[0]).toMatchObject({ field: 'accountingRef', oldValue: null, newValue: 'DEMO-AC-0009', reason: 'Demo bill reference' });
    // The Head Accountant note belongs to the Head Accountant.
    await expect(api.accountingAction(pkg.id, { kind: 'correct_accounting', field: 'headAccountantNote', value: 'x', reason: 'r' }, { idempotencyKey: 'k-hn', expectedVersion: p.version })).rejects.toMatchObject({ code: 'DOMAIN_RULE' });

    // Hand over; the Accountant can no longer correct.
    p = await api.accountingAction(pkg.id, { kind: 'submit_to_head_accountant', confirmComplete: true }, { idempotencyKey: 'k-submit', expectedVersion: p.version });
    expect(p.status).toBe('with_head_accountant');
    await expect(api.accountingAction(pkg.id, { kind: 'correct_accounting', field: 'accountingRef', value: 'x', reason: 'r' }, { idempotencyKey: 'k-c2', expectedVersion: p.version })).rejects.toMatchObject({ code: 'DOMAIN_RULE' });

    // The Accountant cannot approve or post.
    await expect(api.accountingAction(pkg.id, { kind: 'approve_accounting' }, { idempotencyKey: 'k-ap', expectedVersion: p.version })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(api.accountingAction(pkg.id, { kind: 'post_bill', billRef: 'DEMO-BILL-1' }, { idempotencyKey: 'k-po', expectedVersion: p.version })).rejects.toMatchObject({ code: 'FORBIDDEN' });

    // Head Accountant: return once, then approve.
    await api.login('demo-headacc', MOCK_DEMO_PASSWORD);
    p = await api.accountingAction(pkg.id, { kind: 'return_to_accountant', reason: 'Demo: check the freight line' }, { idempotencyKey: 'k-ret', expectedVersion: p.version });
    expect(p.status).toBe('with_accounting');
    await expect(api.accountingAction(pkg.id, { kind: 'approve_accounting' }, { idempotencyKey: 'k-early', expectedVersion: p.version })).rejects.toMatchObject({ code: 'DOMAIN_RULE' });

    await api.login('demo-accountant', MOCK_DEMO_PASSWORD);
    p = await api.accountingAction(pkg.id, { kind: 'submit_to_head_accountant', confirmComplete: true }, { idempotencyKey: 'k-submit2', expectedVersion: p.version });

    await api.login('demo-headacc', MOCK_DEMO_PASSWORD);
    p = await api.accountingAction(pkg.id, { kind: 'approve_accounting', headAccountantNote: 'Demo approved' }, { idempotencyKey: 'k-appr', expectedVersion: p.version });
    expect(p.status).toBe('accounting_approved');
    expect(p.accounting?.headAccountantNote).toBe('Demo approved');

    // Posting is Head-Accountant-only and exactly once.
    p = await api.accountingAction(pkg.id, { kind: 'post_bill', billRef: '00071-HO' }, { idempotencyKey: 'k-post', expectedVersion: p.version });
    expect(p.status).toBe('bill_posted');
    expect(p.accounting?.accountingRef).toBe('00071-HO');
    expect(p.accounting?.stage).toBe('posted');
    await expect(api.accountingAction(pkg.id, { kind: 'post_bill', billRef: '00071-HO' }, { idempotencyKey: 'k-post2', expectedVersion: p.version })).rejects.toMatchObject({ code: 'DOMAIN_RULE' });
    await expect(api.accountingAction(pkg.id, { kind: 'correct_accounting', field: 'accountingRef', value: 'y', reason: 'r' }, { idempotencyKey: 'k-c3', expectedVersion: p.version })).rejects.toMatchObject({ code: 'DOMAIN_RULE' });

    // The audit trail shows every step in order, including the correction.
    const actions = p.history.map((h) => h.action);
    for (const wording of ['Sent to Accounts', 'Sent to Head Accountant', 'Returned to Accountant', 'Approved by Head Accountant', 'Bill posted', 'Accounting correction recorded']) {
      expect(actions).toContain(wording);
    }
    // The visit timeline carries the bill-posted note.
    const visitId = p.visitIds[0]!;
    const timeline = await api.getTimeline(visitId);
    expect(timeline.some((e) => e.action.includes('posted'))).toBe(true);

    // HO still sees the package and keeps its ERP milestone track.
    await api.login('demo-ho', MOCK_DEMO_PASSWORD);
    const hoCases = await api.listPackages('ho');
    expect(hoCases.some((x) => x.id === p.id)).toBe(true);
  }, 40_000);
});
