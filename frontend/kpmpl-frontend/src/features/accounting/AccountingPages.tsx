import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../../api';
import { useAsync } from '../../hooks/useAsync';
import { useWrite } from '../../hooks/useWrite';
import { useAuth } from '../../auth/AuthContext';
import { can } from '../../auth/permissions';
import { accountingStageMeta, packageStatusMeta } from '../../domain/status';
import { toUiTone } from '../../components/ui/StatusChip';
import type { AccountingChecks, AccountingField, DocumentPackageView, PackageStatus } from '../../domain/types';
import { formatDateTime, relativeAge } from '../../lib/format';
import { Card, ListCard, ListToolbar, PageHeader, TableWrap, TextButton } from '../../components/ui/Layout';
import { StatusLine, Tag } from '../../components/ui/StatusTag';
import { StatusChip } from '../../components/ui/StatusChip';
import { Tabs } from '../../components/ui/Tabs';
import { Note, EmptyState, ErrorState, LoadingState, Alert } from '../../components/ui/States';
import { Button } from '../../components/ui/Button';
import { TextAreaField, TextField } from '../../components/ui/Field';
import { FormDialog } from '../../components/ui/Dialog';
import { WriteError } from '../../components/ui/WriteError';
import { Timeline } from '../../components/ui/Timeline';
import { Checklist, ErpPanel, LinkedVisits, PackageFacts, PackageStatusTag } from '../documents/shared';

/**
 * Accounting workflow (upgrade 2026-11-03): HO → Accountant → Head Accountant → Bill Posted.
 * Internal accounting state only — the DataMan ERP milestones stay a separate HO track.
 */

const tabs: { key: string; label: string; states: PackageStatus[] }[] = [
  { key: 'new', label: 'From Head Office', states: ['verified'] },
  { key: 'accountant', label: 'With Accountant', states: ['with_accounting'] },
  { key: 'head', label: 'With Head Accountant', states: ['with_head_accountant'] },
  { key: 'approved', label: 'Approved, to post', states: ['accounting_approved'] },
  { key: 'posted', label: 'Posted', states: ['bill_posted'] },
];

/** Accounting queue: packages from HO verification onward. */
export function AccountingQueuePage() {
  const [params, setParams] = useSearchParams();
  const tab = tabs.find((t) => t.key === params.get('tab')) ?? tabs[0]!;
  const { state, reload } = useAsync(() => api.listPackages('accounting'), []);
  const counts = useMemo(() => Object.fromEntries(tabs.map((t) => [t.key, (state.data ?? []).filter((p) => t.states.includes(p.status)).length])), [state.data]);
  const headAccountantCount = useMemo(() => (state.data ?? []).filter((p) => p.status === 'with_head_accountant' || p.status === 'accounting_approved').length, [state.data]);
  const rows = (state.data ?? []).filter((p) => tab.states.includes(p.status))
    .sort((a, b) => (a.submittedAt ?? a.updatedAt).localeCompare(b.submittedAt ?? b.updatedAt));
  return (
    <>
      <PageHeader title="Accounting Queue" description="Verified document packages, from Head Office to the posted bill."
        actions={headAccountantCount > 0 ? (            <StatusChip tone={toUiTone['info']} size="sm">
            Head Accountant {headAccountantCount}
          </StatusChip>
        ) : undefined} />
      <ListCard>
        <h2 className="kicker mb-1">Accounting pipeline</h2>
        <ListToolbar>
          <Tabs label="Package status" active={tab.key} onSelect={(k) => setParams({ tab: k })}
            items={tabs.map((t) => ({ key: t.key, label: t.label, count: state.data ? counts[t.key] : null }))} />
          <TextButton onClick={reload} className="self-start pb-2.5 lg:self-auto">Refresh</TextButton>
        </ListToolbar>
        {state.status === 'loading' && !state.data && <LoadingState />}
        {state.status === 'error' && <ErrorState error={state.error} onRetry={reload} />}
        {state.data && state.status !== 'error' && (rows.length === 0 ? <EmptyState title="No packages here." /> : (
          <TableWrap>
            <table className="tbl min-w-[900px]">
              <thead><tr>
                <th scope="col">Package No.</th><th scope="col">Supplier</th><th scope="col">Invoice No.</th><th scope="col">Status</th>
                <th scope="col">Accounting ref.</th><th scope="col">Stage</th><th scope="col">Updated</th><th scope="col"><span className="sr-only">Action</span></th>
              </tr></thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id}>
                    <td className="nowrap"><Link to={`/accounting/${p.id}`} className="lnk font-mono">{p.packageRef}</Link></td>
                    <td>{p.supplierDisplayName}</td>
                    <td className="nowrap font-mono text-[15px]">{p.invoiceRef ?? '—'}</td>
                    <td><PackageStatusTag p={p} /></td>
                    <td className="nowrap font-mono text-[15px]">{p.accounting?.accountingRef ?? '—'}</td>
                    <td>{p.accounting && <Tag tone={accountingStageMeta[p.accounting.stage].tone}>{accountingStageMeta[p.accounting.stage].label}</Tag>}</td>
                    <td className="nowrap text-[15px] text-muted">{relativeAge(p.updatedAt)}</td>
                    <td className="w-0 text-right"><Link to={`/accounting/${p.id}`} className="act">{tab.key === 'new' ? 'Start' : 'Open'}</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        ))}
      </ListCard>
    </>
  );
}

