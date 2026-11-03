import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { config } from '../../config';
import { mockControls, resetDemoData } from '../../api/mock/mockAdapter';
import { ConfirmDialog, DialogHead, dialogCls, dialogFoot } from '../ui/ConfirmDialog';
import { Button } from '../ui/Button';

/** DEMO + MOCK ONLY. Lazy-loaded by AppShell and compiled out of http builds. */
function useMockControls() {
  return useSyncExternalStore(
    (cb) => { mockControls.listeners.add(cb); return () => mockControls.listeners.delete(cb); },
    () => mockControls.failNextWrite,
  );
}

/** Demo-only switches, opened from the right end of the demo strip. */
export default function DemoTools() {
  const failNext = useMockControls();
  const [open, setOpen] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  if (!config.isDemo || !config.isMock) return null;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog"
        className="-my-1 flex h-7 shrink-0 items-center font-mono text-[15px] text-paper underline decoration-paper/40 underline-offset-[3px] hover:decoration-paper focus-visible:outline-paper">
        Demo tools
      </button>
      <dialog ref={ref} aria-label="Demo tools" onCancel={(e) => { e.preventDefault(); setOpen(false); }} className={`${dialogCls} w-[min(92vw,420px)]`}>
        <DialogHead title="Demo tools" onClose={() => setOpen(false)} />
        <div className="flex flex-col gap-4 px-5 pt-4 text-[16px] sm:px-6">
          <label className="flex min-h-10 cursor-pointer items-start gap-2.5 sm:min-h-0">
            <input type="checkbox" className="mt-[3px] size-4 accent-ink" checked={failNext} onChange={(e) => mockControls.set({ failNextWrite: e.target.checked })} />
            <span>Make the next save fail, as if the connection dropped</span>
          </label>
          <div><Button variant="danger" size="sm" onClick={() => { setOpen(false); setConfirmReset(true); }}>Reset demo data</Button></div>
        </div>
        <div className={dialogFoot}><Button variant="ghost" onClick={() => setOpen(false)}>Close</Button></div>
      </dialog>
      <ConfirmDialog open={confirmReset} title="Reset demo data?" confirmLabel="Reset" danger onCancel={() => setConfirmReset(false)}
        onConfirm={() => { resetDemoData(); window.location.hash = '#/'; window.location.reload(); }}>
        Every sample truck, account and document package goes back to how it started. Anything entered so far is lost.
      </ConfirmDialog>
    </>
  );
}
