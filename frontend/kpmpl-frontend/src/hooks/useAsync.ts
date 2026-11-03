import { useCallback, useEffect, useRef, useState } from 'react';
import { type ApiError, toApiError } from '../api';

export type AsyncState<T> =
  | { status: 'loading'; data?: T }
  | { status: 'success'; data: T }
  | { status: 'error'; error: ApiError; data?: T };

/** Loads data and exposes an explicit reload; never shows stale success after an error. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<AsyncState<T>>({ status: 'loading' });
  const seq = useRef(0);
  const run = useCallback(() => {
    const id = ++seq.current;
    setState((s) => ({ status: 'loading', data: s.data }));
    fn().then(
      (data) => id === seq.current && setState({ status: 'success', data }),
      (e) => id === seq.current && setState((s) => ({ status: 'error', error: toApiError(e), data: s.data })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { run(); }, [run]);
  /** Apply a fresh copy returned by a write, cancelling any in-flight reload (avoids stale-version races). */
  const setData = useCallback((data: T) => { seq.current++; setState({ status: 'success', data }); }, []);
  return { state, reload: run, setData };
}
