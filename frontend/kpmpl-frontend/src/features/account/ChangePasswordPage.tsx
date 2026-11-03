import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { landingPath } from '../../auth/permissions';
import { MIN_PASSWORD_LENGTH } from '../../domain/types';
import { useWrite } from '../../hooks/useWrite';
import { SafeForm } from '../../components/ui/SafeForm';
import { FieldSet, FormFooter, PageHeader } from '../../components/ui/Layout';
import { Alert, Note } from '../../components/ui/States';
import { Button, ButtonLink } from '../../components/ui/Button';
import { TextField } from '../../components/ui/Field';
import { WriteError } from '../../components/ui/WriteError';

type Vals = { current: string; next: string; confirm: string };

/**
 * Change password (brief §5.6 `POST /auth/change-password`). Reached from the header account
 * menu, and forced by RequireAuth while the server flags `mustChangePassword` (first sign-in
 * after an admin creates the account or resets its password). Rules shown here are a guide;
 * the server enforces the minimum length and the breached-password check.
 */
export function ChangePasswordPage() {
  const { user, refresh, logout } = useAuth();
  const navigate = useNavigate();
  const forced = !!user?.mustChangePassword;
  const [vals, setVals] = useState<Vals>({ current: '', next: '', confirm: '' });
  const [errs, setErrs] = useState<Partial<Record<keyof Vals, string>>>({});
  const [done, setDone] = useState(false);
  const w = useWrite();
  const set = (k: keyof Vals) => (e: { target: { value: string } }) => {
    setVals((x) => ({ ...x, [k]: e.target.value }));
    setErrs((x) => ({ ...x, [k]: undefined }));
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    const ex: Partial<Record<keyof Vals, string>> = {};
    if (!vals.current) ex.current = forced ? 'Enter the temporary password.' : 'Enter your current password.';
    if (vals.next.length < MIN_PASSWORD_LENGTH) ex.next = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
    else if (vals.next === vals.current) ex.next = 'Choose a password different from the current one.';
    if (!ex.next && vals.confirm !== vals.next) ex.confirm = 'The two new passwords do not match.';
    setErrs(ex);
    if (Object.values(ex).some(Boolean)) return;
    const r = await w.run('change-password', (k) => api.changePassword({ currentPassword: vals.current, newPassword: vals.next }, { idempotencyKey: k }));
    if (r.ok) {
      setVals({ current: '', next: '', confirm: '' });
      setDone(true);
      await refresh().catch(() => null);
    } else if (r.error?.code === 'VALIDATION_FAILED') {
      setErrs({ current: r.error.fields.currentPassword, next: r.error.fields.newPassword });
    }
  }

  if (done && user) {
    return (
      <>
        <PageHeader title="Change password" />
        <div className="flex max-w-xl flex-col gap-6">
          <Alert tone="success" title="Password changed">Use the new password the next time you sign in.</Alert>
          <div><Button onClick={() => navigate(landingPath(user), { replace: true })}>Continue</Button></div>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Change password"
        description={forced ? 'Your administrator set a temporary password. Choose your own before you continue.' : 'Choose a new password for your account.'} />
      <SafeForm onSubmit={submit} noValidate className="flex max-w-xl flex-col gap-9">
        {forced && <Alert tone="warning" title="New password needed">You can use the system after you change the temporary password.</Alert>}
        <WriteError error={w.error?.code === 'VALIDATION_FAILED' ? null : w.error} />
        <FieldSet legend="Password" cols={1}>
          <TextField label={forced ? 'Temporary password' : 'Current password'} required type="password" autoComplete="current-password"
            value={vals.current} onChange={set('current')} error={errs.current} />
          <TextField label="New password" required type="password" autoComplete="new-password"
            value={vals.next} onChange={set('next')} error={errs.next}
            hint={`At least ${MIN_PASSWORD_LENGTH} characters. A long phrase is easier to remember than symbols.`} />
          <TextField label="Repeat new password" required type="password" autoComplete="new-password"
            value={vals.confirm} onChange={set('confirm')} error={errs.confirm} />
        </FieldSet>
        <Note>Never share your password. The administrator can reset it but cannot see it.</Note>
        <FormFooter>
          {forced
            ? <Button type="button" variant="ghost" onClick={() => { void logout().then(() => navigate('/login', { replace: true })); }}>Sign out</Button>
            : <ButtonLink to={user ? landingPath(user) : '/'} variant="ghost">Cancel</ButtonLink>}
          <Button type="submit" loading={!!w.busy}>Change password</Button>
        </FormFooter>
      </SafeForm>
    </>
  );
}
