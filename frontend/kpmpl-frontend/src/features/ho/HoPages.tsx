import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../../api';
import { useAsync } from '../../hooks/useAsync';
import { useWrite } from '../../hooks/useWrite';
import { useAuth } from '../../auth/AuthContext';
import { can } from '../../auth/permissions';
import { DOC_CATEGORIES, ERP_ORDER, docCategoryMeta, erpMilestoneMeta, packageStatusMeta } from '../../domain/status';
import type { DocCategory, DocumentPackageView, PackageStatus } from '../../domain/types';
import { formatDateTime, relativeAge } from '../../lib/format';
import { GateArrivals } from '../documents/GateArrivals';
import { Card, ListCard, ListToolbar, PageHeader, TableWrap, TextButton } from '../../components/ui/Layout';
import { StatusLine } from '../../components/ui/StatusTag';
import { Tabs } from '../../components/ui/Tabs';
import { RequiredMark } from '../../components/ui/Field';
import { Alert, EmptyState, ErrorState, LoadingState, Note } from '../../components/ui/States';
import { Button } from '../../components/ui/Button';
import { Tag } from '../../components/ui/StatusTag';
import { TextAreaField } from '../../components/ui/Field';
import { FormDialog } from '../../components/ui/Dialog';
import { WriteError } from '../../components/ui/WriteError';
import { Timeline } from '../../components/ui/Timeline';
import { AccountingPanel } from '../accounting/AccountingPages';
import { Checklist, CorrectionList, ErpPanel, LinkedVisits, PackageFacts, PackageStatusTag } from '../documents/shared';

const tabs: { key: string; label: string; states: PackageStatus[] }[] = [
  { key: 'new', label: 'New & resubmitted', states: ['submitted_to_ho', 'resubmitted'] },
  { key: 'review', label: 'Under review', states: ['under_ho_review'] },
  { key: 'fix', label: 'Waiting on Gate', states: ['correction_requested'] },
  { key: 'done', label: 'Verified', states: ['verified'] },
  // After verification the package moves to Accounts; HO keeps its DataMan-milestone duties.
  { key: 'accounts', label: 'With Accounts', states: ['with_accounting', 'with_head_accountant', 'accounting_approved', 'bill_posted'] },
];

/** Head Office inbox. */
export function HoInboxPage() {
  const [params, setParams] = useSearchParams();
  const tab = tabs.find((t) => t.key === params.get('tab')) ?? tabs[0]!;
  const { state, reload } = useAsync(() => api.listPackages('ho'), []);
  const counts = useMemo(() => Object.fromEntries(tabs.map((t) => [t.key, (state.data ?? []).filter((p) => t.states.includes(p.status)).length])), [state.data]);
  const rows = (state.data ?? []).filter((p) => tab.states.includes(p.status)).sort((a, b) => (a.submittedAt ?? '').localeCompare(b.submittedAt ?? ''));
  return (
    <>
      <PageHeader title="Head Office Inbox" description="Packages sent by the Gate. Oldest at the top." />
      <ListCard>
        <h2 className="kicker mb-1">Waiting at Head Office</h2>
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
                <th scope="col">Package No.</th><th scope="col">Supplier</th><th scope="col">Invoice No.</th><th scope="col">GRN No.</th>
                <th scope="col">Status</th><th scope="col">Plant Head</th><th scope="col">Sent by</th><th scope="col">Sent</th><th scope="col"><span className="sr-only">Action</span></th>
              </tr></thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id}>
                    <td className="nowrap"><Link to={`/head-office/${p.id}`} className="lnk font-mono">{p.packageRef}</Link></td>
                    <td>{p.supplierDisplayName}</td>
                    <td className="nowrap font-mono text-[15px]">{p.invoiceRef ?? '—'}</td>
                    <td className="font-mono text-[15px]">{p.visits.map((v) => v.officialGrnRef ?? '—').join(', ')}</td>
                    <td><PackageStatusTag p={p} /></td>
                    <td><Tag tone={p.erp[0]?.status === 'confirmed' ? 'success' : 'warning'}>{p.erp[0]?.status === 'confirmed' ? 'Approved' : 'Pending'}</Tag></td>
                    <td className="text-ink-soft">{p.submittedBy ?? '—'}</td>
                    <td className="nowrap text-[15px] text-muted">{p.submittedAt ? relativeAge(p.submittedAt) : '—'}</td>
                    <td className="w-0 text-right"><Link to={`/head-office/${p.id}`} className="act">{tab.key === 'new' ? 'Review' : 'Open'}</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        ))}
      </ListCard>
      <div className="mt-14"><GateArrivals mode="ho" /></div>
    </>
  );
}

