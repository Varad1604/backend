import { DEMO_ACCOUNTS, MOCK_DEMO_PASSWORD } from '../../auth/demoAccounts';
import { roleLabel } from '../../auth/permissions';

/**
 * DEMO ONLY (APP_MODE=demo) — sample role quick sign-in. Never rendered when APP_MODE=production.
 * signsIn=true (mock adapter): "Use" signs straight in with the mock password.
 * signsIn=false (server demo seed): "Use" fills the username; the password is the server's DEMO_PASSWORD.
 */
export default function DemoRolePicker({ disabled, signsIn, onPick }: {
  disabled: boolean;
  signsIn: boolean;
  onPick: (username: string, password?: string) => void;
}) {
  return (
    <section aria-labelledby="demo-accounts">
      <h2 id="demo-accounts" className="kicker mb-3">Demo accounts</h2>
      <table className="tbl">
        <thead><tr><th scope="col">Role</th><th scope="col">Username</th><th scope="col"><span className="sr-only">Sign in</span></th></tr></thead>
        <tbody>
          {DEMO_ACCOUNTS.map((a) => (
            <tr key={a.username}>
              <td className="text-ink">{roleLabel[a.role]}</td>
              <td className="font-mono text-[15px] text-ink-soft">{a.username}</td>
              <td className="w-0 text-right">
                <button type="button" disabled={disabled} onClick={() => onPick(a.username, signsIn ? MOCK_DEMO_PASSWORD : undefined)}
                  aria-label={signsIn ? `Sign in as ${roleLabel[a.role]}` : `Use the ${roleLabel[a.role]} demo username`}
                  className="act min-h-10 text-[15px] disabled:opacity-50 sm:min-h-0">Use</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {signsIn
        ? <p className="mt-4 text-[15px] text-muted">Password for all demo accounts: <span className="font-mono text-ink">{MOCK_DEMO_PASSWORD}</span></p>
        : <p className="mt-4 text-[15px] text-muted">Demo server. Ask the administrator for the demo password.</p>}
    </section>
  );
}
