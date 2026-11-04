import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { SafeForm } from '../../components/ui/SafeForm';
import { StepIndicator, StepPanel, SuccessPanel, SummaryList, WizardFooter } from '../../components/ui/Wizard';
import { NumberPlate, TruckCard, actorsFor } from '../../components/truck/TruckCard';
import { cn } from '../../components/ui/cn';
import { api } from '../../api';
import { useAsync } from '../../hooks/useAsync';
import { useWrite } from '../../hooks/useWrite';
import { useAuth } from '../../auth/AuthContext';
import { can } from '../../auth/permissions';
import { docCategoryMeta, packageStatusMeta, packageStatusOwner } from '../../domain/status';
import type { DocumentPackageView, PackageStatus, ReceivingVisit } from '../../domain/types';
import { relativeAge } from '../../lib/format';
import { Card, ListCard, ListToolbar, PageHeader, TableWrap, ViewLink } from '../../components/ui/Layout';
import { StatusLine } from '../../components/ui/StatusTag';
import { Tabs } from '../../components/ui/Tabs';
import { Alert, EmptyState, ErrorState, LoadingState } from '../../components/ui/States';
import { Button, ButtonLink } from '../../components/ui/Button';
import { TextAreaField, TextField } from '../../components/ui/Field';
import { CheckboxField, FormDialog } from '../../components/ui/Dialog';
import { WriteError } from '../../components/ui/WriteError';
import { Timeline } from '../../components/ui/Timeline';
import { GateArrivals } from './GateArrivals';
import { ChecklistNotice, Checklist, CorrectionList, ErpPanel, LinkedVisits, PackageFacts, PackageStatusTag, missingCount } from './shared';

const tabs: { key: string; label: string; states: PackageStatus[] }[] = [
  { key: 'prep', label: 'In preparation', states: ['draft', 'ready_for_gate_check'] },
  // F-28: the Home "Check and send" card opens this tab directly — its own list.
  { key: 'send', label: 'Ready to send', states: ['ready_for_gate_check'] },
  { key: 'fix', label: 'Correction requested', states: ['correction_requested'] },
  { key: 'ho', label: 'With Head Office', states: ['submitted_to_ho', 'under_ho_review', 'resubmitted'] },
  { key: 'done', label: 'Verified', states: ['verified'] },
  // After verification the package moves to Accounts (upgrade 2026-11-03); the Gate sees it read-only here.
  { key: 'accounts', label: 'With Accounts', states: ['with_accounting', 'with_head_accountant', 'accounting_approved', 'bill_posted'] },
];

/** Document packages — Gate list. */
export function PackagesPage() {
  const [params, setParams] = useSearchParams();
  const tab = tabs.find((t) => t.key === params.get('tab')) ?? tabs[0]!;
  const { state, reload } = useAsync(() => api.listPackages('gate'), []);
  const counts = useMemo(() => Object.fromEntries(tabs.map((t) => [t.key, (state.data ?? []).filter((p) => t.states.includes(p.status)).length])), [state.data]);
  const rows = (state.data ?? []).filter((p) => tab.states.includes(p.status));
  return (
    <>
      <PageHeader title="Document Packages" description="One package per supplier invoice, sent to Head Office as PDFs." actions={<ButtonLink to="/documents/new">New package</ButtonLink>} />
      <ListCard>
        <ListToolbar>
          <Tabs label="Package status" active={tab.key} onSelect={(k) => setParams({ tab: k })}
            items={tabs.map((t) => ({ key: t.key, label: t.label, count: state.data ? counts[t.key] : null }))} />
        </ListToolbar>
        {state.status === 'loading' && !state.data && <LoadingState />}
        {state.status === 'error' && <ErrorState error={state.error} onRetry={reload} />}
        {state.data && state.status !== 'error' && (rows.length === 0
          ? <EmptyState title="No packages here." action={tab.key === 'prep' ? <ViewLink to="/documents/new">New package</ViewLink> : undefined} />
          : <PackageTable rows={rows} to={(p) => `/documents/${p.id}`} />)}
      </ListCard>
      <div className="mt-14"><GateArrivals mode="gate" /></div>
    </>
  );
}

