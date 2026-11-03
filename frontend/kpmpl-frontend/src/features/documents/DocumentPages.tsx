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
import { docCategoryMeta, packageStatusMeta } from '../../domain/status';
import type { DocumentPackageView, PackageStatus, ReceivingVisit } from '../../domain/types';
import { relativeAge } from '../../lib/format';
import { Card, ListCard, ListToolbar, PageHeader, TableWrap, ViewLink } from '../../components/ui/Layout';
import { StatusLine } from '../../components/ui/StatusTag';
import { Tabs } from '../../components/ui/Tabs';
import { Alert, EmptyState, ErrorState, LoadingState, Note } from '../../components/ui/States';
import { Button, ButtonLink } from '../../components/ui/Button';
import { TextAreaField, TextField } from '../../components/ui/Field';
import { CheckboxField, FormDialog } from '../../components/ui/Dialog';
import { WriteError } from '../../components/ui/WriteError';
import { Timeline } from '../../components/ui/Timeline';
import { GateArrivals } from './GateArrivals';
import { ChecklistNotice, Checklist, CorrectionList, ErpPanel, LinkedVisits, PackageFacts, PackageStatusTag, missingCount } from './shared';

const tabs: { key: string; label: string; states: PackageStatus[] }[] = [
  { key: 'prep', label: 'In preparation', states: ['draft', 'ready_for_gate_check'] },
  { key: 'fix', label: 'Correction requested', states: ['correction_requested'] },
  { key: 'ho', label: 'With Head Office', states: ['submitted_to_ho', 'under_ho_review', 'resubmitted'] },
  { key: 'done', label: 'Verified', states: ['verified'] },
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
                <td className="text-ink-soft">{packageStatusMeta[p.status].owner}</td>
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
    const r = await w.run('create', (k) => api.createPackage({ visitIds: sel, invoiceRef: invoice }, { idempotencyKey: k }));
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

/** Gate view of one package: checklist, authority check, send / resubmit. */
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
  const actions = editable || p.status === 'ready_for_gate_check' ? (
    <>
      {editable && <Button variant="ghost" onClick={() => openDlg('invoice')}>Edit invoice No.</Button>}
      {p.status === 'draft' && <Button onClick={markReady} loading={w.busy === 'ready'} disabled={miss > 0}>Mark ready for authority check</Button>}
      {sendStage && can(user, 'docs.submit') && (
        <>
          {p.status === 'ready_for_gate_check' && <Button variant="ghost" onClick={() => openDlg('back')}>Send back to Gate</Button>}
          <Button disabled={miss > 0} onClick={() => openDlg('send')}>{isResub ? 'Resubmit to Head Office' : 'Check & send to Head Office'}</Button>
        </>
      )}
    </>
  ) : undefined;
  const openRows = p.items.filter((i) => i.state === 'missing');

  return (
    <>
      <PageHeader mono title={p.packageRef} crumbs={[{ label: 'Document Packages', to: '/documents' }, { label: p.packageRef }]}
        status={<StatusLine items={[<PackageStatusTag key="s" p={p} />, <span key="o" className="text-muted">Next with {packageStatusMeta[p.status].owner}</span>]} />}
        description={<>{p.supplierDisplayName} · Invoice <span className="font-mono text-ink">{p.invoiceRef ?? 'not entered'}</span></>}
        actions={actions} />
      {(editable || p.status === 'ready_for_gate_check') && (
        <StepIndicator steps={['Attach documents', 'Mark ready', 'Check and send to Head Office']}
          current={p.status === 'ready_for_gate_check' || (isResub && miss === 0) ? 2 : miss === 0 ? 1 : 0} />
      )}
      <div className="mb-8 flex flex-col gap-1.5">
        {p.status === 'draft' && editable && (miss > 0
          ? <p className="text-[16px] text-ink"><span className="font-mono font-medium text-signal">{miss}</span> {miss > 1 ? 'rows' : 'row'} still open: {openRows.map((i) => docCategoryMeta[i.category].label).join(', ')}. Attach a PDF or mark each one not applicable.</p>
          : <p className="text-[16px] text-ink">Every row is done. Mark it ready so the document authority can check and send it.</p>)}
        {sendStage && !can(user, 'docs.submit') && <p className="text-[16px] text-ink">{isResub ? 'Once the rows are fixed, the document authority resubmits.' : 'Waiting for the document authority to check and send.'}</p>}
        {(editable || p.status === 'ready_for_gate_check') && <Note>Sending does not wait for Plant Head or final QC approval.</Note>}
      </div>
      {notice && <Alert tone="success" className="mb-8">{notice}</Alert>}
      {isResub && <Alert tone="danger" title="Head Office asked for a correction" className="mb-8">{p.corrections.find((c) => !c.resolvedAt)?.reason} Fix the rows marked HO issue; then the document authority resubmits.</Alert>}
      <WriteError error={dlg ? null : w.error} onReload={reload} className="mb-8" />

      <div className="flex min-w-0 flex-col gap-12">
        <Card title="Documents" subtitle={<><span className="font-mono">{p.items.length - miss}</span> of <span className="font-mono">{p.items.length}</span> done</>}>
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
