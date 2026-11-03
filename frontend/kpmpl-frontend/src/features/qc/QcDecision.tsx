import { useState } from 'react';
import { Ban, CircleCheck, CircleMinus, RotateCcw, type LucideIcon } from 'lucide-react';
import { api } from '../../api';
import { useWrite } from '../../hooks/useWrite';
import type { QcDecisionOutcome, ReceivingVisit } from '../../domain/types';
import { TextAreaField } from '../../components/ui/Field';
import { WriteError } from '../../components/ui/WriteError';
import { SafeForm } from '../../components/ui/SafeForm';
import { StepIndicator, StepPanel, SummaryList, WizardFooter } from '../../components/ui/Wizard';
import { NumberPlate } from '../../components/truck/TruckCard';
import { cn } from '../../components/ui/cn';
import { NoDeductionNotice } from './QcReadings';

/**
 * Final QC decision (D-03, decided 2026-11-03): the QC Operator who submitted the readings
 * records the outcome. Four clear choices, a reason where the API needs one, then confirm.
 */
const decisionOutcomes: { key: QcDecisionOutcome; label: string; icon: LucideIcon; tone: string; reasonRequired: boolean; help: string }[] = [
  { key: 'accepted', label: 'Accept', icon: CircleCheck, tone: 'border-done-line hover:border-done text-done', reasonRequired: false, help: 'Readings are fine. Accept the load as recorded.' },
  { key: 'accepted_with_deduction', label: 'Accept with deduction', icon: CircleMinus, tone: 'border-wait-line hover:border-wait text-wait', reasonRequired: true, help: 'Accept, but note why a deduction applies. No amount is calculated here.' },
  { key: 'returned', label: 'Re-check readings', icon: RotateCcw, tone: 'border-action-line hover:border-action text-action', reasonRequired: true, help: 'Open the readings again for a second sample. The current version stays in history.' },
  { key: 'rejected', label: 'Reject', icon: Ban, tone: 'border-problem-line hover:border-problem text-problem', reasonRequired: true, help: 'Reject the load. Handling of rejected loads is pending KPMPL confirmation.' },
];

export function QcDecisionCard({ visit, onDecided, onReload }: { visit: ReceivingVisit; onDecided: (outcome: QcDecisionOutcome) => void; onReload: () => void }) {
  const [step, setStep] = useState(0);
  const [pick, setPick] = useState<QcDecisionOutcome | null>(null);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | undefined>();
  const w = useWrite();
  const meta = decisionOutcomes.find((o) => o.key === pick);

  function next() {
    if (step === 1) {
      if (meta?.reasonRequired && !reason.trim()) { setErr('Enter the reason for this decision.'); return; }
      setStep(2);
    }
  }
  async function confirm() {
    if (!pick || !meta) { setStep(0); return; }
    const r = await w.run(`decide-${visit.id}`, (k) => api.decideQc(visit.id, { outcome: pick, reason }, { idempotencyKey: k, expectedVersion: visit.version }));
    if (r.ok) onDecided(pick);
    else if (r.error?.code === 'VALIDATION_FAILED') { setErr(r.error.fields.reason ?? r.error.message); setStep(1); }
  }

  return (
    <section aria-labelledby="qc-decision-h">
      <h2 id="qc-decision-h" className="mb-4 text-[24px] font-semibold text-ink">QC decision</h2>
      <StepIndicator steps={['Choose', 'Reason', 'Check and confirm']} current={step} />
      <WriteError error={w.error?.code === 'VALIDATION_FAILED' ? null : w.error} onReload={onReload} className="mb-5" />
      {step === 0 && (
        <StepPanel title="What is your decision?" hint="Readings are submitted. Choose one.">
          <div className="grid gap-3 sm:grid-cols-2">
            {decisionOutcomes.map((o) => {
              const Icon = o.icon;
              return (
                <button key={o.key} type="button" onClick={() => { setPick(o.key); setReason(''); setErr(undefined); w.setError(null); setStep(1); }}
                  className={cn('flex min-h-[96px] items-start gap-4 rounded-xl border-2 bg-surface p-4 text-left transition hover:shadow-md', o.tone, pick === o.key && 'ring-2 ring-brand-600')}>
                  <Icon aria-hidden size={30} strokeWidth={1.75} className="mt-0.5 shrink-0" />
                  <span className="flex flex-col gap-1">
                    <span className="text-[19px] font-semibold text-ink">{o.label}</span>
                    <span className="text-[15px] text-muted">{o.help}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <NoDeductionNotice />
        </StepPanel>
      )}
      {step > 0 && meta && (
        <SafeForm onSubmit={() => (step === 1 ? next() : void confirm())} noValidate>
          {step === 1 ? (
            <StepPanel title={meta.label} hint={meta.help}>
              <TextAreaField label={pick === 'accepted' ? 'Remarks' : 'Reason'} required={meta.reasonRequired} rows={3} maxLength={1000} autoFocus
                value={reason} onChange={(e) => { setReason(e.target.value); setErr(undefined); }} error={err}
                hint={meta.reasonRequired ? undefined : 'Optional.'} />
            </StepPanel>
          ) : (
            <StepPanel title="Check and confirm">
              <SummaryList rows={[
                { label: 'Truck', value: <NumberPlate value={visit.vehicleNumber} /> },
                { label: 'Decision', value: meta.label },
                { label: pick === 'accepted' ? 'Remarks' : 'Reason', value: reason },
              ]} />
            </StepPanel>
          )}
          <WizardFooter onBack={() => setStep((s) => s - 1)} nextSubmits busy={!!w.busy}
            nextLabel={step === 1 ? 'Next' : `Save decision: ${meta.label}`} />
        </SafeForm>
      )}
    </section>
  );
}
