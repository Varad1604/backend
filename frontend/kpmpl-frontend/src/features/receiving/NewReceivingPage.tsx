import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { SafeForm } from '../../components/ui/SafeForm';
import { Link } from 'react-router-dom';
import { UnsavedChangesGuard } from '../../components/ui/UnsavedChangesGuard';
import { api, describeError, toApiError, type ApiError } from '../../api';
import { useAsync } from '../../hooks/useAsync';
import { parseDecimalInput } from '../../domain/decimal';
import type { CreateReceivingVisitInput, ReceivingVisit } from '../../domain/types';
import { formatDecimal } from '../../domain/decimal';
import { formatDateTime, newIdempotencyKey } from '../../lib/format';
import { config } from '../../config';
import { Button, ButtonLink } from '../../components/ui/Button';
import { DecimalUnitField, TextAreaField, TextField } from '../../components/ui/Field';
import { PageHeader } from '../../components/ui/Layout';
import { Alert, Note } from '../../components/ui/States';
import { StepIndicator, StepPanel, SuccessPanel, SummaryList, WizardFooter } from '../../components/ui/Wizard';
import { NumberPlate } from '../../components/truck/TruckCard';

interface FormValues {
  officialGateEntryRef: string;
  arrivedAt: string;
  vehicleNumber: string;
  supplierDisplayName: string;
  materialDisplayName: string;
  challanRef: string;
  poRef: string;
  gross: string;
  notes: string;
}
const empty: FormValues = {
  officialGateEntryRef: '', arrivedAt: '', vehicleNumber: '', supplierDisplayName: '',
  materialDisplayName: 'Domestic Waste Paper', challanRef: '', poRef: '', gross: '', notes: '',
};
type Errors = Partial<Record<keyof FormValues, string>>;

/** Client-side guidance only; the backend re-validates everything. */
function validate(v: FormValues): { errors: Errors; payload?: CreateReceivingVisitInput } {
  const e: Errors = {};
  if (!v.officialGateEntryRef) e.officialGateEntryRef = 'Enter the Gate Entry No. from DataMan.';
  else if (v.officialGateEntryRef !== v.officialGateEntryRef.trim()) e.officialGateEntryRef = 'Remove the space at the start or end.';
  if (!v.vehicleNumber.trim()) e.vehicleNumber = 'Enter the vehicle number.';
  if (!v.supplierDisplayName.trim()) e.supplierDisplayName = 'Enter the supplier.';
  if (!v.materialDisplayName.trim()) e.materialDisplayName = 'Enter the material.';
  const g = parseDecimalInput(v.gross, { maxDecimals: 3, label: 'loaded truck weight', max: 100000 });
  if (!g.ok) e.gross = g.message;
  if (v.arrivedAt && new Date(v.arrivedAt).getTime() > Date.now() + 5 * 60000) e.arrivedAt = 'Arrival time cannot be in the future.';
  if (Object.keys(e).length || !g.ok) return { errors: e };
  return {
    errors: {},
    payload: {
      officialGateEntryRef: v.officialGateEntryRef, // exact string: zeros/suffixes preserved
      vehicleNumber: v.vehicleNumber.trim(),
      supplierDisplayName: v.supplierDisplayName.trim(),
      materialDisplayName: v.materialDisplayName.trim(),
      challanRef: v.challanRef.trim() || undefined,
      poRef: v.poRef.trim() || undefined,
      arrivedAt: v.arrivedAt ? new Date(v.arrivedAt).toISOString() : undefined,
      grossWeight: { value: g.value, unit: 'kg' },
      notes: v.notes.trim() || undefined,
    },
  };
}

const fieldOrder: (keyof FormValues)[] = ['officialGateEntryRef', 'arrivedAt', 'vehicleNumber', 'supplierDisplayName', 'materialDisplayName', 'challanRef', 'poRef', 'gross', 'notes'];

const STEPS = ['Truck', 'Load', 'Weight', 'Check and confirm'];
const stepFields: (keyof FormValues)[][] = [
  ['officialGateEntryRef', 'vehicleNumber', 'arrivedAt'],
  ['supplierDisplayName', 'materialDisplayName', 'challanRef', 'poRef'],
  ['gross', 'notes'],
  [],
];
const stepOf = (k: keyof FormValues) => Math.max(0, stepFields.findIndex((f) => f.includes(k)));

