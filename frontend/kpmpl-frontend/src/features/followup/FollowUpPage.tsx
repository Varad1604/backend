import { useState, type ReactNode } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { CircleCheck, DoorOpen, Lock, Receipt, Scale } from 'lucide-react';
import { api } from '../../api';
import { useAsync } from '../../hooks/useAsync';
import { useWrite } from '../../hooks/useWrite';
import { deriveNet, formatDecimal, parseDecimalInput } from '../../domain/decimal';
import type { QcInspection, ReceivingVisit } from '../../domain/types';
import { formatDateTime, fromIstInput, toIstInput } from '../../lib/format';
import { Button, ButtonLink } from '../../components/ui/Button';
import { DecimalUnitField, TextAreaField, TextField } from '../../components/ui/Field';
import { Card, PageHeader } from '../../components/ui/Layout';
import { Alert, ErrorState, LoadingState, Note } from '../../components/ui/States';
import { VisitStatusTags } from '../../components/ui/StatusTag';
import { StatusChip, type UiTone } from '../../components/ui/StatusChip';
import { Timeline } from '../../components/ui/Timeline';
import { WriteError } from '../../components/ui/WriteError';
import { CheckboxField } from '../../components/ui/Dialog';
import { UnsavedChangesGuard } from '../../components/ui/UnsavedChangesGuard';
import { StepIndicator, StepPanel, SuccessPanel, SummaryList, WizardFooter } from '../../components/ui/Wizard';
import { SafeForm } from '../../components/ui/SafeForm';
import { NumberPlate } from '../../components/truck/TruckCard';
import { cn } from '../../components/ui/cn';
import { LatestQcSummary, NoDeductionNotice } from '../qc/QcReadings';

type Job = 'tare' | 'exit' | 'grn';
const isJob = (x: string | null): x is Job => x === 'tare' || x === 'exit' || x === 'grn';
const kg = (v: string) => `${formatDecimal(v)} kg`;

function qcDone(v: ReceivingVisit, inspection: QcInspection | null) {
  return !!inspection?.revisions.some((r) => r.state === 'submitted') && !['pending', 'in_progress'].includes(v.qcStatus);
}

/** Gate follow-up: the three separate gate jobs (empty weight, exit, GRN No.), each a guided stepper. */
export function FollowUpPage() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const job = isJob(params.get('do')) ? (params.get('do') as Job) : null;
  const { state, reload, setData } = useAsync(async () => {
    const [visit, inspection, timeline] = await Promise.all([api.getVisit(id), api.getQcInspection(id), api.getTimeline(id)]);
    return { visit, inspection, timeline };
  }, [id]);
  const crumbs = [{ label: 'Home', to: '/home' }, { label: 'Tare / Exit / GRN', to: '/gate/follow-up' }, { label: 'Truck' }];
  if (state.status === 'loading' && !state.data) return <><PageHeader title="Gate follow-up" crumbs={crumbs} /><LoadingState /></>;
  if (state.status === 'error' && !state.data) return <><PageHeader title="Gate follow-up" crumbs={crumbs} /><ErrorState error={state.error} onRetry={reload} /></>;
  const { visit: v, inspection, timeline } = state.data!;
  const go = (j: Job | null) => setParams((p) => { if (j) p.set('do', j); else p.delete('do'); return p; });
  const saved = (visit: ReceivingVisit) => { setData({ ...state.data!, visit }); reload(); };
  const props = { v, inspection, onSaved: saved, onReload: reload, go };

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader mono title={v.officialGateEntryRef} crumbs={[{ label: 'Home', to: '/home' }, { label: 'Tare / Exit / GRN', to: '/gate/follow-up' }, { label: v.officialGateEntryRef }]}
        description={<span className="flex flex-wrap items-center gap-3"><NumberPlate value={v.vehicleNumber} /><span>{v.supplierDisplayName} · {v.materialDisplayName}</span></span>}
        status={<VisitStatusTags qc={v.qcStatus} exit={v.exitStatus} grn={v.grnStatus} />}
        actions={<ButtonLink to={`/receiving/${v.id}`} variant="ghost">Full entry</ButtonLink>} />

      {job === 'tare' && <TareWizard key="tare" {...props} />}
      {job === 'exit' && <ExitWizard key="exit" {...props} />}
      {job === 'grn' && <GrnWizard key="grn" {...props} />}
      {!job && (
        <div className="flex flex-col gap-10">
          <JobTiles v={v} inspection={inspection} go={go} />
          <Card title="QC result">
            <LatestQcSummary inspection={inspection} />
            <div className="mt-4"><NoDeductionNotice /></div>
          </Card>
          <Card title="History"><Timeline events={timeline} /></Card>
        </div>
      )}
    </div>
  );
}

