import { useRef, useState, type FormEvent } from 'react';
import { SafeForm } from '../../components/ui/SafeForm';
import { useParams } from 'react-router-dom';
import { UnsavedChangesGuard } from '../../components/ui/UnsavedChangesGuard';
import { api, describeError, toApiError, type ApiError } from '../../api';
import { useAsync } from '../../hooks/useAsync';
import { parseDecimalInput } from '../../domain/decimal';
import { formatDecimal } from '../../domain/decimal';
import type { Measurement, QcDecisionOutcome, QcInspection, ReceivingVisit } from '../../domain/types';
import { newIdempotencyKey } from '../../lib/format';
import { Button, ButtonLink } from '../../components/ui/Button';
import { DecimalUnitField, TextAreaField } from '../../components/ui/Field';
import { Card, PageHeader } from '../../components/ui/Layout';
import { Alert, ErrorState, LoadingState, Note } from '../../components/ui/States';
import { QcTag } from '../../components/ui/StatusTag';
import { StepIndicator, StepPanel, SuccessPanel, SummaryList, WizardFooter } from '../../components/ui/Wizard';
import { NumberPlate } from '../../components/truck/TruckCard';
import { NoDeductionNotice, QcHistory, decisionOutcomeLabel } from './QcReadings';
import { QcDecisionCard } from './QcDecision';
import { useAuth } from '../../auth/AuthContext';
import { can } from '../../auth/permissions';

/** QC inspection form, then (D-03) the QC Operator's final decision on the same screen. */
export function QcInspectionPage() {
  const { visitId = '' } = useParams();
  // Lives above the form so the confirmation survives the reload/remount after saving.
  const [notice, setNotice] = useState<Notice>(null);
  const { state, reload } = useAsync(async () => {
    const [visit, inspection] = await Promise.all([api.getVisit(visitId), api.getQcInspection(visitId)]);
    return { visit, inspection };
  }, [visitId]);

  const crumbs = [{ label: 'QC Queue', to: '/qc' }, { label: 'Inspection' }];
  if (state.status === 'loading' && !state.data) return <><PageHeader title="QC Inspection" crumbs={crumbs} /><LoadingState label="Loading inspection…" /></>;
  if (state.status === 'error') return <><PageHeader title="QC Inspection" crumbs={crumbs} /><ErrorState error={state.error} onRetry={reload} /></>;
  const { visit, inspection } = state.data!;
  return <InspectionForm key={`${visit.id}-${visit.version}`} visit={visit} inspection={inspection} onSaved={reload} notice={notice} setNotice={setNotice} />;
}

type Notice = 'draft' | 'submitted' | `decided:${QcDecisionOutcome}` | null;
interface FormVals { moisture: string; impurity: string; remarks: string; revisionReason: string }

