import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { cn } from './cn';

interface FieldShellProps {
  label: string;
  required?: boolean;
  hint?: ReactNode;
  error?: string;
  badge?: ReactNode;
  children: (ids: { id: string; describedBy?: string; invalid: boolean }) => ReactNode;
}

export function RequiredMark() {
  return <span className="ml-0.5 font-normal text-muted" aria-hidden>*</span>;
}

export function FieldShell({ label, required, hint, error, badge, children }: FieldShellProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[16px] font-semibold text-ink">
        {label}{required && <RequiredMark />}
        {badge && <span className="ml-2">{badge}</span>}
      </label>
      {children({ id, describedBy: [hintId, errId].filter(Boolean).join(' ') || undefined, invalid: !!error })}
      {hint && <p id={hintId} className="text-[15px] text-muted">{hint}</p>}
      {error && <p id={errId} role="alert" className="text-[15px] text-problem">{error}</p>}
    </div>
  );
}

export const inputCls = (invalid: boolean, extra?: string) =>
  cn(
    'h-12 w-full rounded-lg border bg-white px-3.5 text-[17px] text-ink',
    'focus:outline-3 focus:outline-offset-0 focus:outline-brand-600 focus-visible:outline-offset-0',
    'read-only:bg-paper-deep disabled:bg-paper-deep disabled:text-muted',
    invalid ? 'border-problem' : 'border-field',
    extra,
  );

type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> & Omit<FieldShellProps, 'children'> & { mono?: boolean };

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, required, hint, error, badge, mono, className, ...rest }, ref,
) {
  return (
    <FieldShell label={label} required={required} hint={hint} error={error} badge={badge}>
      {({ id, describedBy, invalid }) => (
        <input ref={ref} id={id} aria-describedby={describedBy} aria-invalid={invalid || undefined} aria-required={required || undefined}
          className={inputCls(invalid, cn(mono && 'font-mono', className))} {...rest} />
      )}
    </FieldShell>
  );
});

type TextAreaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> & Omit<FieldShellProps, 'children'>;
export function TextAreaField({ label, required, hint, error, badge, className, ...rest }: TextAreaProps) {
  return (
    <FieldShell label={label} required={required} hint={hint} error={error} badge={badge}>
      {({ id, describedBy, invalid }) => (
        <textarea id={id} aria-describedby={describedBy} aria-invalid={invalid || undefined} aria-required={required || undefined}
          className={inputCls(invalid, cn('h-auto min-h-20 py-2', className))} {...rest} />
      )}
    </FieldShell>
  );
}

/** Decimal input. The unit is always shown in the label, e.g. "Gross Wt (kg)". */
type DecimalProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'type'> & Omit<FieldShellProps, 'children'> & { unit: string };
export const DecimalUnitField = forwardRef<HTMLInputElement, DecimalProps>(function DecimalUnitField(
  { label, required, hint, error, badge, unit, className, ...rest }, ref,
) {
  const fullLabel = label.includes('(') ? label : `${label} (${unit})`;
  return (
    <FieldShell label={fullLabel} required={required} hint={hint} error={error} badge={badge}>
      {({ id, describedBy, invalid }) => (
        <input ref={ref} id={id} type="text" inputMode="decimal" autoComplete="off" aria-describedby={describedBy}
          aria-invalid={invalid || undefined} aria-required={required || undefined}
          className={inputCls(invalid, cn('text-right font-mono', className))} {...rest} />
      )}
    </FieldShell>
  );
});