/** New truck at the Gate — one step per screen, then Check and confirm. Same API call and idempotency key. */
export function NewReceivingPage() {
  const [values, setValues] = useState<FormValues>(empty);
  const [errors, setErrors] = useState<Errors>({});
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<ApiError | null>(null);
  const [saved, setSaved] = useState<ReceivingVisit | null>(null);
  const idemKey = useRef(newIdempotencyKey());
  const listId = useId();
  const ref = useAsync(() => api.getReferenceData(), []);

  const dirty = useMemo(() => !saved && JSON.stringify(values) !== JSON.stringify(empty), [values, saved]);
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const set = (k: keyof FormValues) => (e: { target: { value: string } }) => {
    setValues((v) => ({ ...v, [k]: e.target.value }));
    if (errors[k]) setErrors((x) => ({ ...x, [k]: undefined }));
  };

  /** Validate only this step's fields before moving on. */
  function next() {
    const { errors: e } = validate(values);
    const mine: Errors = {};
    for (const k of stepFields[step] ?? []) if (e[k]) mine[k] = e[k];
    setErrors(mine);
    if (Object.keys(mine).length) return;
    setStep((s) => s + 1);
    window.scrollTo({ top: 0 });
  }

  async function onSubmit(ev?: FormEvent) {
    ev?.preventDefault();
    if (step < STEPS.length - 1) { next(); return; }
    if (submitting) return; // duplicate-click protection
    setServerError(null);
    const { errors: e, payload } = validate(values);
    setErrors(e);
    if (!payload) { const first = fieldOrder.find((k) => e[k]); if (first) setStep(stepOf(first)); return; }
    setSubmitting(true);
    try {
      const v = await api.createVisit(payload, { idempotencyKey: idemKey.current });
      setSaved(v);
      window.scrollTo({ top: 0 });
    } catch (err) {
      const apiErr = toApiError(err);
      setServerError(apiErr);
      if (apiErr.code === 'VALIDATION_FAILED' || apiErr.code === 'DUPLICATE_CANDIDATE') {
        const mapped: Errors = {};
        for (const [k, msg] of Object.entries(apiErr.fields)) mapped[(k === 'grossWeight' ? 'gross' : k) as keyof FormValues] = msg;
        setErrors(mapped);
        const first = fieldOrder.find((k) => mapped[k]);
        if (first) setStep(stepOf(first));
      }
    } finally {
      setSubmitting(false);
    }
  }

  function startAnother() {
    setValues(empty); setErrors({}); setServerError(null); setSaved(null); setStep(0);
    idemKey.current = newIdempotencyKey();
    window.scrollTo({ top: 0 });
  }

  if (saved) return <SavedConfirmation visit={saved} onAnother={startAnother} />;
  const describe = serverError ? describeError(serverError) : null;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="New Receiving" crumbs={[{ label: 'Home', to: '/home' }, { label: 'New truck' }]}
        description="Make the gate entry in DataMan first, then copy its number here." />
      <UnsavedChangesGuard when={dirty && !submitting} message="The entries on this form have not been saved and will be lost." />
      <StepIndicator steps={STEPS} current={step} />
      <SafeForm onSubmit={onSubmit} noValidate>
        {serverError && serverError.code !== 'VALIDATION_FAILED' && describe && (
          <Alert tone="danger" title={describe.title} className="mb-5">
            <p>{describe.body}</p>
            {serverError.code === 'DUPLICATE_CANDIDATE' && typeof serverError.meta.existingId === 'string' && (
              <p className="mt-1"><Link to={`/receiving/${serverError.meta.existingId}`} className="underline">Open the existing entry</Link>{' '}to check it. If this is a new truck, check the Gate Entry No. in DataMan.</p>
            )}
            {serverError.code === 'NETWORK_UNAVAILABLE' && <p className="mt-1">Nothing was saved. Press Save and send to QC again to retry.</p>}
            {serverError.requestId && <p className="mt-1 text-[13px] opacity-80">Reference: {serverError.requestId}</p>}
          </Alert>
        )}
        {step === 0 && (
          <StepPanel title="Which truck?" hint="Copy the Gate Entry No. exactly as DataMan shows it.">
            <TextField label="Gate Entry No." required mono autoFocus autoComplete="off" spellCheck={false} autoCapitalize="characters" placeholder="DEMO-GATE-0005"
              value={values.officialGateEntryRef} onChange={set('officialGateEntryRef')} error={errors.officialGateEntryRef} hint="Leading zeros too." />
            <TextField label="Vehicle No." required mono autoComplete="off" spellCheck={false} autoCapitalize="characters" placeholder="MH15-AB-1234"
              value={values.vehicleNumber} onChange={set('vehicleNumber')} error={errors.vehicleNumber} />
            <TextField label="Arrival time" type="datetime-local" className="font-mono" value={values.arrivedAt} onChange={set('arrivedAt')} error={errors.arrivedAt} hint="Leave blank if not known." />
          </StepPanel>
        )}
        {step === 1 && (
          <StepPanel title="What is it carrying?" hint="Start typing to pick from the list.">
            <TextField label="Supplier" required list={`${listId}-sup`} autoComplete="off" value={values.supplierDisplayName} onChange={set('supplierDisplayName')} error={errors.supplierDisplayName} autoFocus />
            <TextField label="Material" required list={`${listId}-mat`} autoComplete="off" value={values.materialDisplayName} onChange={set('materialDisplayName')} error={errors.materialDisplayName} />
            <div className="grid gap-5 sm:grid-cols-2">
              <TextField label="Challan No." mono autoComplete="off" spellCheck={false} value={values.challanRef} onChange={set('challanRef')} error={errors.challanRef} hint="If the driver has one." />
              <TextField label="PO No." mono autoComplete="off" spellCheck={false} value={values.poRef} onChange={set('poRef')} error={errors.poRef} hint="If known." />
            </div>
            <datalist id={`${listId}-sup`}>{ref.state.status === 'success' && ref.state.data.suppliers.map((x) => <option key={x} value={x} />)}</datalist>
            <datalist id={`${listId}-mat`}>{ref.state.status === 'success' && ref.state.data.materials.map((x) => <option key={x} value={x} />)}</datalist>
          </StepPanel>
        )}
        {step === 2 && (
          <StepPanel title="Weigh the loaded truck" hint="Read the weighbridge with the full truck on it.">
            <DecimalUnitField label="Loaded truck weight (kg)" required unit="kg" placeholder="0.000" autoFocus
              value={values.gross} onChange={set('gross')} error={errors.gross} hint="Up to 3 decimals." className="h-14 text-[22px]" />
            <TextAreaField label="Remarks" maxLength={500} rows={2} value={values.notes} onChange={set('notes')} hint={<span className="font-mono">{values.notes.length}/500</span>} />
          </StepPanel>
        )}
        {step === 3 && (
          <StepPanel title="Check and confirm" hint="If something is wrong, press Back and change it.">
            <SummaryList rows={[
              { label: 'Gate Entry No.', value: <span className="font-mono">{values.officialGateEntryRef}</span> },
              { label: 'Vehicle No.', value: values.vehicleNumber && <NumberPlate value={values.vehicleNumber.trim()} /> },
              { label: 'Arrival time', value: values.arrivedAt ? values.arrivedAt.replace('T', ' ') : 'Not entered' },
              { label: 'Supplier', value: values.supplierDisplayName },
              { label: 'Material', value: values.materialDisplayName },
              { label: 'Challan No. / PO No.', value: [values.challanRef, values.poRef].filter(Boolean).join(' / ') },
              { label: 'Loaded truck weight', value: values.gross && <span className="font-mono">{values.gross} kg</span> },
              { label: 'Remarks', value: values.notes },
            ]} />
            <p className="text-[16px] text-ink-soft">When you save, the truck goes to the QC queue for a sample.</p>
          </StepPanel>
        )}
        <WizardFooter onBack={step > 0 ? () => setStep((s) => s - 1) : undefined} nextSubmits busy={submitting}
          nextLabel={step < STEPS.length - 1 ? 'Next' : submitting ? 'Saving…' : 'Save and send to QC'}
          extra={step === 0 ? <ButtonLink to="/home" variant="ghost">Cancel</ButtonLink> : undefined} />
      </SafeForm>
    </div>
  );
}