function InspectionForm({ visit, inspection, onSaved, notice, setNotice }: {
  visit: ReceivingVisit; inspection: QcInspection | null; onSaved: () => void; notice: Notice; setNotice: (n: Notice) => void;
}) {
  const { user } = useAuth();
  const editable = ['pending', 'in_progress', 'returned'].includes(visit.qcStatus);
  const awaitingDecision = visit.qcStatus === 'submitted' && can(user, 'qc.decide');
  const decidedOutcome = notice?.startsWith('decided:') ? notice.slice('decided:'.length) as QcDecisionOutcome : null;
  const lastRev = inspection?.revisions.at(-1);
  const draft = lastRev?.state === 'draft' ? lastRev : null;
  const isResubmission = visit.qcStatus === 'returned' || !!inspection?.revisions.some((r) => r.state === 'submitted');
  const valueOf = (code: string) => draft?.measurements.find((m) => m.code === code)?.value ?? '';

  const initial: FormVals = { moisture: valueOf('moisture'), impurity: valueOf('impurity'), remarks: draft?.remarks ?? '', revisionReason: draft?.revisionReason ?? '' };
  const [vals, setVals] = useState<FormVals>(initial);
  const [errors, setErrors] = useState<Partial<Record<keyof FormVals, string>>>({});
  const [busy, setBusy] = useState<'draft' | 'submit' | null>(null);
  const [serverError, setServerError] = useState<ApiError | null>(null);
  const idem = useRef(newIdempotencyKey());
  const alertRef = useRef<HTMLDivElement>(null);

  const dirty = JSON.stringify(vals) !== JSON.stringify(initial);

  const set = (k: keyof FormVals) => (e: { target: { value: string } }) => {
    setVals((v) => ({ ...v, [k]: e.target.value }));
    setErrors((x) => ({ ...x, [k]: undefined }));
    setNotice(null);
  };

  function collect(intent: 'draft' | 'submit'): Measurement[] | null {
    const e: Partial<Record<keyof FormVals, string>> = {};
    const out: Measurement[] = [];
    for (const code of ['moisture', 'impurity'] as const) {
      const raw = vals[code];
      if (!raw.trim()) {
        if (intent === 'submit') e[code] = `Enter the ${code} reading before submitting.`;
        continue;
      }
      const r = parseDecimalInput(raw, { maxDecimals: 2, label: `${code} reading`, max: 100 });
      if (!r.ok) e[code] = r.message; else out.push({ code, value: r.value, unit: 'percent' });
    }
    if (intent === 'submit' && isResubmission && !vals.revisionReason.trim()) e.revisionReason = 'Explain what changed in this revision.';
    if (intent === 'draft' && out.length === 0 && !vals.remarks.trim() && !Object.keys(e).length) e.moisture = 'Enter at least one reading or a remark to save a draft.';
    setErrors(e);
    if (Object.keys(e).length) { requestAnimationFrame(() => alertRef.current?.focus()); return null; }
    return out;
  }

  async function send(intent: 'draft' | 'submit') {
    if (busy) return;
    const measurements = collect(intent);
    if (!measurements) return;
    setBusy(intent);
    setServerError(null);
    try {
      await api.submitQc(visit.id, { measurements, remarks: vals.remarks, revisionReason: isResubmission ? vals.revisionReason : undefined, intent },
        { idempotencyKey: idem.current, expectedVersion: visit.version });
      idem.current = newIdempotencyKey();
      setNotice(intent === 'submit' ? 'submitted' : 'draft');
      onSaved();
    } catch (err) {
      const e = toApiError(err);
      setServerError(e);
      if (e.code === 'VALIDATION_FAILED') setErrors(e.fields);
      requestAnimationFrame(() => alertRef.current?.focus());
    } finally {
      setBusy(null);
    }
  }

  const [step, setStep] = useState(0);
  const revNo = (inspection?.revisions.filter((r) => r.state === 'submitted').length ?? 0) + 1;
  const STEPS = ['Readings', 'Remarks', 'Check and confirm'];

  /** Check only the current step before moving on (Back keeps everything). */
  function next() {
    const e: Partial<Record<keyof FormVals, string>> = {};
    if (step === 0) {
      for (const code of ['moisture', 'impurity'] as const) {
        const r = parseDecimalInput(vals[code], { maxDecimals: 2, label: `${code} reading`, max: 100 });
        if (!r.ok) e[code] = r.message;
      }
    }
    if (step === 1 && isResubmission && !vals.revisionReason.trim()) e.revisionReason = 'Explain what changed in this revision.';
    setErrors(e);
    if (!Object.keys(e).length) setStep((x) => x + 1);
  }
  const onSubmit = (ev?: FormEvent) => {
    ev?.preventDefault();
    if (step < 2) { next(); return; }
    if (collect('submit')) void send('submit'); else setStep(0);
  };

  const d = serverError ? describeError(serverError) : null;
  const decidedLabel = decidedOutcome ? decisionOutcomeLabel[decidedOutcome] : '';
  const decidedNext: Record<QcDecisionOutcome, string> = {
    accepted: 'The Gate weighs the empty truck and lets it out.',
    accepted_with_deduction: 'The Gate weighs the empty truck. Head Office sees the deduction reason.',
    returned: 'Take a second sample and enter the corrected readings.',
    rejected: 'The Gate follows the mill procedure for rejected loads.',
  };

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title={visit.officialGateEntryRef} mono
        crumbs={[{ label: 'Home', to: '/home' }, { label: 'QC Queue', to: '/qc' }, { label: visit.officialGateEntryRef }]}
        status={<QcTag s={visit.qcStatus} />}
        description={<span className="flex flex-wrap items-center gap-3"><NumberPlate value={visit.vehicleNumber} /><span>{visit.supplierDisplayName} · {visit.materialDisplayName} · <span className="font-mono">{visit.grossWeight ? formatDecimal(visit.grossWeight.value) : '—'} kg</span></span></span>}
      />

      <div className="flex flex-col gap-10">
        <div ref={alertRef} tabIndex={-1} className="flex flex-col gap-2 outline-none empty:hidden">
          {serverError && d && (
            <Alert tone="danger" title={d.title}>
              <p>{serverError.code === 'VALIDATION_FAILED' ? 'Please correct the marked fields.' : d.body}</p>
              {serverError.code === 'NETWORK_UNAVAILABLE' && <p className="mt-1">Nothing was saved. Your readings are still on screen. Please try again.</p>}
              {serverError.code === 'VERSION_CONFLICT' && <Button variant="secondary" size="sm" className="mt-2" onClick={onSaved}>Reload latest</Button>}
            </Alert>
          )}
        </div>

        {decidedOutcome ? (
          <SuccessPanel title={`Decision saved: ${decidedLabel}`} next={decidedNext[decidedOutcome]}
            actions={<>
              {decidedOutcome === 'returned' && editable && <Button size="lg" onClick={() => setNotice(null)}>Enter corrected readings</Button>}
              <ButtonLink to="/qc" variant={decidedOutcome === 'returned' ? 'secondary' : 'primary'} size="lg">Next truck in the queue</ButtonLink>
              <ButtonLink to="/home" variant="ghost">Back to Home</ButtonLink>
            </>}>The Gate and Head Office can see the decision on the entry.</SuccessPanel>
        ) : notice === 'submitted' && awaitingDecision ? (
          <SuccessPanel title="Readings submitted to Gate" next="Make the QC decision for this truck."
            actions={<>
              <Button size="lg" onClick={() => setNotice(null)}>Make the QC decision now</Button>
              <ButtonLink to="/qc" variant="ghost">Back to queue</ButtonLink>
            </>}>The readings are locked and the Gate can see them.</SuccessPanel>
        ) : editable ? (
          <div>
            <StepIndicator steps={STEPS} current={step} />
            {notice === 'draft' && <Alert tone="success" title="Draft saved" className="mb-5">The Gate will not see these readings until you submit.</Alert>}
            <SafeForm onSubmit={onSubmit} noValidate>
              {step === 0 && (
                <StepPanel title={isResubmission ? `Corrected readings — revision ${revNo}` : 'Sample readings'} hint="Up to 2 decimals.">
                  <div className="grid gap-5 sm:grid-cols-2">
                    <DecimalUnitField label="Moisture (%)" required unit="%" placeholder="0.00" value={vals.moisture} onChange={set('moisture')} error={errors.moisture}
                      autoFocus className="h-14 text-[22px]" />
                    <DecimalUnitField label="Impurity (%)" required unit="%" placeholder="0.00" value={vals.impurity} onChange={set('impurity')} error={errors.impurity}
                      className="h-14 text-[22px]" />
                  </div>
                  <Note>The field list and test method are pending KPMPL confirmation.</Note>
                </StepPanel>
              )}
              {step === 1 && (
                <StepPanel title="Anything to note?" hint="Wet bales, plastic, mixed grades, anything the Gate should know.">
                  <TextAreaField label="Remarks" rows={3} maxLength={1000} value={vals.remarks} onChange={set('remarks')} error={errors.remarks} autoFocus={!isResubmission} />
                  {isResubmission && <TextAreaField label="Reason for revision" required rows={2} maxLength={500} value={vals.revisionReason} onChange={set('revisionReason')}
                    error={errors.revisionReason} hint="The earlier version stays in history." autoFocus />}
                </StepPanel>
              )}
              {step === 2 && (
                <StepPanel title="Check and confirm" hint="Once submitted, the readings are locked and the Gate can see them. You then make the QC decision.">
                  <SummaryList rows={[
                    { label: 'Truck', value: <NumberPlate value={visit.vehicleNumber} /> },
                    { label: 'Moisture', value: <span className="font-mono text-[20px]">{vals.moisture} %</span> },
                    { label: 'Impurity', value: <span className="font-mono text-[20px]">{vals.impurity} %</span> },
                    { label: 'Remarks', value: vals.remarks },
                    ...(isResubmission ? [{ label: 'Reason for revision', value: vals.revisionReason }] : []),
                  ]} />
                  <NoDeductionNotice />
                </StepPanel>
              )}
              <WizardFooter onBack={step > 0 ? () => setStep((x) => x - 1) : undefined} nextSubmits busy={busy === 'submit'}
                nextLabel={step < 2 ? 'Next' : 'Submit to Gate'}
                extra={<Button variant="ghost" loading={busy === 'draft'} disabled={!!busy} onClick={() => send('draft')}>{busy === 'draft' ? 'Saving…' : 'Save draft'}</Button>} />
            </SafeForm>
          </div>
        ) : awaitingDecision ? (
          <QcDecisionCard visit={visit} onDecided={(outcome) => { setNotice(`decided:${outcome}`); onSaved(); }} onReload={onSaved} />
        ) : (
          <Card title={visit.qcStatus === 'submitted' ? 'Inspection submitted' : 'QC decision recorded'}>
            <p className="text-[17px] text-ink">
              {visit.qcStatus === 'submitted'
                ? 'Submitted readings are locked until the QC decision is recorded.'
                : <>Decision: <QcTag s={visit.qcStatus} />. The readings and decision are locked and kept in history.</>}
            </p>
            <div className="mt-3"><NoDeductionNotice /></div>
            <div className="mt-4"><ButtonLink to="/qc" variant="secondary">Back to queue</ButtonLink></div>
          </Card>
        )}

        <Card title="History">
          {inspection && (inspection.revisions.length || inspection.reviews.length)
            ? <QcHistory inspection={inspection} />
            : <p className="py-3 text-[16px] text-muted">No readings yet.</p>}
        </Card>
      </div>

      <UnsavedChangesGuard when={editable && dirty && !busy && !notice} message="Your QC readings have not been saved and will be lost." />
    </div>
  );
}
