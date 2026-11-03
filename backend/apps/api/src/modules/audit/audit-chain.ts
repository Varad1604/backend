import { createHash } from 'node:crypto';
export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  const record = value as Record<string, unknown>;
  return '{' + Object.keys(record).sort().map(key => JSON.stringify(key) + ':' + canonical(record[key])).join(',') + '}';
}
export interface ChainRow {
  id: bigint; entityType: string; entityId: string; action: string; actorId: string | null;
  oldValue: unknown; newValue: unknown; reason: string | null; source: string;
  recordedAt: Date; prevHash: string | null; rowHash: string;
}
export function hashRow(row: Omit<ChainRow, 'rowHash'>): string {
  return createHash('sha256').update(canonical({ ...row, id: row.id.toString(), recordedAt: row.recordedAt.toISOString() })).digest('hex');
}
export function verifyRows(rows: readonly ChainRow[], previous: string | null = null) {
  for (const row of rows) {
    const { rowHash, ...content } = row;
    if (row.prevHash !== previous || hashRow(content) !== rowHash) return { valid: false, checked: rows.indexOf(row), invalidEventId: row.id.toString() };
    previous = rowHash;
  }
  return { valid: true, checked: rows.length };
}