/** Document review and milestone tracking for one package. */
export function HoReviewPage() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const { state, reload, setData } = useAsync(() => api.getPackage(id), [id]);
  const [notice, setNotice] = useState<string | null>(null);
  const w = useWrite();
  const [dlg, setDlg] = useState<'correct' | 'verify' | null>(null);
  const [reason, setReason] = useState('');
  const [cats, setCats] = useState<DocCategory[]>([]);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const crumbs = [{ label: 'Head Office Inbox', to: '/head-office' }, { label: 'Package' }];

  if (state.status === 'loading' && !state.data) return <><PageHeader title="Package" crumbs={crumbs} /><LoadingState /></>;
  if (state.status === 'error' && !state.data) return <><PageHeader title="Package" crumbs={crumbs} /><ErrorState error={state.error} onRetry={reload} /></>;
  const p: DocumentPackageView = state.data!;
  const canVerify = can(user, 'ho.review');
  const reviewing = canVerify && p.status === 'under_ho_review';
  const changed = (m: string, upd?: DocumentPackageView) => { setNotice(m); if (upd) setData(upd); else reload(); };
  const opts = (k: string) => ({ idempotencyKey: k, expectedVersion: p.version });
  const attached = p.items.filter((i) => i.state === 'attached');
  const unchecked = attached.filter((i) => i.hoCheck !== 'ok');

  async function startReview() {
    const r = await w.run('start', (k) => api.packageAction(p.id, { kind: 'start_review' }, opts(k)));
    if (r.ok) changed('Review started. Check each document, then verify or ask for a correction.', r.data);
  }
  function openCorrect() {
    setReason(''); setCats(p.items.filter((i) => i.hoCheck === 'issue').map((i) => i.category)); setErrs({}); w.setError(null); setDlg('correct');
  }
  async function confirm() {
    if (dlg === 'correct') {
      const ex: Record<string, string> = {};
      if (!reason.trim()) ex.reason = 'Describe what the Gate must correct.';
      if (!cats.length) ex.categories = 'Choose at least one document.';
      setErrs(ex); if (Object.keys(ex).length) return;
      const r = await w.run('correct', (k) => api.packageAction(p.id, { kind: 'request_correction', reason, categories: cats }, opts(k)));
      if (r.ok) { setDlg(null); changed('Correction requested. The Gate will see it under Document Packages.', r.data); }
      else if (r.error?.code === 'VALIDATION_FAILED') setErrs(r.error.fields);
    } else if (dlg === 'verify') {
      const r = await w.run('verify', (k) => api.packageAction(p.id, { kind: 'verify' }, opts(k)));
      if (r.ok) { setDlg(null); changed('Documents verified. Update the DataMan milestones below as they happen.', r.data); }
    }
  }

  const actions = canVerify && (['submitted_to_ho', 'resubmitted'].includes(p.status) || p.status === 'under_ho_review') ? (
    <>
      {['submitted_to_ho', 'resubmitted'].includes(p.status) && <Button onClick={startReview} loading={w.busy === 'start'}>Start review</Button>}
      {p.status === 'under_ho_review' && (
        <>
          <Button variant="ghost" onClick={openCorrect}>Request correction from Gate</Button>
          <Button disabled={unchecked.length > 0} onClick={() => { w.setError(null); setDlg('verify'); }}>Verify documents</Button>
        </>
      )}
    </>
  ) : undefined;

  return (
    <>
      <PageHeader mono title={p.packageRef} crumbs={[{ label: 'Head Office Inbox', to: '/head-office' }, { label: p.packageRef }]}
        status={<StatusLine items={[<PackageStatusTag key="s" p={p} />, <span key="o" className="text-muted">Next with {packageStatusMeta[p.status].owner}</span>]} />}
        description={<>{p.supplierDisplayName} · Invoice <span className="font-mono text-ink">{p.invoiceRef ?? 'not entered'}</span></>}
        actions={actions} />
      {canVerify && (
        <div className="-mt-4 mb-8 text-[16px] text-ink">
          {p.status === 'under_ho_review' && (unchecked.length > 0
            ? <p>Open each PDF and mark it checked. <span className="font-mono font-medium text-signal">{unchecked.length}</span> still to check before you can verify.</p>
            : <p>All attached documents are checked. Verify, or ask the Gate for a correction.</p>)}
          {p.status === 'correction_requested' && <p>Waiting for the Gate to correct and resubmit.</p>}
          {p.status === 'verified' && <Note>Documents verified. The package now moves to Accounts. Price, GST, TDS or bill-number corrections stay in DataMan with authorised HO staff. Your DataMan milestones below remain active.</Note>}
          {['with_accounting', 'with_head_accountant', 'accounting_approved', 'bill_posted'].includes(p.status)
            && <Note>The accounting chain (Accountant → Head Accountant → Bill Posted) is tracked on its own. Confirm the DataMan milestones below as staff check DataMan.</Note>}
        </div>
      )}
      {notice && <Alert tone="success" className="mb-8">{notice}</Alert>}
      <WriteError error={dlg ? null : w.error} onReload={reload} className="mb-8" />

      <div className="flex min-w-0 flex-col gap-12">
        <Card title="Documents">
          <Checklist p={p} mode="ho" editable={false} reviewing={reviewing} onChanged={changed} />
        </Card>
        <div className="grid gap-12 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.7fr)] xl:gap-14">
          <Card title="Package"><PackageFacts p={p} /></Card>
          <Card title="Linked trucks"><LinkedVisits p={p} linkToVisit={can(user, 'receiving.view')} /></Card>
        </div>
        <AccountingPanel p={p} onChanged={changed} interactive={false} />
        <CorrectionList p={p} />
        <ErpPanel p={p} canConfirm={can(user, 'erp.confirm')} onChanged={changed} />
        <Card title="History"><Timeline events={p.history.slice().reverse()} /></Card>
      </div>

      <FormDialog open={!!dlg} busy={!!w.busy} onCancel={() => setDlg(null)} onConfirm={confirm} wide={dlg === 'correct'}
        title={dlg === 'correct' ? 'Request a correction?' : 'Verify this package?'} confirmLabel={dlg === 'correct' ? 'Send to Gate' : 'Verify documents'}>
        <WriteError error={w.error?.code === 'VALIDATION_FAILED' ? null : w.error} onReload={() => { setDlg(null); reload(); }} />
        {dlg === 'verify' && <p>All {attached.length} attached documents are checked. DataMan milestones are confirmed separately.</p>}
        {dlg === 'correct' && (
          <>
            <fieldset>
              <legend className="mb-1.5 text-[15px] font-medium text-ink">Documents to correct<RequiredMark /></legend>
              <div className="grid gap-x-3 sm:grid-cols-2">
                {DOC_CATEGORIES.map((c) => (
                  <label key={c} className="flex min-h-10 cursor-pointer items-center gap-2.5 text-[16px] sm:min-h-8">
                    <input type="checkbox" className="size-4 accent-ink" checked={cats.includes(c)} onChange={(e) => setCats((x) => (e.target.checked ? [...x, c] : x.filter((y) => y !== c)))} />
                    {docCategoryMeta[c].label}
                  </label>
                ))}
              </div>
              {errs.categories && <p role="alert" className="mt-1 text-[15px] text-problem">{errs.categories}</p>}
            </fieldset>
            <TextAreaField label="What is wrong or missing" required rows={3} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} error={errs.reason} />
            <Note>Sending a document back does not reject the load. The HO return and hold process is pending KPMPL confirmation.</Note>
          </>
        )}
      </FormDialog>
    </>
  );
}

