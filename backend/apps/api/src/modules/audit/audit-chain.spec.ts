import { describe, expect, it } from 'vitest';
import { hashRow, verifyRows, type ChainRow } from './audit-chain';
describe('audit hash chain', () => {
  const makeRow = (id: bigint, prevHash: string | null): ChainRow => {
    const content = { id, prevHash, entityType: 'Session', entityId: 'DEMO-SESSION', action: 'login', actorId: null,
      oldValue: null, newValue: { nested: { b: 2, a: 1 } }, reason: null, source: 'app', recordedAt: new Date('2026-11-01T00:00:00Z') };
    return { ...content, rowHash: hashRow(content) };
  };
  it('verifies canonical nested payloads and detects edits, deletion and reordering', () => {
    const first = makeRow(1n, null);
    const second = makeRow(2n, first.rowHash);
    expect(verifyRows([first, second])).toEqual({ valid: true, checked: 2 });
    expect(verifyRows([{ ...first, action: 'tampered' }, second]).valid).toBe(false);
    expect(verifyRows([second]).valid).toBe(false);
    expect(verifyRows([second, first]).valid).toBe(false);
    expect(verifyRows([{ ...first, newValue: { nested: { a: 1, b: 2 } } }, second]).valid).toBe(true);
  });
});