/** One field row of the accounting card, with its authorized correction action. */
function AccountingFieldRow({ label, value, mono, field, editable, onCorrect }: {
  label: string; value: string | null; mono?: boolean; field: AccountingField; editable: boolean;
  onCorrect: (field: AccountingField, current: string | null) => void;
}) {
  return (
    <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-rule py-2 last:border-0">
      <div className="min-w-0">
        <p className="kicker">{label}</p>
        <p className={mono ? 'font-mono text-[16px] font-medium text-ink' : 'text-[16px] text-ink'}>{value ?? '—'}</p>
      </div>
      {editable && (
        <button type="button" className="act shrink-0" onClick={() => onCorrect(field, value)}>Correct…</button>
      )}
    </div>
  );
}

/** The accounting card: stage, authorized fields, corrections audit. Shared with the HO view (readOnly). */
export function AccountingPanel({ p, onChanged, interactive }: {
  p: DocumentPackageView; onChanged: (msg: string, updated?: DocumentPackageView) => void; interactive: boolean;
}) {
  const { user } = useAuth();
  const w = useWrite();
  const acc = p.accounting;
  const isHead = can(user, 'accounting.approve');
  const canStart = interactive && can(user, 'accounting.review') && p.status === 'verified';
  const canWork = interactive && can(user, 'accounting.review') && p.status === 'with_accounting';
  const canHead = interactive && isHead && p.status === 'with_head_accountant';
  const canPost = interactive && can(user, 'accounting.post') && p.status === 'accounting_approved';
  const canCorrect = interactive && can(user, 'accounting.review') && p.status !== 'bill_posted' && !!acc
    && (p.status === 'with_accounting' || isHead);
  const canCorrectHeadNote = canCorrect && isHead;

  const [dlg, setDlg] = useState<'post' | 'approve' | 'return' | 'handover' | null>(null);
  const [correcting, setCorrecting] = useState<{ field: AccountingField; current: string | null } | null>(null);
  const [billRef, setBillRef] = useState('');
  const [note, setNote] = useState('');
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [errs, setErrs] = useState<Record<string, string>>({});
  const opts = (k: string) => ({ idempotencyKey: k, expectedVersion: p.version });
  const existingChecks = p.accountingChecks?.[0];
  const makeDefaultChecks = (): AccountingChecks => ({
    checks: [
      { type: 'bill_passed', status: 'pending', note: null, checkedBy: null, checkedAt: null },
      { type: 'gst_checked', status: 'pending', note: null, checkedBy: null, checkedAt: null },
      { type: 'tds_checked', status: 'pending', note: null, checkedBy: null, checkedAt: null },
    ],
  });
  const syncChecks = (ec?: typeof existingChecks): AccountingChecks => {
    if (!ec?.checks) return makeDefaultChecks();
    const map = new Map(ec.checks.map((c) => [c.type, c]));
    return {
      checks: [
        map.get('bill_passed') ?? { type: 'bill_passed', status: 'pending', note: null, checkedBy: null, checkedAt: null },
        map.get('gst_checked') ?? { type: 'gst_checked', status: 'pending', note: null, checkedBy: null, checkedAt: null },
        map.get('tds_checked') ?? { type: 'tds_checked', status: 'pending', note: null, checkedBy: null, checkedAt: null },
      ],
    };
  };
  const [checks, setChecks] = useState<AccountingChecks>(() => syncChecks(existingChecks));
  const [recordingChecks, setRecordingChecks] = useState(false);
  const checksChanged = (next: DocumentPackageView) => { setChecks(syncChecks(next.accountingChecks?.[0])); onChanged('Accounting checks recorded.', next); };
  const getStatus = (type: 'bill_passed' | 'gst_checked' | 'tds_checked') => checks.checks.find((c) => c.type === type)?.status ?? 'pending';
  const allOk = checks.checks.every((c) => c.status === 'ok');
  async function recordChecks(key: string) {
    if (!canWork) return;
    setRecordingChecks(true);
    const r = await w.run(key, (k) => api.recordAccountingChecks(p.id, checks, { idempotencyKey: k }));
    setRecordingChecks(false);
    if (r.ok) { checksChanged(r.data); return r.data; }
    if (r.error?.code === 'VALIDATION_FAILED') setErrs(r.error.fields);
    return null;
  }

  function openCorrect(field: AccountingField, current: string | null) {
    setCorrecting({ field, current }); setValue(''); setReason(''); setErrs({}); w.setError(null);
  }
  function openDialog(kind: 'post' | 'approve' | 'return' | 'handover') {
    setBillRef(''); setNote(''); setReason(''); setErrs({}); w.setError(null); setDlg(kind);
  }
  async function run(action: Parameters<typeof api.accountingAction>[1], key: string) {
    const r = await w.run(key, (k) => api.accountingAction(p.id, action, opts(k)));
    if (r.ok) { setDlg(null); setCorrecting(null); return r.data; }
    if (r.error?.code === 'VALIDATION_FAILED') setErrs(r.error.fields);
    return null;
  }
  async function confirmDialog() {
    if (dlg === 'post') {
      if (!billRef.trim()) { setErrs({ billRef: 'Enter the bill reference exactly as it appears.' }); return; }
      const next = await run({ kind: 'post_bill', billRef, ...(note.trim() ? { note } : {}) }, 'post');
      if (next) onChanged(`Bill ${billRef.trim()} posted. This is the internal accounting status — DataMan milestones stay with Head Office.`, next);
    } else if (dlg === 'approve') {
      const next = await run({ kind: 'approve_accounting', ...(note.trim() ? { headAccountantNote: note } : {}) }, 'approve');
      if (next) onChanged('Accounting approved. You can now post the bill.', next);
    } else if (dlg === 'return') {
      if (!reason.trim()) { setErrs({ reason: 'Tell the Accountant what to check.' }); return; }
      const next = await run({ kind: 'return_to_accountant', reason }, 'return');
      if (next) onChanged('Returned to the Accountant with your reason.', next);
    } else if (dlg === 'handover') {
      const next = await run({ kind: 'submit_to_head_accountant', confirmComplete: true, ...(note.trim() ? { accountantNote: note } : {}) }, 'handover');
      if (next) onChanged('Handed over to the Head Accountant.', next);
    }
  }
  async function confirmCorrection() {
    if (!correcting) return;
    if (!reason.trim()) { setErrs({ reason: 'A reason is required for every correction.' }); return; }
    const next = await run({ kind: 'correct_accounting', field: correcting.field, value, reason }, 'correct');
    if (next) onChanged('Correction recorded with its reason in the history below.', next);
  }

  const stageTag = acc && <Tag tone={accountingStageMeta[acc.stage].tone}>{accountingStageMeta[acc.stage].label}</Tag>;

  return (
    <Card title="Accounting" actions={stageTag}>
      <WriteError error={w.error} onReload={() => onChanged('')} className="mb-6" />
      {!acc ? (
        <>
          <p className="text-[16px] text-ink">Head Office has verified the documents. Accounts can start the accounting review.</p>
          {canStart && (
            <div className="mt-4">
              <Button onClick={async () => { const next = await run({ kind: 'start_accounting' }, 'start'); if (next) onChanged('Accounting started. This package is now with the Accountant.', next); }} loading={w.busy === 'start'}>
                Start accounting
              </Button>
            </div>
          )}
          {!interactive && <Note>Sent to Accounts after Head Office verification.</Note>}
        </>
      ) : (
        <>
          {/* Stage guidance — one sentence per stage, for the role actually holding the ball. */}
          {p.status === 'with_accounting' && (
            <p className="mb-6 text-[16px] text-ink">
              {canWork ? 'Check the papers below, enter the accounting reference, then hand over to the Head Accountant.'
                : `With the Accountant since ${formatDateTime(acc.startedAt)} (${acc.startedBy}).`}
            </p>
          )}
          {p.status === 'with_head_accountant' && (
            <p className="mb-6 text-[16px] text-ink">
              {canHead ? 'Approve the accounting, or return it to the Accountant with a reason.'
                : `Waiting for the Head Accountant (since ${acc.submittedAt ? formatDateTime(acc.submittedAt) : '—'}).`}
            </p>
          )}
          {p.status === 'accounting_approved' && (
            <p className="mb-6 text-[16px] text-ink">
              {canPost ? 'Approved. Post the bill to finish the accounting chain.' : 'Approved by the Head Accountant. Waiting for posting.'}
            </p>
          )}
          {p.status === 'bill_posted' && (
            <Note>Bill posted — the accounting chain is complete. The DataMan milestones below stay a separate Head Office track (internal bill posting ≠ external ERP confirmation).</Note>
          )}

          <div className="mb-6">
            <AccountingFieldRow label="Accounting reference (as typed)" value={acc.accountingRef} mono field="accountingRef"
              editable={!!canCorrect && p.status !== 'verified'} onCorrect={openCorrect} />
            <AccountingFieldRow label="Accountant note" value={acc.accountantNote} field="accountantNote"
              editable={!!canCorrect && p.status !== 'verified'} onCorrect={openCorrect} />
            <AccountingFieldRow label="Head Accountant note" value={acc.headAccountantNote} field="headAccountantNote"
              editable={!!canCorrectHeadNote && p.status !== 'verified'} onCorrect={openCorrect} />
          </div>
          {/* Accountant review checks — recorded once the package is with the Accountant. */}
          {canWork && acc && (
            <div className="mb-6 flex flex-wrap gap-4">
              <label className="inline-flex items-center gap-2.5 cursor-pointer select-none">
                <input type="checkbox" checked={getStatus('bill_passed') === 'ok'} onChange={(e) => setChecks((c) => ({ checks: c.checks.map((ch) => ch.type === 'bill_passed' ? { ...ch, status: e.target.checked ? 'ok' : 'pending' } : ch) }))}
                  className="size-4 rounded border-field text-action focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-1 disabled:opacity-50" />
                <span className="text-[15px] text-ink">Supplier bill checked (passed)</span>
              </label>
              <label className="inline-flex items-center gap-2.5 cursor-pointer select-none">
                <input type="checkbox" checked={getStatus('gst_checked') === 'ok'} onChange={(e) => setChecks((c) => ({ checks: c.checks.map((ch) => ch.type === 'gst_checked' ? { ...ch, status: e.target.checked ? 'ok' : 'pending' } : ch) }))}
                  className="size-4 rounded border-field text-action focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-1 disabled:opacity-50" />
                <span className="text-[15px] text-ink">GST checked</span>
              </label>
              <label className="inline-flex items-center gap-2.5 cursor-pointer select-none">
                <input type="checkbox" checked={getStatus('tds_checked') === 'ok'} onChange={(e) => setChecks((c) => ({ checks: c.checks.map((ch) => ch.type === 'tds_checked' ? { ...ch, status: e.target.checked ? 'ok' : 'pending' } : ch) }))}
                  className="size-4 rounded border-field text-action focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-1 disabled:opacity-50" />
                <span className="text-[15px] text-ink">TDS checked</span>
              </label>
            </div>
          )}
          {canCorrect && p.status === 'verified' && <Note>Start accounting before entering the reference.</Note>}

          {/* Stage actions — sticky bottom bar (Part B). */}
          {(canWork || canHead || canPost) && (
            <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-end gap-3 border-t border-rule bg-surface/95 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur-sm">
              {canWork && (existingChecks?.checks?.length || checks.checks.some((c) => c.status === 'ok' || c.status === 'issue')) && (
                <Button onClick={() => { const k = 'chk-' + Math.random().toString(36).slice(2, 8); void recordChecks(k); }} loading={recordingChecks}>
                  Record checks
                </Button>
              )}
              {canWork && <Button onClick={() => openDialog('handover')} loading={w.busy === 'handover'} disabled={!allOk}>
                Send to Head Accountant
              </Button>}
              {canHead && <Button variant="ghost" onClick={() => openDialog('return')} loading={w.busy === 'return'}>Return to Accountant</Button>}
              {canHead && <Button onClick={() => openDialog('approve')} loading={w.busy === 'approve'}>Approve accounting</Button>}
              {canPost && <Button onClick={() => openDialog('post')} loading={w.busy === 'post'}>Post bill…</Button>}
            </div>
          )}

          {acc.corrections.length > 0 && (
            <div className="mt-8">
              <h3 className="kicker mb-2">Corrections (authorized, with reason)</h3>
              <TableWrap>
                <table className="tbl min-w-[640px]">
                  <thead><tr>
                    <th scope="col">Field</th><th scope="col">Was</th><th scope="col">Now</th><th scope="col">Reason</th><th scope="col">By</th><th scope="col">When</th>
                  </tr></thead>
                  <tbody>
                    {acc.corrections.slice().reverse().map((c) => (
                      <tr key={c.id}>
                        <td>{c.field === 'accountingRef' ? 'Accounting reference' : c.field === 'accountantNote' ? 'Accountant note' : 'Head Accountant note'}</td>
                        <td className="font-mono text-[15px]">{c.oldValue ?? '—'}</td>
                        <td className="font-mono text-[15px] font-medium">{c.newValue ?? '—'}</td>
                        <td className="text-[15px]">{c.reason}</td>
                        <td className="text-ink-soft">{c.correctedBy}</td>
                        <td className="nowrap text-[15px] text-muted">{formatDateTime(c.correctedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            </div>
          )}
        </>
      )}

      <FormDialog open={!!dlg} busy={!!w.busy} onCancel={() => setDlg(null)} onConfirm={confirmDialog}
        title={dlg === 'post' ? 'Post this bill?' : dlg === 'approve' ? 'Approve this accounting?' : dlg === 'return' ? 'Return to the Accountant?' : 'Hand over to the Head Accountant?'}
        confirmLabel={dlg === 'post' ? 'Post bill' : dlg === 'approve' ? 'Approve' : dlg === 'return' ? 'Return' : 'Hand over'}>
        <WriteError error={w.error?.code === 'VALIDATION_FAILED' ? null : w.error} onReload={() => { setDlg(null); onChanged(''); }} />
        {dlg === 'post' && (
          <>
            <p>All documents are checked and the accounting is approved. Posting is final: a posted bill cannot be posted again or corrected here.</p>
            <TextField label="Bill reference" required mono maxLength={40} value={billRef} onChange={(e) => setBillRef(e.target.value)}
              error={errs.billRef} hint="Typed exactly as it appears — leading zeros are kept." />
            <TextAreaField label="Note (optional)" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} error={errs.note} />
            <Note>“Bill Posted” is the internal accounting status. The DataMan milestones (Plant Head approval, voucher, posting) are confirmed by Head Office separately.</Note>
          </>
        )}
        {dlg === 'approve' && (
          <>
            <p>The Accountant handed this package over. Approving records your approval; posting the bill is a separate final step.</p>
            <TextAreaField label="Note (optional)" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} error={errs.headAccountantNote} />
          </>
        )}
        {dlg === 'return' && (
          <>
            <p>The package goes back to the Accountant. Your reason is recorded in the history.</p>
            <TextAreaField label="What should the Accountant check?" required rows={3} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} error={errs.reason} />
          </>
        )}
        {dlg === 'handover' && (
          <>
            <p>You confirm the accounting entries are complete. The Head Accountant then approves and posts the bill.</p>
            <TextAreaField label="Note (optional)" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} error={errs.accountantNote} />
          </>
        )}
      </FormDialog>

      <FormDialog open={!!correcting} busy={!!w.busy} onCancel={() => setCorrecting(null)} onConfirm={confirmCorrection} title="Correct with reason"
        confirmLabel="Record correction">
        <WriteError error={w.error?.code === 'VALIDATION_FAILED' ? null : w.error} onReload={() => { setCorrecting(null); onChanged(''); }} />
        <p>Current value: <span className="font-mono font-medium text-ink">{correcting?.current ?? '—'}</span></p>
        <TextField label={correcting?.field === 'accountingRef' ? 'New accounting reference' : correcting?.field === 'accountantNote' ? 'New accountant note' : 'New Head Accountant note'}
          required mono={correcting?.field === 'accountingRef'} maxLength={correcting?.field === 'accountingRef' ? 40 : 1000}
          value={value} onChange={(e) => setValue(e.target.value)} error={errs.value} />
        <TextAreaField label="Reason (kept in the audit history)" required rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} error={errs.reason} />
        <Note>Every correction keeps the old value, the new value, the reason, who and when. Nothing is overwritten silently.</Note>
      </FormDialog>
    </Card>
  );
}

