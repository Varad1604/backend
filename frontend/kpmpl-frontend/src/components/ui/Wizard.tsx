import { useEffect, useRef, type ReactNode } from 'react';
import { Check, ChevronLeft, ChevronRight, CircleCheck } from 'lucide-react';
import { Button } from './Button';
import { cn } from './cn';

/** "Step 2 of 4" with numbered dots. Done steps are green, the current one blue. */
export function StepIndicator({ steps, current }: { steps: string[]; current: number }) {
  return (
    <nav aria-label="Steps" className="mb-6">
      <p className="mb-3 text-[16px] font-semibold text-brand-700">Step {current + 1} of {steps.length}: <span className="text-ink">{steps[current]}</span></p>
      <ol className="flex items-center gap-2">
        {steps.map((s, i) => (
          <li key={s} className="flex min-w-0 flex-1 items-center gap-2" aria-current={i === current ? 'step' : undefined}>
            <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-full border-2 text-[15px] font-semibold',
              i < current ? 'border-done bg-done text-white' : i === current ? 'border-brand-600 bg-brand-600 text-white' : 'border-field bg-surface text-muted')}>
              {i < current ? <Check aria-hidden size={18} strokeWidth={2.5} /> : i + 1}
            </span>
            <span className={cn('hidden truncate text-[15px] md:inline', i === current ? 'font-semibold text-ink' : 'text-muted')}>{s}</span>
            {i < steps.length - 1 && <span aria-hidden className={cn('h-0.5 min-w-3 flex-1 rounded', i < current ? 'bg-done' : 'bg-rule')} />}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** The white panel a step's 2–4 fields sit in. */
export function StepPanel({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => { ref.current?.focus({ preventScroll: true }); }, [title]);
  return (
    <section className="rounded-2xl border border-rule bg-surface p-5 shadow-sm sm:p-7">
      <h2 ref={ref} tabIndex={-1} className="text-[22px] font-semibold leading-snug text-ink outline-none">{title}</h2>
      {hint && <p className="mt-1 text-[16px] text-muted">{hint}</p>}
      <div className="mt-5 flex flex-col gap-5">{children}</div>
    </section>
  );
}

/** Back (keeps entries) + one large primary button. */
export function WizardFooter({ onBack, backLabel = 'Back', nextLabel, onNext, busy, nextDisabled, extra, nextSubmits }: {
  onBack?: () => void; backLabel?: string; nextLabel: string; onNext?: () => void; busy?: boolean; nextDisabled?: boolean; extra?: ReactNode; nextSubmits?: boolean;
}) {
  return (
    <div className="sticky bottom-0 z-10 -mx-4 mt-6 flex flex-wrap items-center gap-3 border-t border-rule bg-paper/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0">
      {onBack && <Button variant="secondary" size="lg" onClick={onBack} disabled={busy}><ChevronLeft aria-hidden size={20} />{backLabel}</Button>}
      <Button size="lg" type={nextSubmits ? 'submit' : 'button'} onClick={nextSubmits ? undefined : onNext} loading={busy} disabled={nextDisabled} className="min-w-[180px] flex-1 sm:flex-none">
        {nextLabel}{!busy && <ChevronRight aria-hidden size={20} />}
      </Button>
      {extra && <div className="flex flex-wrap items-center gap-3 sm:ml-auto">{extra}</div>}
    </div>
  );
}

/** Plain-language "Check and confirm" list. */
export function SummaryList({ rows }: { rows: { label: string; value: ReactNode; step?: number }[]; }) {
  return (
    <dl className="divide-y divide-rule rounded-xl border border-rule">
      {rows.map((r) => (
        <div key={r.label} className="grid gap-1 px-4 py-3 sm:grid-cols-[220px_minmax(0,1fr)] sm:gap-4">
          <dt className="text-[16px] text-muted">{r.label}</dt>
          <dd className="min-w-0 break-words text-[17px] font-medium text-ink">{r.value === '' || r.value == null ? <span className="font-normal text-faint">—</span> : r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Clear success state: what happened, what's next. */
export function SuccessPanel({ title, children, next, actions }: { title: string; children?: ReactNode; next?: ReactNode; actions?: ReactNode }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <section role="status" className="rounded-2xl border border-done-line bg-surface p-6 shadow-sm sm:p-8">
      <div className="flex items-start gap-4">
        <CircleCheck aria-hidden size={40} strokeWidth={1.75} className="shrink-0 text-done" />
        <div className="min-w-0">
          <h1 ref={ref} tabIndex={-1} className="text-[26px] font-semibold leading-tight text-ink outline-none">{title}</h1>
          {children && <div className="mt-2 text-[17px] text-ink-soft">{children}</div>}
          {next && <p className="mt-4 rounded-lg bg-action-bg px-4 py-3 text-[17px] text-ink"><span className="font-semibold text-action">What's next: </span>{next}</p>}
        </div>
      </div>
      {actions && <div className="mt-6 flex flex-wrap items-center gap-3">{actions}</div>}
    </section>
  );
}