type JobProps = { v: ReceivingVisit; inspection: QcInspection | null; onSaved: (v: ReceivingVisit) => void; onReload: () => void; go: (j: Job | null) => void };

function JobTiles({ v, inspection, go }: { v: ReceivingVisit; inspection: QcInspection | null; go: (j: Job) => void }) {
  const net = deriveNet(v.grossWeight, v.tareWeight);
  const exitReady = !!v.tareWeight && qcDone(v, inspection);
  const tiles: { job: Job; icon: typeof Scale; title: string; tone: UiTone; status: string; detail: ReactNode; button?: string; disabled?: boolean }[] = [
    { job: 'tare', icon: Scale, title: 'Weigh empty truck',
      tone: v.tareWeight ? 'done' : v.exitStatus === 'exited' ? 'neutral' : 'action', status: v.tareWeight ? 'Done' : 'To do',
      detail: v.tareWeight ? <>Empty <span className="font-mono">{kg(v.tareWeight.value)}</span>{net && <> · Net <span className="font-mono font-semibold">{kg(net)}</span></>}</> : <>Loaded <span className="font-mono">{v.grossWeight ? kg(v.grossWeight.value) : '—'}</span></>,
      button: v.exitStatus === 'exited' ? undefined : v.tareWeight ? 'Correct empty weight' : 'Weigh empty truck' },
    { job: 'exit', icon: DoorOpen, title: 'Let truck out',
      tone: v.exitStatus === 'exited' ? 'done' : exitReady ? 'action' : 'waiting', status: v.exitStatus === 'exited' ? 'Done' : exitReady ? 'To do' : 'Not yet',
      detail: v.exitStatus === 'exited' ? <>Out at <span className="font-mono">{formatDateTime(v.physicalExitAt)}</span></> : exitReady ? 'Empty weight and QC are done.' : !v.tareWeight ? 'Weigh the empty truck first.' : 'Waiting for QC readings.',
      button: v.exitStatus === 'exited' ? undefined : 'Let truck out', disabled: !exitReady },
    { job: 'grn', icon: Receipt, title: 'Enter GRN No.',
      tone: v.grnStatus === 'reference_recorded' ? 'done' : v.tareWeight ? 'action' : 'waiting', status: v.grnStatus === 'reference_recorded' ? 'Done' : v.tareWeight ? 'To do' : 'Not yet',
      detail: v.officialGrnRef ? <>GRN No. <span className="font-mono">{v.officialGrnRef}</span></> : v.tareWeight ? 'Copy it from DataMan.' : 'DataMan makes the GRN after the empty weight.',
      button: v.grnStatus === 'reference_recorded' ? 'Correct GRN No.' : 'Enter GRN No.', disabled: !v.tareWeight },
  ];
  return (
    <ol className="grid gap-4 md:grid-cols-3">
      {tiles.map((t, i) => {
        const Icon = t.icon;
        return (
          <li key={t.job} className={cn('flex flex-col gap-3 rounded-2xl border border-rule border-t-[6px] bg-surface p-5 shadow-sm',
            t.tone === 'done' ? 'border-t-done' : t.tone === 'action' ? 'border-t-action' : t.tone === 'waiting' ? 'border-t-wait' : 'border-t-field')}>
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-[15px] font-semibold text-muted"><Icon aria-hidden size={22} strokeWidth={1.75} />{i + 1}</span>
              <StatusChip tone={t.tone} size="sm">{t.status}</StatusChip>
            </div>
            <h2 className="text-[19px] font-semibold text-ink">{t.title}</h2>
            <p className="flex-1 text-[16px] text-ink-soft">{t.detail}</p>
            {t.button ? <Button variant={t.tone === 'action' ? 'primary' : 'secondary'} disabled={t.disabled} onClick={() => go(t.job)}>{t.button}</Button>
              : <p className="flex items-center gap-2 text-[15px] text-muted"><Lock aria-hidden size={16} />Locked after exit</p>}
          </li>
        );
      })}
    </ol>
  );
}