/** ERP milestone tracker — one row per package, three manual milestones. */
export function ErpMilestonesPage() {
  const { state, reload } = useAsync(() => api.listPackages('ho'), []);
  const [filter, setFilter] = useState<'all' | 'approval' | 'voucher' | 'posting' | 'posted'>('all');
  const st = (p: DocumentPackageView, i: number) => p.erp.find((m) => m.type === ERP_ORDER[i])!.status;
  const rows = (state.data ?? []).filter((p) => {
    if (filter === 'approval') return st(p, 0) === 'pending';
    if (filter === 'voucher') return st(p, 0) === 'confirmed' && st(p, 1) === 'pending';
    if (filter === 'posting') return st(p, 1) === 'confirmed' && st(p, 2) === 'pending';
    if (filter === 'posted') return st(p, 2) === 'confirmed';
    return true;
  });
  const filters = [
    { k: 'all', l: 'All' }, { k: 'approval', l: 'Plant Head pending' }, { k: 'voucher', l: 'Voucher pending' }, { k: 'posting', l: 'Posting pending' }, { k: 'posted', l: 'Posted' },
  ] as const;
  return (
    <>
      <PageHeader title="ERP Milestones" description="Entered by Head Office staff after checking DataMan. Not linked to the ERP." />
      <ListCard>
        <ListToolbar>
          <Tabs label="Milestone filter" active={filter} onSelect={setFilter} items={filters.map((f) => ({ key: f.k, label: f.l }))} />
          <TextButton onClick={reload} className="self-start pb-2.5 lg:self-auto">Refresh</TextButton>
        </ListToolbar>
        {state.status === 'loading' && !state.data && <LoadingState />}
        {state.status === 'error' && <ErrorState error={state.error} onRetry={reload} />}
        {state.data && state.status !== 'error' && (rows.length === 0 ? <EmptyState title="No packages match this filter." /> : (
          <TableWrap>
            <table className="tbl tbl-wrap min-w-[860px]">
              <thead><tr>
                <th scope="col">Package No.</th><th scope="col">Status</th><th scope="col">Supplier</th><th scope="col">GRN No.</th>
                {ERP_ORDER.map((t) => <th scope="col" key={t}>{erpMilestoneMeta[t].short}</th>)}
              </tr></thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id}>
                    <td className="nowrap align-top"><Link to={`/head-office/${p.id}`} className="lnk font-mono">{p.packageRef}</Link></td>
                    <td className="align-top"><PackageStatusTag p={p} /></td>
                    <td className="align-top">{p.supplierDisplayName}</td>
                    <td className="align-top font-mono text-[15px]">{p.visits.map((v) => v.officialGrnRef ?? '—').join(', ')}</td>
                    {p.erp.map((m) => (
                      <td key={m.type} className="align-top">
                        <Tag tone={m.status === 'confirmed' ? 'success' : 'warning'}>{m.status === 'confirmed' ? 'Confirmed' : 'Pending'}</Tag>
                        {m.status === 'confirmed' && <div className="mt-1 text-[16px] text-muted">{m.dataManRef && <span className="font-mono font-medium text-ink">{m.dataManRef}</span>}{m.dataManRef && <br />}{m.confirmedBy} · <span className="font-mono text-[15px]">{m.confirmedAt ? formatDateTime(m.confirmedAt) : ''}</span></div>}
                      </td>
                    ))}
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