function SavedConfirmation({ visit, onAnother }: { visit: ReceivingVisit; onAnother: () => void }) {
  return (
    <div className="mx-auto max-w-3xl">
      <SuccessPanel title="Saved and sent to QC" next="QC takes a sample and enters moisture and impurity. Then the Gate weighs the empty truck."
        actions={<>
          <Button size="lg" onClick={onAnother}>Record another truck</Button>
          <ButtonLink to={`/receiving/${visit.id}`} variant="secondary" size="lg">Open this entry</ButtonLink>
          <ButtonLink to="/home" variant="ghost">Back to Home</ButtonLink>
        </>}>
        <p className="flex flex-wrap items-center gap-3"><NumberPlate value={visit.vehicleNumber} /><span className="font-mono">{visit.officialGateEntryRef}</span></p>
        <p className="mt-2">{visit.supplierDisplayName} · {visit.materialDisplayName} · <span className="font-mono">{visit.grossWeight ? formatDecimal(visit.grossWeight.value) : '—'} kg</span></p>
        <p className="mt-1 text-[15px] text-muted">{visit.createdBy} · <span className="font-mono">{formatDateTime(visit.createdAt)}</span></p>
        {config.isDemo && <Note className="mt-2">Demo entry. Nothing was sent to DataMan.</Note>}
      </SuccessPanel>
    </div>
  );
}
