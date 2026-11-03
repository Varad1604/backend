/**
 * RFC 4122 v4 UUID for Idempotency-Key headers (brief §3: `Idempotency-Key: <uuid>`).
 * Uses crypto.randomUUID where available (secure contexts), else builds one from
 * crypto.getRandomValues (e.g. the file:// review preview). Never Math.random.
 */
export function uuidV4(): string {
  const c: Crypto | undefined = typeof globalThis.crypto !== 'undefined' ? globalThis.crypto : undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  if (!c || typeof c.getRandomValues !== 'function') throw new Error('Secure random numbers are not available in this browser.');
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Temporary password for the mock adapter only (the real server generates its own). */
export function mockTemporaryPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const b = globalThis.crypto.getRandomValues(new Uint8Array(12));
  return Array.from(b, (x) => alphabet[x % alphabet.length]).join('');
}