export function PackageTable({ rows, to }: { rows: DocumentPackageView[]; to: (p: DocumentPackageView) => string }) {
  return (
    <TableWrap>
      <table className="tbl min-w-[900px]">
        <thead><tr>
          <th scope="col">Package No.</th><th scope="col">Supplier</th><th scope="col">Invoice No.</th><th scope="col">Gate Entry No.</th>
          <th scope="col">Status</th><th scope="col" className="num">Rows open</th><th scope="col">With</th><th scope="col">Updated</th><th scope="col"><span className="sr-only">Action</span></th>
        </tr></thead>
        <tbody>
          {rows.map((p) => {
            const miss = missingCount(p);
            const open = ['draft', 'ready_for_gate_check', 'correction_requested'].includes(p.status);
            return (
              <tr key={p.id}>
                <td className="nowrap"><Link to={to(p)} className="lnk font-mono">{p.packageRef}</Link></td>
                <td>{p.supplierDisplayName}</td>
                <td className="nowrap font-mono text-[15px]">{p.invoiceRef ?? '—'}</td>
                <td className="font-mono text-[15px]">{p.visits.map((v) => v.officialGateEntryRef).join(', ')}</td>
                <td><PackageStatusTag p={p} /></td>
                <td className={`num font-mono ${open && miss > 0 ? 'text-signal' : ''}`}>{open ? miss : '—'}</td>
                <td className="text-ink-soft">{packageStatusOwner(p.status)}</td>
                <td className="nowrap text-[15px] text-muted">{relativeAge(p.updatedAt)}</td>
                <td className="w-0 text-right"><ViewLink to={to(p)} label={`Open ${p.packageRef}`}>Open</ViewLink></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </TableWrap>
  );
}

/** Create a package: choose trucks, invoice No., check and confirm. Same API call. */
export function NewPackagePage() {
  const [qs] = useSearchParams();
  const { user } = useAuth();
  const actors = actorsFor(user);
  const data = useAsync(async () => {
    const [visits, pkgs] = await Promise.all([api.listVisits({ pageSize: 500 }), api.listPackages('gate')]);
    const used = new Set(pkgs.flatMap((p) => p.visitIds));
    return visits.data.filter((v) => !used.has(v.id));
  }, []);
  const [step, setStep] = useState(0);
  const [sel, setSel] = useState<string[]>(() => (qs.get('visit') ? [qs.get('visit')!] : []));
  const [invoice, setInvoice] = useState('');
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [created, setCreated] = useState<DocumentPackageView | null>(null);
  const w = useWrite();
  const visits = data.state.data ?? [];
  const supplier = visits.find((v) => v.id === sel[0])?.supplierDisplayName;
  const chosen = visits.filter((v) => sel.includes(v.id));

  function next() {
    if (step === 0 && !sel.length) { setErrs({ visitIds: 'Choose at least one truck.' }); return; }
    setErrs({});
    setStep((s) => s + 1);
  }
  async function create() {
    if (!sel.length) { setStep(0); setErrs({ visitIds: 'Choose at least one truck.' }); return; }
    // F-15: optional fields are omitted, never sent blank — the invoice can be added later.
    const r = await w.run('create', (k) => api.createPackage({ visitIds: sel, ...(invoice.trim() ? { invoiceRef: invoice.trim() } : {}) }, { idempotencyKey: k }));
    if (r.ok) setCreated(r.data);
    else if (r.error?.code === 'VALIDATION_FAILED') { setErrs(r.error.fields); setStep(r.error.fields.visitIds ? 0 : 1); }
  }

  if (created) return (
    <div className="mx-auto max-w-3xl">
      <SuccessPanel title={`Package ${created.packageRef} created`} next="Attach each document as a PDF, or mark it not needed."
        actions={<>
          <ButtonLink to={`/documents/${created.id}`} size="lg">Attach documents</ButtonLink>
          <ButtonLink to="/home" variant="ghost">Back to Home</ButtonLink>
        </>}>{created.supplierDisplayName} · {created.visits.length} truck(s){created.invoiceRef ? <> · Invoice <span className="font-mono">{created.invoiceRef}</span></> : ''}</SuccessPanel>
    </div>
  );

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="New document package" crumbs={[{ label: 'Home', to: '/home' }, { label: 'Document Packages', to: '/documents' }, { label: 'New' }]}
        description="One package per supplier invoice." />
      <StepIndicator steps={['Trucks', 'Invoice No.', 'Check and confirm']} current={step} />
      <WriteError error={w.error?.code === 'VALIDATION_FAILED' ? null : w.error} className="mb-5" />
      <SafeForm onSubmit={() => (step < 2 ? next() : void create())} noValidate>
        {step === 0 && (
          <StepPanel title="Which trucks does this invoice cover?" hint={supplier ? `Supplier: ${supplier}. Only this supplier's trucks can be added.` : 'Tap each truck. All must be from one supplier.'}>
            {errs.visitIds && <Alert tone="danger">{errs.visitIds}</Alert>}
            {data.state.status === 'loading' && !data.state.data && <LoadingState />}
            {data.state.status === 'error' && <ErrorState error={data.state.error} onRetry={data.reload} />}
            {data.state.data && (visits.length === 0 ? <EmptyState title="All trucks are already in a package." /> : (
              <ul className="flex flex-col gap-3">
                {visits.map((v: ReceivingVisit) => {
                  const disabled = !!supplier && v.supplierDisplayName !== supplier && !sel.includes(v.id);
                  const on = sel.includes(v.id);
                  return (
                    <li key={v.id}>
                      <label className={cn('flex cursor-pointer items-center gap-4 rounded-xl', disabled && 'cursor-not-allowed opacity-50')}>
                        <input type="checkbox" className="size-6 shrink-0 cursor-pointer accent-brand-600 disabled:cursor-not-allowed" disabled={disabled} checked={on}
                          onChange={(e) => { setErrs({}); setSel((x) => (e.target.checked ? [...x, v.id] : x.filter((y) => y !== v.id))); }} />
                        <span className="sr-only">Select {v.officialGateEntryRef}</span>
                        <span className="min-w-0 flex-1"><TruckCard v={v} actors={actors}
                          chip={disabled ? { tone: 'neutral', label: 'Different supplier' } : on ? { tone: 'action', label: 'Chosen' } : v.grnStatus === 'not_recorded' ? { tone: 'waiting', label: 'No GRN No. yet' } : { tone: 'done', label: `GRN ${v.officialGrnRef ?? ''}` }} /></span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            ))}
          </StepPanel>
        )}
        {step === 1 && (
          <StepPanel title="Invoice No." hint="As printed on the supplier invoice. You can add it later.">
            <TextField label="Invoice No." mono value={invoice} maxLength={40} autoFocus onChange={(e) => setInvoice(e.target.value)} error={errs.invoiceRef} />
            {chosen.some((v) => v.grnStatus === 'not_recorded') && <Alert tone="warning">One of these trucks has no GRN No. yet. You can still start the package and add the GRN PDF later.</Alert>}
          </StepPanel>
        )}
        {step === 2 && (
          <StepPanel title="Check and confirm">
            <SummaryList rows={[
              { label: 'Supplier', value: supplier },
              { label: 'Trucks', value: <span className="flex flex-wrap gap-2">{chosen.map((v) => <NumberPlate key={v.id} value={v.vehicleNumber} />)}</span> },
              { label: 'Invoice No.', value: invoice.trim() ? <span className="font-mono">{invoice.trim()}</span> : 'Not entered yet' },
            ]} />
          </StepPanel>
        )}
        <WizardFooter onBack={step > 0 ? () => setStep((s) => s - 1) : undefined} nextSubmits busy={w.busy === 'create'}
          nextLabel={step < 2 ? 'Next' : 'Create package'} extra={step === 0 ? <ButtonLink to="/documents" variant="ghost">Cancel</ButtonLink> : undefined} />
      </SafeForm>
    </div>
  );
}

/** Gate view of one package: checklist, authority check, send / resubmit.
 * Action bar is now a sticky bottom bar (Part B): left = checklist progress +
 * Plant Head approval row (separate, read-only here), right = primary action that
 * stays visible (disabled with a one-line reason when it isn't allowed).
 * "Edit invoice No." is a small pencil next to the invoice number in the header.
 */
export function PackagePage() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const { state, reload, setData } = useAsync(() => api.getPackage(id), [id]);
  const [notice, setNotice] = useState<string | null>(null);
  const w = useWrite();
  const [dlg, setDlg] = useState<'send' | 'back' | 'invoice' | null>(null);
  const [confirmComplete, setConfirmComplete] = useState(false);
  const [text, setText] = useState('');
  const [errs, setErrs] = useState<Record<string, string>>({});
  const crumbs = [{ label: 'Document Packages', to: '/documents' }, { label: 'Package' }];

  if (state.status === 'loading' && !state.data) return <><PageHeader title="Package" crumbs={crumbs} /><LoadingState /></>;
  if (state.status === 'error' && !state.data) return <><PageHeader title="Package" crumbs={crumbs} /><ErrorState error={state.error} onRetry={reload} /></>;
  const p = state.data!;
  const editable = ['draft', 'ready_for_gate_check', 'correction_requested'].includes(p.status) && can(user, 'docs.prepare');
  const miss = missingCount(p);
  const doneCount = p.items.length - miss;
  const isResub = p.status === 'correction_requested';
  const changed = (m: string, upd?: DocumentPackageView) => { setNotice(m); if (upd) setData(upd); else reload(); };
  const opts = (k: string) => ({ idempotencyKey: k, expectedVersion: p.version });

  async function markReady() {
    const r = await w.run('ready', (k) => api.packageAction(p.id, { kind: 'mark_ready' }, opts(k)));
    if (r.ok) changed('Marked ready. The document authority can now check and send it.', r.data);
  }
  function openDlg(k: 'send' | 'back' | 'invoice') { setConfirmComplete(false); setText(k === 'invoice' ? p.invoiceRef ?? '' : ''); setErrs({}); w.setError(null); setDlg(k); }
  async function submitDlg() {
    if (dlg === 'send') {
      const ex: Record<string, string> = {};
      if (!confirmComplete) ex.confirmComplete = 'Confirm you checked the packet.';
      if (isResub && !text.trim()) ex.responseNote = 'Describe what was corrected.';
      setErrs(ex); if (Object.keys(ex).length) return;
      const r = await w.run('send', (k) => api.packageAction(p.id, { kind: 'submit_to_ho', confirmComplete, responseNote: isResub ? text : undefined }, opts(k)));
      if (r.ok) { setDlg(null); changed(isResub ? 'Resubmitted to Head Office.' : 'Sent to Head Office. They can open the PDFs now.', r.data); }
      else if (r.error?.code === 'VALIDATION_FAILED') setErrs(r.error.fields);
    } else if (dlg === 'back') {
      if (!text.trim()) { setErrs({ reason: 'Say what needs changing.' }); return; }
      const r = await w.run('back', (k) => api.packageAction(p.id, { kind: 'back_to_draft', reason: text }, opts(k)));
      if (r.ok) { setDlg(null); changed('Sent back to the Gate for changes.', r.data); }
    } else if (dlg === 'invoice') {
      const r = await w.run('inv', (k) => api.updatePackage(p.id, { invoiceRef: text }, opts(k)));
      if (r.ok) { setDlg(null); changed('Invoice reference updated.', r.data); }
      else if (r.error?.code === 'VALIDATION_FAILED') setErrs(r.error.fields);
    }
  }

  const sendStage = p.status === 'ready_for_gate_check' || isResub;
  const canSend = sendStage && can(user, 'docs.submit');

  return (
    <>
      <PageHeader mono title={p.packageRef} crumbs={crumbs}
        status={<StatusLine items={[<PackageStatusTag key="s" p={p} />, <span key="o" className="text-muted">Next with {packageStatusMeta[p.status].owner}</span>]} />}
        description={<>
          <span className="text-ink-soft">{p.supplierDisplayName}</span>
          <span className="mx-1 text-muted">·</span>
          <span className="inline-flex items-center gap-1.5">
            <span className="font-mono text-ink">{p.invoiceRef ?? 'not entered'}</span>
            {p.invoiceRef && editable && (
              <Button type="button" variant="ghost" size="sm" className="shrink-0 h-8 px-1.5" onClick={() => openDlg('invoice')} title="Edit invoice No.">
                <span className="sr-only">Edit invoice No.</span><span aria-hidden>✎</span>
              </Button>
            )}
          </span>
        </>} />

      <div className="mx-auto min-w-0 max-w-[1216px] flex flex-col pb-24">
        <div className="-mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <p className="text-[16px] font-semibold text-ink">{docCategoryMeta['supplier_invoice'].label} checklist</p>
        </div>

        {(editable || p.status === 'ready_for_gate_check') && (
          <StepIndicator steps={['Attach documents', 'Mark ready', 'Check and send to Head Office']}
            current={p.status === 'ready_for_gate_check' || (isResub && miss === 0) ? 2 : miss === 0 ? 1 : 0} />
        )}

        <div className="flex min-w-0 flex-col gap-12">
          <Card title="Documents" subtitle={<><span className="font-mono">{doneCount}</span> of <span className="font-mono">{p.items.length}</span> done</>}>
            <Checklist p={p} mode="gate" editable={editable} onChanged={changed} />
            {editable && <div className="mt-3"><ChecklistNotice /></div>}
          </Card>
          <div className="grid gap-12 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.7fr)] xl:gap-14">
            <Card title="Package"><PackageFacts p={p} /></Card>
            <Card title="Linked trucks"><LinkedVisits p={p} linkToVisit={can(user, 'receiving.view')} /></Card>
          </div>
          <CorrectionList p={p} />
          <ErpPanel p={p} canConfirm={false} onChanged={changed} />
          <Card title="History"><Timeline events={p.history.slice().reverse()} /></Card>
        </div>

        {/* Sticky bottom action bar (Part B). Left = progress + Plant Head row + secondary actions; right = primary action (disabled with one-line reason when not allowed). */}
        <div className="sticky bottom-0 z-10 mt-8 flex min-h-[78px] flex-wrap items-center justify-between gap-3 border-t border-rule bg-surface/96 px-4 pb-[calc(0.5rem+env(safe-area-inset-bottom))] pt-3 backdrop-blur-sm sm:px-6 lg:px-8">
          {/* Left: progress + Plant Head approval row + secondary actions. */}
          <div className="flex min-w-0 flex-wrap items-center gap-3 text-[16px] text-ink-soft">
            <span className={cn('rounded-full px-3 py-1 text-[15px] font-medium tabular',
              doneCount === p.items.length ? 'bg-done-bg text-done' : 'bg-paper-deep text-ink-soft')}>
              {doneCount} of {p.items.length} rows done{miss > 0 ? <> · <span className="text-signal">{miss} open</span></> : ''}
            </span>
            {p.erp.find((m) => m.type === 'plant_head_grn_approval') && (
              <span className="rounded-full bg-action-bg px-3 py-1 text-[15px] font-medium text-action">
                Plant Head approval: {p.erp.find((m) => m.type === 'plant_head_grn_approval')!.status === 'confirmed' ? 'confirmed' : 'pending'}
              </span>
            )}
            {p.status === 'ready_for_gate_check' && editable && can(user, 'docs.submit') && (
              <Button variant="ghost" onClick={() => openDlg('back')}>Send back to Gate</Button>
            )}
          </div>
          {/* Right: primary action (disabled with one-line reason when not allowed). */}
          <div className="flex flex-col items-end gap-1">
            {/* Draft: mark ready. */}
            {editable && p.status === 'draft' && (
              <>
                <Button disabled={miss > 0} onClick={markReady} loading={w.busy === 'ready'}
                  title={miss > 0 ? 'Close every row before marking ready.' : undefined}>
                  Mark ready for authority check
                </Button>
                {miss > 0 && <p className="text-[13px] text-muted">{miss} row{miss > 1 ? 's' : ''} still need a PDF or a not-applicable mark.</p>}
              </>
            )}
            {/* Send stage: send or resubmit. */}
            {sendStage && (
              <>
                {canSend ? (
                  <Button disabled={miss > 0} onClick={() => openDlg('send')}
                    title={miss > 0 ? 'Attach or mark every open row first.' : undefined}>
                    {isResub ? 'Resubmit to Head Office' : 'Check & send to Head Office'}
                  </Button>
                ) : (
                  <button type="button" disabled className="cursor-not-allowed rounded-lg border border-rule bg-surface px-4 text-[16px] text-muted">
                    {isResub ? 'Resubmit to Head Office' : 'Check & send to Head Office'}
                  </button>
                )}
                {miss > 0 && <p className="text-[13px] text-muted">{miss} row{miss > 1 ? 's' : ''} still need a PDF or a not-applicable mark.</p>}
                {!canSend && miss === 0 && <p className="text-[13px] text-muted">You need permission to send packages.</p>}
              </>
            )}
            {/* Non-gate state: primary action not available. */}
            {!editable && !sendStage && (
              <>
                <button type="button" disabled className="cursor-not-allowed rounded-lg border border-rule bg-surface px-4 text-[16px] text-muted">
                  Check & send to Head Office
                </button>
                <p className="text-[13px] text-muted">{p.status === 'bill_posted' ? 'This package has been posted.' : `This package is with ${packageStatusOwner(p.status)}.`}</p>
              </>
            )}
          </div>
        </div>
      </div>

      {notice && <Alert tone="success" className="mb-8">{notice}</Alert>}
      {isResub && <Alert tone="danger" title="Head Office asked for a correction" className="mb-8">{p.corrections.find((c) => !c.resolvedAt)?.reason} Fix the rows marked HO issue; then the document authority resubmits.</Alert>}
      <WriteError error={dlg ? null : w.error} onReload={reload} className="mb-8" />

      <FormDialog open={!!dlg} busy={!!w.busy} onCancel={() => setDlg(null)} onConfirm={submitDlg}
        title={dlg === 'send' ? (isResub ? 'Resubmit to Head Office?' : 'Send to Head Office?') : dlg === 'back' ? 'Send back to Gate?' : 'Invoice No.'}
        confirmLabel={dlg === 'send' ? (isResub ? 'Resubmit' : 'Send to Head Office') : dlg === 'back' ? 'Send back' : 'Save'}>
        <WriteError error={w.error?.code === 'VALIDATION_FAILED' ? null : w.error} onReload={() => { setDlg(null); reload(); }} />
        {dlg === 'send' && (
          <>
            <p>{p.packageRef} · {p.items.filter((i) => i.state === 'attached').reduce((n, i) => n + i.files.length, 0)} PDF(s) · {p.items.filter((i) => i.state === 'not_applicable').length} row(s) not applicable.</p>
            {isResub && <TextAreaField label="What was corrected" required rows={3} maxLength={500} value={text} onChange={(e) => setText(e.target.value)} error={errs.responseNote} />}
            <CheckboxField checked={confirmComplete} onChange={setConfirmComplete} error={errs.confirmComplete}>I checked this packet and it contains the applicable documents.</CheckboxField>
          </>
        )}
        {dlg === 'back' && <TextAreaField label="What needs changing" required rows={3} maxLength={500} value={text} onChange={(e) => setText(e.target.value)} error={errs.reason} />}
        {dlg === 'invoice' && <TextField label="Invoice No." mono value={text} maxLength={40} onChange={(e) => setText(e.target.value)} error={errs.invoiceRef} />}
      </FormDialog>
    </>
  );
}
