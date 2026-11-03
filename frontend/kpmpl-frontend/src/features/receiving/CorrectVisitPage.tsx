import { useId, useState, type FormEvent } from 'react';
import { SafeForm } from '../../components/ui/SafeForm';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api';
import { useAsync } from '../../hooks/useAsync';
import { useWrite } from '../../hooks/useWrite';
import { parseDecimalInput } from '../../domain/decimal';
import type { ReceivingVisit } from '../../domain/types';
import { FieldSet, FormFooter, PageHeader, ReadOnlyItem, kvGrid } from '../../components/ui/Layout';
import { Alert, ErrorState, LoadingState, Note } from '../../components/ui/States';
import { Button, ButtonLink } from '../../components/ui/Button';
import { DecimalUnitField, TextAreaField, TextField } from '../../components/ui/Field';
import { WriteError } from '../../components/ui/WriteError';
import { UnsavedChangesGuard } from '../../components/ui/UnsavedChangesGuard';

/** Correct Gate-entered details with a reason; old values stay in history. */
export function CorrectVisitPage() {
  const { id = '' } = useParams();
  const { state, reload } = useAsync(() => api.getVisit(id), [id]);
  const crumbs = [{ label: 'Receiving Register', to: '/receiving' }, { label: 'Correct details' }];
  if (state.status === 'loading' && !state.data) return <><PageHeader title="Correct Gate details" crumbs={crumbs} /><LoadingState /></>;
  if (state.status === 'error' && !state.data) return <><PageHeader title="Correct Gate details" crumbs={crumbs} /><ErrorState error={state.error} onRetry={reload} /></>;
  return <Form key={state.data!.version} v={state.data!} onReload={reload} />;
}

type Vals = { vehicleNumber: string; supplierDisplayName: string; materialDisplayName: string; challanRef: string; poRef: string; notes: string; gross: string; reason: string };

