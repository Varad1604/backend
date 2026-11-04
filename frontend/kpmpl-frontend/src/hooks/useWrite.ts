import { useCallback, useRef, useState } from 'react';
import { toApiError, type ApiError } from '../api';
import { newIdempotencyKey } from '../lib/format';

/**
 * One place for write behaviour on every screen:
 *  - blocks double clicks (one write at a time),
 *  - reuses the same idempotency key when the user retries after a failure,
 *  - never reports success unless the adapter returned one.
 */
export type WriteResult<T> = { ok: true; data: T } | { ok: false; error: ApiError | null };

export function useWrite() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const keys = useRef<Record<string, string>>({});
  const inFlight = useRef(false);

  const run = useCallback(async <T,>(tag: string, fn: (idempotencyKey: string) => Promise<T>): Promise<WriteResult<T>> => {
    if (inFlight.current) return { ok: false, error: null };
    inFlight.current = true;
    keys.current[tag] ??= newIdempotencyKey();
    setBusy(tag);
    setError(null);
    try {
      const data = await fn(keys.current[tag]);
      delete keys.current[tag];
      return { ok: true, data };
    } catch (e) {
      const err = toApiError(e);
      setError(err);
      // F-11: the key must never be reused with a DIFFERENT payload. After an unambiguous
      // failure (validation, conflict, permission, not-found — the server rolled back) the
      // key rotates so a changed payload/version is safe. Only genuinely ambiguous failures
      // (network unreachable, server error — the write may or may not have saved) keep the
      // same key so a blind retry replays the original request.
      if (err.code !== 'NETWORK_UNAVAILABLE' && err.code !== 'SERVER_ERROR') delete keys.current[tag];
      return { ok: false, error: err };
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  }, []);

  return { busy, error, setError, run };
}
