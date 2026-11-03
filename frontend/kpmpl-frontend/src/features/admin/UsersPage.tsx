import { useRef, useState } from 'react';
import { config } from '../../config';
import { api } from '../../api';
import { useAsync } from '../../hooks/useAsync';
import { useWrite } from '../../hooks/useWrite';
import { useAuth } from '../../auth/AuthContext';
import { ALL_ROLES, capabilityLabel, capsFor, roleLabel, type Capability } from '../../auth/permissions';
import type { CreatedUser, RoleCode, User } from '../../domain/types';
import { Card, PageHeader, TableWrap } from '../../components/ui/Layout';
import { RequiredMark } from '../../components/ui/Field';
import { Alert, ErrorState, InfoCallout, LoadingState, Note } from '../../components/ui/States';
import { Button } from '../../components/ui/Button';
import { Tag } from '../../components/ui/StatusTag';
import { TextField } from '../../components/ui/Field';
import { FormDialog } from '../../components/ui/Dialog';
import { WriteError } from '../../components/ui/WriteError';

/** A temporary password the server returned once. Held in memory only until dismissed. */
interface OneTimePassword { displayName: string; username: string; password: string; reason: 'created' | 'reset' }

/**
 * Shows a one-time temporary password with a copy button. If the Clipboard API is not
 * available (insecure context, permission denied), the text is selected for Ctrl+C instead.
 */
function TemporaryPasswordNotice({ otp, onDone }: { otp: OneTimePassword; onDone: () => void }) {
  const codeRef = useRef<HTMLElement>(null);
  const [copy, setCopy] = useState<'idle' | 'copied' | 'select'>('idle');
  function selectText() {
    const el = codeRef.current;
    const sel = window.getSelection();
    if (!el || !sel) return;
    const range = document.createRange();
    range.selectNodeContents(el);
    sel.removeAllRanges();
    sel.addRange(range);
  }
  async function doCopy() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('no clipboard');
      await navigator.clipboard.writeText(otp.password);
      setCopy('copied');
    } catch {
      selectText();
      setCopy('select');
    }
  }
  return (
    <section aria-labelledby="otp-title" className="mb-10 max-w-2xl border-l-2 border-wait py-1 pl-3.5">
      <h2 id="otp-title" className="font-semibold text-wait">
        {otp.reason === 'created' ? `${otp.displayName} added` : `Password reset for ${otp.displayName}`}
      </h2>
      <p className="mt-1 text-[16px]">Temporary password for <span className="font-mono">{otp.username}</span>. It is shown only now. Give it to them in person; they must choose their own at first sign-in.</p>
      <div className="mt-3 flex flex-wrap items-baseline gap-x-5 gap-y-2 border-y border-rule py-2.5">
        <code ref={codeRef} aria-label="Temporary password" className="select-all font-mono text-[18px] font-medium tracking-[0.04em] text-ink">{otp.password}</code>
        <button type="button" onClick={doCopy} className="act min-h-10 text-[15px] sm:min-h-0">{copy === 'copied' ? 'Copied' : 'Copy'}</button>
        <button type="button" onClick={onDone} className="act min-h-10 text-[15px] sm:min-h-0">Done, hide it</button>
      </div>
      <p role="status" className="mt-1.5 min-h-5 text-[15px] text-muted">
        {copy === 'copied' && 'Copied to the clipboard.'}
        {copy === 'select' && 'Copy is not available here. The password is selected: press Ctrl+C (or ⌘C).'}
      </p>
    </section>
  );
}

