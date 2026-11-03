import { useEffect, useRef, type ReactNode } from 'react';
import { SafeForm } from './SafeForm';
import { Button } from './Button';
import { DialogHead, dialogCls, dialogFoot } from './ConfirmDialog';
import { RequiredMark, inputCls } from './Field';

/** Modal with a form body (for actions that need a reason or extra input). */
export function FormDialog({ open, title, children, confirmLabel, onConfirm, onCancel, busy, danger, wide }: {
  open: boolean; title: string; children: ReactNode; confirmLabel: string; onConfirm: () => void; onCancel: () => void;
  busy?: boolean; danger?: boolean; wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} aria-label={title} onCancel={(e) => { e.preventDefault(); if (!busy) onCancel(); }}
      className={`${dialogCls} ${wide ? 'w-[min(94vw,640px)]' : 'w-[min(92vw,480px)]'}`}>
      <SafeForm onSubmit={(e) => { e.preventDefault(); onConfirm(); }} noValidate>
        <DialogHead title={title} onClose={onCancel} disabled={busy} />
        <div className="max-h-[70vh] overflow-y-auto px-5 pt-4 sm:px-6">
          <div className="flex flex-col gap-4 text-[16px] text-ink">{open && children}</div>
        </div>
        <div className={dialogFoot}>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button type="submit" variant={danger ? 'dangerSolid' : 'primary'} loading={busy}>{confirmLabel}</Button>
        </div>
      </SafeForm>
    </dialog>
  );
}

export function CheckboxField({ checked, onChange, children, error }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode; error?: string }) {
  return (
    <div>
      <label className="flex min-h-10 cursor-pointer items-start gap-2.5 py-1 text-[16px] text-ink sm:min-h-0">
        <input type="checkbox" className="mt-[3px] size-4 shrink-0 cursor-pointer accent-ink" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-invalid={!!error || undefined} />
        <span>{children}</span>
      </label>
      {error && <p role="alert" className="mt-1 text-[15px] text-problem">{error}</p>}
    </div>
  );
}

export function SelectField({ label, value, onChange, options, error, required, hint }: {
  label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; error?: string; required?: boolean; hint?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[15px] font-medium text-ink">{label}{required && <RequiredMark />}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={!!error || undefined} className={inputCls(!!error)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {hint && <span className="text-[15px] text-muted">{hint}</span>}
      {error && <span role="alert" className="text-[15px] text-problem">{error}</span>}
    </label>
  );
}