function Form({ v, onReload }: { v: ReceivingVisit; onReload: () => void }) {
  const navigate = useNavigate();
  const listId = useId();
  const ref = useAsync(() => api.getReferenceData(), []);
  const initial: Vals = {
    vehicleNumber: v.vehicleNumber, supplierDisplayName: v.supplierDisplayName, materialDisplayName: v.materialDisplayName,
    challanRef: v.challanRef ?? '', poRef: v.poRef ?? '', notes: v.notes ?? '', gross: v.grossWeight?.value ?? '', reason: '',
  };
  const [vals, setVals] = useState(initial);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const w = useWrite();
  const dirty = JSON.stringify(vals) !== JSON.stringify(initial);
  const set = (k: keyof Vals) => (e: { target: { value: string } }) => { setVals((x) => ({ ...x, [k]: e.target.value })); setErrs((x) => ({ ...x, [k]: '' })); };

  if (v.exitStatus === 'exited') {
    return (
      <>
        <PageHeader title="Correct Gate details" crumbs={[{ label: 'Receiving Register', to: '/receiving' }, { label: v.officialGateEntryRef, to: `/receiving/${v.id}` }, { label: 'Correct' }]} />
        <Alert tone="warning" title="Locked after exit" className="max-w-3xl">This truck has left the mill, so its gate details can no longer be changed here.</Alert>
        <Note className="mt-4">Corrections after exit are pending KPMPL confirmation.</Note>
        <ButtonLink to={`/receiving/${v.id}`} variant="ghost" className="mt-4">Back to the entry</ButtonLink>
      </>
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const ex: Record<string, string> = {};
    if (!vals.vehicleNumber.trim()) ex.vehicleNumber = 'Enter the vehicle number.';
    if (!vals.supplierDisplayName.trim()) ex.supplierDisplayName = 'Enter the supplier.';
    if (!vals.materialDisplayName.trim()) ex.materialDisplayName = 'Enter the material.';
    const g = parseDecimalInput(vals.gross, { maxDecimals: 3, label: 'gross weight' });
    if (!g.ok) ex.gross = g.message;
    if (!vals.reason.trim()) ex.reason = 'Enter the reason for this correction.';
    setErrs(ex);
    if (Object.keys(ex).length || !g.ok) return;
    const r = await w.run('correct', (k) => api.correctVisit(v.id, {
      vehicleNumber: vals.vehicleNumber.trim(), supplierDisplayName: vals.supplierDisplayName.trim(), materialDisplayName: vals.materialDisplayName.trim(),
      challanRef: vals.challanRef.trim(), poRef: vals.poRef.trim(), notes: vals.notes.trim(), grossWeight: { value: g.value, unit: 'kg' }, reason: vals.reason,
    }, { idempotencyKey: k, expectedVersion: v.version }));
    if (r.ok) { setSaved(true); setTimeout(() => navigate(`/receiving/${v.id}`, { state: { notice: 'Gate details corrected. The earlier values are kept in the history.' } }), 0); }
    else if (r.error?.code === 'VALIDATION_FAILED') setErrs({ ...r.error.fields, gross: r.error.fields.grossWeight ?? '' });
  }

  return (
    <>
      <PageHeader title="Correct Gate details" crumbs={[{ label: 'Receiving Register', to: '/receiving' }, { label: v.officialGateEntryRef, to: `/receiving/${v.id}` }, { label: 'Correct' }]}
        description="Each change is saved with your reason. The old values stay in the history." />
      <SafeForm onSubmit={submit} noValidate className="flex max-w-3xl flex-col gap-9">
        <WriteError error={w.error?.code === 'VALIDATION_FAILED' ? null : w.error} onReload={onReload} />
        <dl className={kvGrid}><ReadOnlyItem label="Gate Entry No." value={v.officialGateEntryRef} mono source="cannot be changed" /></dl>
        <FieldSet legend="Gate entry">
            <TextField label="Vehicle No." required mono value={vals.vehicleNumber} onChange={set('vehicleNumber')} error={errs.vehicleNumber || undefined} maxLength={30} />
            <TextField label="Supplier" required list={`${listId}-s`} value={vals.supplierDisplayName} onChange={set('supplierDisplayName')} error={errs.supplierDisplayName || undefined} autoComplete="off" />
            <TextField label="Material" required list={`${listId}-m`} value={vals.materialDisplayName} onChange={set('materialDisplayName')} error={errs.materialDisplayName || undefined} autoComplete="off" />
            <DecimalUnitField label="Gross Wt (kg)" required unit="kg" value={vals.gross} onChange={set('gross')} error={errs.gross || undefined} />
            <TextField label="Challan No." mono value={vals.challanRef} onChange={set('challanRef')} error={errs.challanRef || undefined} maxLength={40} />
            <TextField label="PO No." mono value={vals.poRef} onChange={set('poRef')} error={errs.poRef || undefined} maxLength={40} />
            <div className="sm:col-span-2"><TextAreaField label="Remarks" rows={2} maxLength={500} value={vals.notes} onChange={set('notes')} error={errs.notes || undefined} /></div>
          <datalist id={`${listId}-s`}>{ref.state.data?.suppliers.map((s) => <option key={s} value={s} />)}</datalist>
          <datalist id={`${listId}-m`}>{ref.state.data?.materials.map((s) => <option key={s} value={s} />)}</datalist>
        </FieldSet>
        <FieldSet legend="Why" cols={1}>
            <TextAreaField label="Reason for correction" required rows={2} maxLength={500} value={vals.reason} onChange={set('reason')} error={errs.reason || undefined}
              hint="For example: vehicle number typed wrongly at entry." />
        </FieldSet>
        <Note>Who may correct gate details is pending KPMPL confirmation.</Note>
        <FormFooter>
          <ButtonLink to={`/receiving/${v.id}`} variant="ghost">Cancel</ButtonLink>
          <Button type="submit" loading={!!w.busy}>Save correction</Button>
        </FormFooter>
      </SafeForm>
      <UnsavedChangesGuard when={dirty && !w.busy && !saved} message="Your corrections have not been saved." />
    </>
  );
}
