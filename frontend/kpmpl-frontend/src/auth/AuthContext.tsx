import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from '../api';
import type { User } from '../domain/types';
import { onSessionExpired } from './sessionEvents';

interface AuthCtx {
  user: User | null;
  ready: boolean;
  /** True after the server ended the session (401 on a normal call). Cleared by the next login. */
  sessionExpired: boolean;
  login: (u: string, p: string) => Promise<User>;
  logout: () => Promise<void>;
  /** Re-read the signed-in user from the server (e.g. after a password change). */
  refresh: () => Promise<User | null>;
}
const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);

  useEffect(() => {
    api.me().then(setUser).catch(() => setUser(null)).finally(() => setReady(true));
  }, []);

  const userRef = useRef<User | null>(null);
  useEffect(() => {
    userRef.current = user;
  }, [user]);
  useEffect(
    () =>
      onSessionExpired(() => {
        if (userRef.current) setSessionExpired(true);
        setUser(null);
      }),
    [],
  );

  const login = useCallback(async (u: string, p: string) => {
    const me = await api.login(u, p);
    setSessionExpired(false);
    setUser(me);
    return me;
  }, []);
  const logout = useCallback(async () => {
    await api.logout().catch(() => undefined);
    setSessionExpired(false);
    setUser(null);
  }, []);
  const refresh = useCallback(async () => {
    const me = await api.me();
    setUser(me);
    return me;
  }, []);

  const value = useMemo(() => ({ user, ready, sessionExpired, login, logout, refresh }), [user, ready, sessionExpired, login, logout, refresh]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components -- hook belongs with its provider
export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth outside AuthProvider');
  return c;
}