function TareWizard({ v, onSaved, onReload, go, inspection }: JobProps) {
  const [isCorrection] = useState(() => !!v.tareWeight);
  const [step, setStep] = useState(0);
  const [raw, setRaw] = useState('');
  const [reason, setReason] = useState('');
  const [errs, setErrs] = useState<{ value?: string; correctionReason?: string }>({});
  const [done, setDone] = useState<string | null>(null);
  const w = useWrite();
  const parsed = parseDecimalInput(raw, { maxDecimals: 3, label: 'empty truck weight' });
  const net = parsed.ok ? deriveNet(v.grossWeight, { value: parsed.value, unit: 'kg' }) : null;

  if (v.exitStatus === 'exited' && !done) return <Alert tone="warning" title="Locked">The truck has left, so the weights are locked.</Alert>;
  if (done) {
    const exitReady = qcDone(v, inspection);
    return (
      <SuccessPanel title={isCorrection ? 'Empty weight corrected' : 'Empty weight saved'}
        next={exitReady ? 'Let the truck out when the mill checks are done.' : 'Wait for QC to finish, then let the truck out.'}
        actions={<>
          {exitReady && <Button size="lg" onClick={() => go('exit')}>Let truck out</Button>}
          <ButtonLink to="/home" variant="secondary" size="lg">Back to Home</ButtonLink>
          <Button variant="ghost" onClick={() => go(null)}>Back to this truck</Button>
        </>}>{done}</SuccessPanel>
    );
  }

  function next() {
    const ex: typeof errs = {};
    if (!parsed.ok) ex.value = parsed.message;
    else if (!net) ex.value = `Empty weight must be less than the loaded weight (${v.grossWeight ? kg(v.grossWeight.value) : '—'}).`;
    if (isCorrection && !reason.trim()) ex.correctionReason = 'Enter the reason for changing the empty weight.';
    setErrs(ex);
    if (!Object.keys(ex).length) setStep(1);
  }
  async function save() {
    if (!parsed.ok) { setStep(0); return; }
    const value = parsed.value;
    const res = await w.run('tare', (k) => api.recordTare(v.id, { value, correctionReason: isCorrection ? reason : undefined }, { idempotencyKey: k, expectedVersion: v.version }));
    if (res.ok) { setDone(`Empty weight ${kg(value)}${net ? ` · net weight ${kg(net)}` : ''}.`); onSaved(res.data); }
    else if (res.error?.code === 'VALIDATION_FAILED') { setErrs(res.error.fields); setStep(0); }
  }

  return (
    <>
      <StepIndicator steps={['Empty weight', 'Check and confirm']} current={step} />
      <SafeForm onSubmit={() => (step === 0 ? next() : void save())} noValidate>
        <WriteError error={w.error?.code === 'VALIDATION_FAILED' ? null : w.error} onReload={onReload} className="mb-5" />
        {step === 0 ? (
          <StepPanel title={isCorrection ? 'Correct the empty weight' : 'Weigh the empty truck'} hint="Read the weighbridge with the unloaded truck on it.">
            <p className="text-[17px]">Loaded weight: <span className="font-mono font-semibold">{v.grossWeight ? kg(v.grossWeight.value) : '—'}</span>{isCorrection && v.tareWeight && <> · current empty weight <span className="font-mono">{kg(v.tareWeight.value)}</span></>}</p>
            <DecimalUnitField label="Empty truck weight (kg)" required unit="kg" placeholder="0.000" value={raw} autoFocus className="h-14 text-[22px]"
              onChange={(e) => { setRaw(e.target.value); setErrs((x) => ({ ...x, value: undefined })); }} error={errs.value} hint="Up to 3 decimals." />
            {isCorrection && <TextAreaField label="Reason for correction" required rows={2} maxLength={500} value={reason}
              onChange={(e) => { setReason(e.target.value); setErrs((x) => ({ ...x, correctionReason: undefined })); }} error={errs.correctionReason} hint="The old weight stays in the history." />}
          </StepPanel>
        ) : (
          <StepPanel title="Check and confirm">
            <SummaryList rows={[
              { label: 'Truck', value: <NumberPlate value={v.vehicleNumber} /> },
              { label: 'Loaded weight', value: v.grossWeight && <span className="font-mono">{kg(v.grossWeight.value)}</span> },
              { label: 'Empty weight', value: parsed.ok && <span className="font-mono">{kg(parsed.value)}</span> },
              { label: 'Net weight (paper)', value: net && <span className="font-mono text-[20px] font-semibold">{kg(net)}</span> },
              ...(isCorrection ? [{ label: 'Reason for correction', value: reason }] : []),
            ]} />
          </StepPanel>
        )}
        <WizardFooter onBack={step === 0 ? () => go(null) : () => setStep(0)} backLabel={step === 0 ? 'Cancel' : 'Back'} nextSubmits busy={w.busy === 'tare'}
          nextLabel={step === 0 ? 'Next' : isCorrection ? 'Save corrected weight' : 'Save empty weight'} />
      </SafeForm>
      <UnsavedChangesGuard when={!!raw && !w.busy && !done} message="The empty weight has not been saved." />
    </>
  );
}