/** User administration — sample accounts only until KPMPL provides the staff list. */
export function UsersPage() {
  const { user: me } = useAuth();
  const { state, reload } = useAsync(() => api.listUsers(), []);
  const [edit, setEdit] = useState<User | 'new' | null>(null);
  const [toggle, setToggle] = useState<User | null>(null);
  const [reset, setReset] = useState<User | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [otp, setOtp] = useState<OneTimePassword | null>(null);
  const w = useWrite();

  async function doToggle() {
    if (!toggle) return;
    const r = await w.run(`toggle-${toggle.id}`, (k) => api.updateUser(toggle.id, { active: !toggle.active }, { idempotencyKey: k }));
    if (r.ok) { setNotice(`${r.data.displayName} ${r.data.active ? 'reactivated' : 'deactivated'}.`); setToggle(null); reload(); }
  }
  async function doReset() {
    if (!reset) return;
    const target = reset;
    const r = await w.run(`reset-${target.id}`, (k) => api.adminResetPassword(target.id, { idempotencyKey: k }));
    if (r.ok) {
      setNotice(null);
      setOtp({ displayName: target.displayName, username: target.username, password: r.data.temporaryPassword, reason: 'reset' });
      setReset(null);
      reload();
    }
  }

  return (
    <>
      <PageHeader title="Users and Access" description="Who can sign in, and what each role can do." actions={<Button onClick={() => setEdit('new')}>{config.isDemo ? 'Add demo user' : 'Add user'}</Button>} />
      {config.isDemo && (
        <InfoCallout className="-mt-5 mb-8">
          Sample accounts only{config.isMock && <>, password <span className="font-mono not-italic text-ink">demo</span></>}. The real staff list and permissions are pending KPMPL confirmation.
        </InfoCallout>
      )}
      {otp && <TemporaryPasswordNotice otp={otp} onDone={() => setOtp(null)} />}
      {notice && <Alert tone="success" className="mb-8">{notice}</Alert>}

      <Card title="Accounts" className="mb-14">
        {state.status === 'loading' && !state.data && <LoadingState />}
        {state.status === 'error' && <ErrorState error={state.error} onRetry={reload} />}
        {state.data && (
          <TableWrap>
            <table className="tbl min-w-[860px]">
              <thead><tr><th scope="col">Name</th><th scope="col">Username</th><th scope="col">Roles</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {state.data.map((u) => (
                  <tr key={u.id}>
                    <td className="font-medium">{u.displayName}{u.id === me?.id && <span className="font-normal text-[16px] text-muted"> (you)</span>}</td>
                    <td className="nowrap font-mono text-[15px] text-ink-soft">{u.username}</td>
                    <td>{u.roles.map((r) => roleLabel[r]).join(', ')}</td>
                    <td>{u.active ? <Tag tone="success">Active</Tag> : <Tag tone="neutral">Deactivated</Tag>}</td>
                    <td className="w-0">
                      <div className="flex justify-end gap-5">
                        <Button variant="ghost" size="sm" onClick={() => setEdit(u)}>Edit roles</Button>
                        <Button variant="ghost" size="sm" disabled={u.id === me?.id || !u.active} title={u.id === me?.id ? 'Use Change password for your own account' : undefined}
                          onClick={() => { w.setError(null); setReset(u); }}>Reset password</Button>
                        <Button variant="ghost" size="sm" className={u.active ? '!text-problem hover:!decoration-problem' : ''} disabled={u.id === me?.id} onClick={() => { w.setError(null); setToggle(u); }}>{u.active ? 'Deactivate' : 'Reactivate'}</Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>

      <Card title="What each role can do" subtitle="Proposed, pending KPMPL confirmation.">
        <TableWrap>
          <table className="tbl tbl-wrap min-w-[760px]">
            <thead><tr>
              <th scope="col">Function</th>{ALL_ROLES.map((r) => <th scope="col" key={r} className="text-center" style={{ whiteSpace: 'normal' }}>{roleLabel[r]}</th>)}
            </tr></thead>
            <tbody>
              {(Object.keys(capabilityLabel) as Capability[]).map((c) => (
                <tr key={c}>
                  <td>{capabilityLabel[c]}</td>
                  {ALL_ROLES.map((r) => <td key={r} className="text-center">{capsFor(r).includes(c) ? <span aria-label="yes" className="text-done">●</span> : <span aria-label="no" className="text-faint">·</span>}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
        <Note className="mt-4">No real role can accept or reject QC yet. The server must enforce these permissions.</Note>
      </Card>

      {edit && <UserDialog key={edit === 'new' ? 'new' : edit.id} target={edit} onClose={() => setEdit(null)}
        onSaved={(m, created) => {
          setEdit(null);
          if (created?.temporaryPassword) { setNotice(null); setOtp({ displayName: created.displayName, username: created.username, password: created.temporaryPassword, reason: 'created' }); }
          else setNotice(m);
          reload();
        }} />}
      <FormDialog open={!!reset} title="Reset password?" confirmLabel="Reset password" danger busy={!!w.busy} onCancel={() => setReset(null)} onConfirm={doReset}>
        <p>{reset?.displayName} gets a new temporary password and is signed out everywhere. You will see the password once, here.</p>
        <WriteError error={w.error} />
      </FormDialog>
      <FormDialog open={!!toggle} title={toggle?.active ? 'Deactivate account?' : 'Reactivate account?'} confirmLabel={toggle?.active ? 'Deactivate' : 'Reactivate'}
        danger={toggle?.active} busy={!!w.busy} onCancel={() => setToggle(null)} onConfirm={doToggle}>
        <p>{toggle?.active ? `${toggle?.displayName} will no longer be able to sign in. Their past actions stay in history.` : `${toggle?.displayName} will be able to sign in again.`}</p>
        <WriteError error={w.error} />
      </FormDialog>
    </>
  );
}

function UserDialog({ target, onClose, onSaved }: { target: User | 'new'; onClose: () => void; onSaved: (msg: string, created?: CreatedUser) => void }) {
  const isNew = target === 'new';
  const [username, setUsername] = useState('');
  const [name, setName] = useState(isNew ? '' : target.displayName);
  const [roles, setRoles] = useState<RoleCode[]>(isNew ? [] : target.roles);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const w = useWrite();

  async function save() {
    const ex: Record<string, string> = {};
    if (isNew && !username.trim()) ex.username = 'Enter a username.';
    if (!name.trim()) ex.displayName = 'Enter a display name.';
    if (!roles.length) ex.roles = 'Choose at least one role.';
    setErrs(ex);
    if (Object.keys(ex).length) return;
    const r = isNew
      ? await w.run('create', (k) => api.createUser({ username, displayName: name, roles }, { idempotencyKey: k }))
      : await w.run('update', (k) => api.updateUser(target.id, { displayName: name, roles }, { idempotencyKey: k }));
    if (r.ok) onSaved(isNew ? `${r.data.displayName} added. They can sign in as ${r.data.username}.` : `${r.data.displayName} updated.`, isNew ? r.data : undefined);
    else if (r.error?.code === 'VALIDATION_FAILED') setErrs(r.error.fields);
  }

  return (
    <FormDialog open title={isNew ? (config.isDemo ? 'Add demo user' : 'Add user') : `Edit ${target.displayName}`} confirmLabel={isNew ? 'Add user' : 'Save changes'} busy={!!w.busy} onCancel={onClose} onConfirm={save}>
      <WriteError error={w.error?.code === 'VALIDATION_FAILED' ? null : w.error} />
      {isNew && <TextField label="Username" required mono value={username} onChange={(e) => setUsername(e.target.value)} error={errs.username} hint="Lowercase, e.g. demo-gate-2" autoComplete="off" />}
      <TextField label="Display name" required value={name} onChange={(e) => setName(e.target.value)} error={errs.displayName} />
      <fieldset>
        <legend className="mb-1.5 text-[15px] font-medium text-ink">Roles<RequiredMark /></legend>
        <div className="grid gap-x-3 sm:grid-cols-2">
          {ALL_ROLES.map((r) => (
            <label key={r} className="flex min-h-10 cursor-pointer items-center gap-2.5 text-[16px] sm:min-h-8">
              <input type="checkbox" className="size-4 accent-ink" checked={roles.includes(r)}
                onChange={(e) => setRoles((x) => (e.target.checked ? [...x, r] : x.filter((y) => y !== r)))} />
              {roleLabel[r]}
            </label>
          ))}
        </div>
        {errs.roles && <p role="alert" className="mt-1 text-[15px] text-problem">{errs.roles}</p>}
        <Note className="mt-2">Whether one person can hold more than one role is pending KPMPL confirmation.</Note>
      </fieldset>
    </FormDialog>
  );
}
