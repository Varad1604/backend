import { useEffect, useRef, type ReactNode } from 'react';
import { Button } from './Button';

export const dialogCls = 'm-auto rounded-xl border border-rule bg-surface p-0 text-ink shadow-2xl backdrop:bg-[#0f172a]/45';

export function DialogHead({ title, onClose, disabled }: { title: string; onClose: () => void; disabled?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-rule px-5 pb-3 pt-4 sm:px-6">
      <h2 className="text-[18px] font-semibold leading-snug tracking-[-0.005em] text-ink">{title}</h2>
      <button type="button" onClick={onClose} disabled={disabled} aria-label="Close"
        className="-mr-1 min-h-10 shrink-0 px-1 text-[15px] text-muted underline decoration-rule underline-offset-[3px] hover:text-ink hover:decoration-ink disabled:opacity-50 sm:min-h-0">
        Close
      </button>
    </div>
  );
}

/** Footer: primary first, then the cancel link, left-aligned (children are passed Cancel, Confirm). */
export const dialogFoot = 'flex flex-col-reverse gap-2 px-5 pb-5 pt-4 sm:flex-row-reverse sm:items-center sm:justify-end sm:gap-5 sm:px-6';

/** Accessible confirmation for consequential actions. */
export function ConfirmDialog({ open, title, children, confirmLabel, onConfirm, onCancel, busy, danger }: {
  open: boolean; title: string; children: ReactNode; confirmLabel: string; onConfirm: () => void; onCancel: () => void; busy?: boolean; danger?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} aria-label={title} onCancel={(e) => { e.preventDefault(); if (!busy) onCancel(); }} className={`${dialogCls} w-[min(92vw,460px)]`}>
      <DialogHead title={title} onClose={onCancel} disabled={busy} />
      <div className="px-5 pt-4 text-[16px] text-ink sm:px-6">{children}</div>
      <div className={dialogFoot}>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>Go back</Button>
        <Button variant={danger ? 'dangerSolid' : 'primary'} onClick={onConfirm} loading={busy} autoFocus>{confirmLabel}</Button>
      </div>
    </dialog>
  );
}