function ExitWizard({ v, inspection, onSaved, onReload, go }: JobProps) {
  const [step, setStep] = useState(0);
  const [at, setAt] = useState(toIstInput());
  const [remarks, setRemarks] = useState('');
  const [checks, setChecks] = useState(false);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);
  const w = useWrite();
  const prereq = [{ ok: !!v.tareWeight, label: 'Empty truck weighed' }, { ok: qcDone(v, inspection), label: 'QC readings submitted' }];
  const ready = prereq.every((p) => p.ok);
  const caution = v.qcStatus === 'returned' ? 'QC asked for a re-check.' : v.qcStatus === 'rejected' ? 'QC rejected this load.' : null;

  if (done) return (
    <SuccessPanel title="Truck has left the mill" next="Enter the GRN No. when DataMan shows it."
      actions={<>
        {v.grnStatus === 'not_recorded' && <Button size="lg" onClick={() => go('grn')}>Enter GRN No.</Button>}
        <ButtonLink to="/home" variant="secondary" size="lg">Back to Home</ButtonLink>
      </>}>Exit recorded at <span className="font-mono">{at.replace('T', ' ')}</span> IST.</SuccessPanel>
  );
  if (v.exitStatus === 'exited') return <Alert tone="success" title="Already out">Out at {formatDateTime(v.physicalExitAt)}.</Alert>;

  function next() {
    const ex: Record<string, string> = {};
    if (step === 0 && !checks) ex.millChecksConfirmed = 'Tick this once the mill exit checks are done.';
    if (step === 1 && !fromIstInput(at)) ex.physicalExitAt = 'Enter the exit date and time.';
    setErrs(ex);
    if (!Object.keys(ex).length) setStep((s) => s + 1);
  }
  async function save() {
    const iso = fromIstInput(at);
    if (!iso || !checks) { setStep(0); return; }
    const res = await w.run('exit', (k) => api.recordExit(v.id, { physicalExitAt: iso, remarks, millChecksConfirmed: checks }, { idempotencyKey: k, expectedVersion: v.version }));
    if (res.ok) { setDone(true); onSaved(res.data); }
    else if (res.error?.code === 'VALIDATION_FAILED') { setErrs(res.error.fields); setStep(res.error.fields.millChecksConfirmed ? 0 : 1); }
  }

  return (
    <>
      <StepIndicator steps={['Checks', 'Exit time', 'Check and confirm']} current={step} />
      <SafeForm onSubmit={() => (step < 2 ? next() : void save())} noValidate>
        <WriteError error={w.error?.code === 'VALIDATION_FAILED' ? null : w.error} onReload={onReload} className="mb-5" />
        {step === 0 && (
          <StepPanel title="Is the truck ready to leave?">
            <ul className="divide-y divide-rule rounded-xl border border-rule">
              {prereq.map((p) => (
                <li key={p.label} className="flex min-h-14 items-center justify-between gap-3 px-4">
                  <span className="text-[17px]">{p.label}</span>
                  <StatusChip tone={p.ok ? 'done' : 'waiting'} size="sm">{p.ok ? 'Done' : 'Not yet'}</StatusChip>
                </li>
              ))}
            </ul>
            {caution && <Alert tone="warning">{caution} Follow the mill procedure before letting the truck leave.</Alert>}
            {ready
              ? <CheckboxField checked={checks} onChange={(c) => { setChecks(c); setErrs({}); }} error={errs.millChecksConfirmed}>Mill exit checks for this truck are done.</CheckboxField>
              : <Alert tone="info">Finish the items above first.</Alert>}
            <Note>Exit conditions are pending KPMPL confirmation. QC readings alone do not release a truck.</Note>
          </StepPanel>
        )}
        {step === 1 && (
          <StepPanel title="When did it leave?" hint="It is filled in with the time now. Change it only if needed.">
            <TextField label="Exit time (IST)" required type="datetime-local" value={at} max={toIstInput()} onChange={(e) => setAt(e.target.value)} error={errs.physicalExitAt} />
            <TextAreaField label="Remarks" rows={2} maxLength={500} value={remarks} onChange={(e) => setRemarks(e.target.value)} error={errs.remarks} />
          </StepPanel>
        )}
        {step === 2 && (
          <StepPanel title="Check and confirm">
            <SummaryList rows={[
              { label: 'Truck', value: <NumberPlate value={v.vehicleNumber} /> },
              { label: 'Gate Entry No.', value: <span className="font-mono">{v.officialGateEntryRef}</span> },
              { label: 'Exit time', value: <span className="font-mono">{at.replace('T', ' ')} IST</span> },
              { label: 'Mill exit checks', value: checks ? 'Done' : 'Not ticked' },
              { label: 'Remarks', value: remarks },
            ]} />
            <Note>The GRN No. is entered separately.</Note>
          </StepPanel>
        )}
        <WizardFooter onBack={step === 0 ? () => go(null) : () => setStep((s) => s - 1)} backLabel={step === 0 ? 'Cancel' : 'Back'} nextSubmits busy={w.busy === 'exit'}
          nextDisabled={step === 0 && !ready} nextLabel={step < 2 ? 'Next' : 'Record exit'} />
      </SafeForm>
    </>
  );
}