/** One package under accounting. Read-only outside the accounting stage actions. */
export function AccountingPackagePage() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const { state, reload, setData } = useAsync(() => api.getPackage(id), [id]);
  const [notice, setNotice] = useState<string | null>(null);
  const changed = (m: string, upd?: DocumentPackageView) => { setNotice(m); if (upd) setData(upd); else reload(); };
  const crumbs = [{ label: 'Accounting Queue', to: '/accounting' }, { label: 'Package' }];

  if (state.status === 'loading' && !state.data) return <><PageHeader title="Package" crumbs={crumbs} /><LoadingState /></>;
  if (state.status === 'error' && !state.data) return <><PageHeader title="Package" crumbs={crumbs} /><ErrorState error={state.error} onRetry={reload} /></>;
  const p: DocumentPackageView = state.data!;
  const interactive = can(user, 'accounting.inbox');

  return (
    <>
      <PageHeader mono title={p.packageRef} crumbs={crumbs}
        status={<StatusLine items={[<PackageStatusTag key="s" p={p} />, <span key="o" className="text-muted">Next with {packageStatusMeta[p.status].owner}</span>]} />}
        description={<>{p.supplierDisplayName} · Invoice <span className="font-mono text-ink">{p.invoiceRef ?? 'not entered'}</span></>} />
      {notice && <Alert tone="success" className="mb-8">{notice}</Alert>}

      <div className="mx-auto min-w-0 max-w-[1216px] flex flex-col pb-24 gap-12">
        <AccountingPanel p={p} onChanged={changed} interactive={interactive} />
        <Card title="Documents">
          <Checklist p={p} mode="ho" editable={false} reviewing={false} onChanged={changed} />
        </Card>
        <div className="grid gap-12 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.7fr)] xl:gap-14">
          <Card title="Package"><PackageFacts p={p} /></Card>
          <Card title="Linked trucks"><LinkedVisits p={p} linkToVisit={can(user, 'receiving.view')} /></Card>
        </div>
        <ErpPanel p={p} canConfirm={can(user, 'erp.confirm')} onChanged={changed} />
        <Card title="History"><Timeline events={p.history.slice().reverse()} /></Card>
      </div>
    </>
  );
}
