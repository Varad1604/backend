import { lazy, Suspense, useRef, useState, type FormEvent } from 'react';
import { SafeForm } from '../../components/ui/SafeForm';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { CHANGE_PASSWORD_PATH, type LoginRedirectState } from '../../auth/guards';
import { safeReturnPath } from '../../auth/redirect';
import { useAuth } from '../../auth/AuthContext';
import { landingPath } from '../../auth/permissions';
import { config } from '../../config';
import { describeError, toApiError } from '../../api';
import { Button } from '../../components/ui/Button';
import { TextField } from '../../components/ui/Field';
import { Alert } from '../../components/ui/States';
import { PrototypeBanner } from '../../components/layout/PrototypeBanner';
import { Wordmark } from '../../components/layout/BrandMark';

// Loaded only in demo app mode so demo identities are never fetched in production.
// The condition is on raw env values so Vite inlines it and a production build drops the picker entirely.
const DemoRolePicker =
  import.meta.env.VITE_APP_MODE === 'production' || (import.meta.env.VITE_API_MODE === 'http' && !import.meta.env.VITE_APP_MODE)
    ? null
    : lazy(() => import('./DemoRolePicker'));

/** Sign in. No self-registration. The demo account picker exists only when APP_MODE=demo. */
export function LoginPage() {
  const { user, login, sessionExpired } = useAuth();
  const navigate = useNavigate();
  const loc = useLocation();
  const returnTo = safeReturnPath((loc.state as LoginRedirectState | null)?.from);
  const passwordRef = useRef<HTMLInputElement>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErr, setFieldErr] = useState<{ u?: string; p?: string }>({});

  if (user) return <Navigate to={user.mustChangePassword ? CHANGE_PASSWORD_PATH : returnTo ?? landingPath(user)} replace />;

  async function doLogin(u: string, p: string) {
    setBusy(true);
    setError(null);
    try {
      const me = await login(u, p);
      navigate(me.mustChangePassword ? CHANGE_PASSWORD_PATH : returnTo ?? landingPath(me), { replace: true });
    } catch (e) {
      const err = toApiError(e);
      setError(err.code === 'UNAUTHENTICATED' ? 'Username or password is incorrect.' : describeError(err).body);
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const fe = { u: username.trim() ? undefined : 'Enter your username.', p: password ? undefined : 'Enter your password.' };
    setFieldErr(fe);
    if (fe.u || fe.p) return;
    void doLogin(username, password);
  }

  return (
    <div className="flex min-h-dvh flex-col bg-paper">
      <PrototypeBanner />
      <div className="mx-auto w-full max-w-[1280px] flex-1 px-5 pb-16 pt-10 md:px-8 lg:pl-[calc(2rem+8%)] lg:pt-16">
        <Wordmark large />
        <div className="mt-14 grid gap-16 lg:mt-20 lg:grid-cols-[360px_minmax(0,460px)] lg:gap-24">
          <div className="w-full max-w-[360px]">
            <h1 className="text-[40px] font-semibold leading-none tracking-[-0.02em]">Sign in</h1>
            <p className="mt-3 text-[16px] text-muted">Kaygaon Paper Mills</p>
            <SafeForm onSubmit={onSubmit} noValidate className="mt-9 flex flex-col gap-5">
              {error && <Alert tone="danger">{error}</Alert>}
              {!error && sessionExpired && (
                <Alert tone="warning" title="Your session has ended">Sign in again to continue{returnTo ? ' where you left off' : ''}. Anything not yet saved was not sent.</Alert>
              )}
              <TextField label="Username" required autoComplete="username" autoCapitalize="none" spellCheck={false}
                value={username} onChange={(e) => setUsername(e.target.value)} error={fieldErr.u} />
              <TextField ref={passwordRef} label="Password" required type="password" autoComplete="current-password"
                value={password} onChange={(e) => setPassword(e.target.value)} error={fieldErr.p} />
              <div className="mt-1 flex flex-wrap items-center gap-x-6 gap-y-3">
                <Button type="submit" loading={busy} size="lg" className="min-w-[132px]">{busy ? 'Signing in…' : 'Sign in'}</Button>
                <p className="text-[15px] text-muted">Forgot it? Ask the administrator.</p>
              </div>
            </SafeForm>
          </div>

          {config.isDemo && DemoRolePicker && (
            <div className="border-t border-rule pt-6 lg:border-0 lg:pt-1">
              <Suspense fallback={null}>
                {/* Mock: one click signs in. Server demo seed: fills the username; the password comes from the server's DEMO_PASSWORD. */}
                <DemoRolePicker disabled={busy} signsIn={config.isMock}
                  onPick={(u, p) => {
                    if (p !== undefined) { void doLogin(u, p); return; }
                    setUsername(u); setPassword(''); setFieldErr({}); passwordRef.current?.focus();
                  }} />
              </Suspense>
            </div>
          )}
        </div>
      </div>
      <footer className="mx-auto w-full max-w-[1280px] px-5 pb-6 md:px-8 lg:pl-[calc(2rem+8%)]">
        <p className="border-t border-rule pt-3 font-mono text-[15px] text-muted">Kaygaon Paper Mills · Gate to Bill · {config.isDemo ? 'prototype ' : ''}v0.6</p>
      </footer>
    </div>
  );
}