function GrnWizard({ v, onSaved, onReload, go }: JobProps) {
  const [isCorrection] = useState(() => v.grnStatus === 'reference_recorded');
  const [step, setStep] = useState(0);
  const [ref, setRef] = useState('');
  const [verified, setVerified] = useState(false);
  const [reason, setReason] = useState('');
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [done, setDone] = useState<string | null>(null);
  const w = useWrite();

  if (done) return (
    <SuccessPanel title="GRN No. saved" next={v.exitStatus === 'exited' ? 'This truck is complete at the gate. The papers go into a document package.' : 'Let the truck out when it is ready.'}
      actions={<>
        {v.exitStatus !== 'exited' && <Button size="lg" onClick={() => go('exit')}>Let truck out</Button>}
        <ButtonLink to="/home" variant="secondary" size="lg">Back to Home</ButtonLink>
      </>}><p className="flex items-center gap-2"><CircleCheck aria-hidden size={20} className="text-done" />GRN No. <span className="font-mono">{done}</span></p></SuccessPanel>
  );
  if (!v.tareWeight) return <Alert tone="info" title="Not yet">Weigh the empty truck first. DataMan makes the GRN after that.</Alert>;

  function next() {
    const ex: Record<string, string> = {};
    if (!ref.trim()) ex.officialGrnRef = 'Enter the GRN No. from DataMan.';
    if (!verified) ex.verifiedInDataManByStaff = 'Confirm you checked this GRN in DataMan.';
    if (isCorrection && !reason.trim()) ex.correctionReason = 'Enter the reason for changing the GRN No.';
    setErrs(ex);
    if (!Object.keys(ex).length) setStep(1);
  }
  async function save() {
    const value = ref.trim();
    // Stored exactly as typed (opaque string, leading zeros and suffixes kept).
    const res = await w.run('grn', (k) => api.recordGrn(v.id, { officialGrnRef: value, verifiedInDataManByStaff: verified, correctionReason: isCorrection ? reason : undefined }, { idempotencyKey: k, expectedVersion: v.version }));
    if (res.ok) { setDone(value); onSaved(res.data); }
    else if (res.error?.code === 'VALIDATION_FAILED') { setErrs(res.error.fields); setStep(0); }
  }

  return (
    <>
      <StepIndicator steps={['GRN No.', 'Check and confirm']} current={step} />
      <SafeForm onSubmit={() => (step === 0 ? next() : void save())} noValidate>
        <WriteError error={w.error?.code === 'VALIDATION_FAILED' ? null : w.error} onReload={onReload} className="mb-5" />
        {step === 0 ? (
          <StepPanel title={isCorrection ? 'Correct the GRN No.' : 'Enter the GRN No.'} hint="Exactly as DataMan shows it. Can be entered before or after exit.">
            {isCorrection && <p className="text-[17px]">Current GRN No.: <span className="font-mono">{v.officialGrnRef}</span></p>}
            <TextField label={isCorrection ? 'Corrected GRN No.' : 'GRN No.'} required mono value={ref} maxLength={40} autoFocus autoComplete="off" className="h-14 text-[20px]"
              onChange={(e) => { setRef(e.target.value); setErrs((x) => ({ ...x, officialGrnRef: '' })); }} error={errs.officialGrnRef || undefined} />
            {isCorrection && <TextAreaField label="Reason for correction" required rows={2} value={reason} onChange={(e) => setReason(e.target.value)} error={errs.correctionReason} />}
            <CheckboxField checked={verified} onChange={setVerified} error={errs.verifiedInDataManByStaff}>I checked this GRN in DataMan myself.</CheckboxField>
          </StepPanel>
        ) : (
          <StepPanel title="Check and confirm">
            <SummaryList rows={[
              { label: 'Truck', value: <NumberPlate value={v.vehicleNumber} /> },
              { label: 'GRN No.', value: <span className="font-mono text-[20px]">{ref.trim()}</span> },
              { label: 'Checked in DataMan', value: verified ? 'Yes, by me' : 'No' },
              ...(isCorrection ? [{ label: 'Reason for correction', value: reason }] : []),
            ]} />
          </StepPanel>
        )}
        <WizardFooter onBack={step === 0 ? () => go(null) : () => setStep(0)} backLabel={step === 0 ? 'Cancel' : 'Back'} nextSubmits busy={w.busy === 'grn'}
          nextLabel={step === 0 ? 'Next' : isCorrection ? 'Save corrected GRN' : 'Save GRN'} />
      </SafeForm>
      <UnsavedChangesGuard when={!!ref && !w.busy && !done} message="The GRN No. has not been saved." />
    </>
  );
}
