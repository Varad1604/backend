import { useAuth } from '../../auth/AuthContext';
import { can } from '../../auth/permissions';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';
import { config } from '../../config';
import { useWrite } from '../../hooks/useWrite';
import { deriveNet, formatDecimal } from '../../domain/decimal';
import { ERP_ORDER, docCategoryMeta, erpMilestoneMeta, packageStatusMeta } from '../../domain/status';
import type { DocCategory, DocumentItem, DocumentPackageView, ErpMilestoneType } from '../../domain/types';
import { formatBytes, formatDateTime, fromIstInput, toIstInput } from '../../lib/format';
import { ExitTag, QcTag, Tag } from '../../components/ui/StatusTag';
import { Button, buttonClasses } from '../../components/ui/Button';
import { dialogCls } from '../../components/ui/ConfirmDialog';
import { Note } from '../../components/ui/States';
import { Card, ReadOnlyItem, TableWrap, kvGrid } from '../../components/ui/Layout';
import { TextAreaField, TextField } from '../../components/ui/Field';
import { CheckboxField, FormDialog } from '../../components/ui/Dialog';
import { WriteError } from '../../components/ui/WriteError';
import { cn } from '../../components/ui/cn';

export const PackageStatusTag = ({ p }: { p: { status: DocumentPackageView['status'] } }) =>
  <Tag tone={packageStatusMeta[p.status].tone}>{packageStatusMeta[p.status].label}</Tag>;

export function missingCount(p: DocumentPackageView) {
  return p.items.filter((i) => i.state === 'missing').length;
}

/** Linked truck entries with the facts HO needs, read-only. */
export function LinkedVisits({ p, linkToVisit }: { p: DocumentPackageView; linkToVisit: boolean }) {
  return (
    <TableWrap>
      <table className="tbl min-w-[620px]">
        <thead><tr>
          <th scope="col">Gate Entry No.</th><th scope="col">Vehicle No.</th><th scope="col" className="num">Net Wt (kg)</th><th scope="col">GRN No.</th><th scope="col">QC</th><th scope="col">Exit</th>
        </tr></thead>
        <tbody>
          {p.visits.map((v) => {
            const net = deriveNet(v.grossWeight, v.tareWeight);
            return (
              <tr key={v.id}>
                <td className="nowrap">{linkToVisit ? <Link to={`/receiving/${v.id}`} className="lnk font-mono">{v.officialGateEntryRef}</Link> : <span className="font-mono">{v.officialGateEntryRef}</span>}</td>
                <td className="nowrap font-mono text-[15px]">{v.vehicleNumber}</td>
                <td className="num font-mono">{net ? formatDecimal(net) : '—'}</td>
                <td className="nowrap">{v.officialGrnRef ? <span className="font-mono">{v.officialGrnRef}</span> : <Tag tone="warning">Pending</Tag>}</td>
                <td><QcTag s={v.qcStatus} /></td>
                <td><ExitTag s={v.exitStatus} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </TableWrap>
  );
}

function FileLink({ f }: { f: DocumentItem['files'][number] }) {
  // http: GET /document-files/{id}/content (server authorises). mock: in-tab blob URL, if still held.
  const url = f.synthetic ? null : api.fileContentUrl(f.id);
  const [view, setView] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const d = ref.current; if (!d) return; if (view && !d.open) d.showModal(); if (!view && d.open) d.close(); }, [view]);
  return (
    <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
      {url ? (
        <button type="button" onClick={() => setView(true)} className="min-h-10 truncate text-left font-mono text-[15px] font-medium text-ink underline decoration-field underline-offset-[3px] hover:decoration-ink sm:min-h-0">{f.name}</button>
      ) : <span className="truncate font-mono text-[15px]">{f.name}</span>}
      <span className="shrink-0 font-mono text-[15px] text-muted">{formatBytes(f.sizeBytes)}{f.synthetic ? ', sample file' : url ? '' : config.isMock ? ', file not kept after reload' : ''}</span>
      {url && (
        <dialog ref={ref} aria-label={f.name} onCancel={(e) => { e.preventDefault(); setView(false); }} className={`${dialogCls} h-[88vh] w-[min(96vw,980px)] overflow-hidden`}>
          <div className="flex h-full flex-col">
            <div className="flex items-baseline justify-between gap-3 border-b border-rule px-5 py-3">
              <p className="truncate font-mono text-[16px] font-medium">{f.name}</p>
              <div className="flex shrink-0 items-baseline gap-5">
                <a href={url} target="_blank" rel="noreferrer" className="act text-[15px]">Open in new tab</a>
                <Button size="sm" variant="ghost" onClick={() => setView(false)}>Close</Button>
              </div>
            </div>
            {view && <iframe title={f.name} src={url} className="min-h-0 flex-1 bg-white" />}
          </div>
        </dialog>
      )}
    </span>
  );
}

const stateTag = (i: DocumentItem) => i.state === 'attached' ? <Tag tone="success">Attached</Tag>
  : i.state === 'not_applicable' ? <Tag tone="neutral">Not applicable</Tag> : <Tag tone="warning">Not attached</Tag>;

/**
 * Checklist rows. Gate mode: attach/remove/not-applicable. HO mode: open and mark checked / issue.
 * Rows are candidates from the sample, never hard-required flags.
 */
export function Checklist({ p, mode, editable, onChanged, reviewing }: {
  p: DocumentPackageView; mode: 'gate' | 'ho'; editable: boolean; reviewing?: boolean; onChanged: (msg: string, updated?: DocumentPackageView) => void;
}) {
  const w = useWrite();
  const inputs = useRef<Partial<Record<DocCategory, HTMLInputElement | null>>>({});
  const [na, setNa] = useState<DocCategory | null>(null);
  const [naReason, setNaReason] = useState('');
  const [naErr, setNaErr] = useState<string>();
  const [issue, setIssue] = useState<DocCategory | null>(null);
  const [issueNote, setIssueNote] = useState('');
  const [issueErr, setIssueErr] = useState<string>();
  const opts = (k: string) => ({ idempotencyKey: k, expectedVersion: p.version });

  async function attach(category: DocCategory, file: File | undefined) {
    if (!file) return;
    const r = await w.run(`attach-${category}`, (k) => api.attachFile(p.id, { category, file }, opts(k)));
    if (r.ok) onChanged(`${file.name} attached to ${docCategoryMeta[category].label}.`, r.data);
    const el = inputs.current[category];
    if (el) el.value = '';
  }
  async function remove(category: DocCategory, fileId: string, name: string) {
    const r = await w.run(`rm-${fileId}`, (k) => api.removeFile(p.id, category, fileId, opts(k)));
    if (r.ok) onChanged(`${name} removed.`, r.data);
  }
  async function saveNa() {
    if (!na) return;
    if (!naReason.trim()) { setNaErr('Enter why this document does not apply.'); return; }
    const r = await w.run(`na-${na}`, (k) => api.setNotApplicable(p.id, na, naReason, opts(k)));
    if (r.ok) { onChanged(`${docCategoryMeta[na].label} marked not applicable.`, r.data); setNa(null); }
    else if (r.error?.code === 'VALIDATION_FAILED') setNaErr(r.error.fields.reason);
  }
  async function undoNa(category: DocCategory) {
    const r = await w.run(`unna-${category}`, (k) => api.setNotApplicable(p.id, category, null, opts(k)));
    if (r.ok) onChanged(`${docCategoryMeta[category].label} is back on the checklist.`, r.data);
  }
  async function check(category: DocCategory, c: 'ok' | 'unchecked') {
    const r = await w.run(`chk-${category}`, (k) => api.hoCheckItem(p.id, category, c, null, opts(k)));
    if (r.ok) onChanged(c === 'ok' ? `${docCategoryMeta[category].label} marked checked.` : `Check cleared.`, r.data);
  }
  async function saveIssue() {
    if (!issue) return;
    if (!issueNote.trim()) { setIssueErr('Describe the issue.'); return; }
    const r = await w.run(`iss-${issue}`, (k) => api.hoCheckItem(p.id, issue, 'issue', issueNote, opts(k)));
    if (r.ok) { onChanged(`Issue noted on ${docCategoryMeta[issue].label}.`, r.data); setIssue(null); }
  }

  return (
    <>
      <WriteError error={na || issue ? null : w.error} className="mb-4" />
      <div className="hidden grid-cols-[44px_minmax(240px,1.1fr)_140px_minmax(0,1fr)_250px] gap-x-5 border-b border-rule pb-2 text-[15px] font-semibold uppercase tracking-[0.06em] text-muted lg:grid">
        <span>No.</span><span>Document</span><span>Status</span><span>Files and remarks</span><span className="sr-only">Actions</span>
      </div>
      <ol className="border-t border-rule lg:border-t-0">
        {p.items.map((i, n) => {
          const meta = docCategoryMeta[i.category];
          const gateEdit = mode === 'gate' && editable;
          const hoActs = mode === 'ho' && reviewing && i.state === 'attached';
          return (
            <li key={i.category} className="grid grid-cols-[36px_minmax(0,1fr)] gap-x-3 gap-y-1.5 border-b border-rule py-3.5 lg:grid-cols-[44px_minmax(240px,1.1fr)_140px_minmax(0,1fr)_250px] lg:items-start lg:gap-x-5">
              <span className="pt-px font-mono text-[15px] text-muted">{String(n + 1).padStart(2, '0')}</span>
              <div className="min-w-0">
                <p className="font-medium text-ink">{meta.label}</p>
                {meta.hint && <p className="mt-0.5 text-[16px] text-muted">{meta.hint}</p>}
              </div>
              <div className="col-start-2 flex flex-col gap-0.5 text-[15px] lg:col-start-auto">
                {stateTag(i)}
                {i.hoCheck === 'ok' && <Tag tone="success">HO checked</Tag>}
                {i.hoCheck === 'issue' && <Tag tone="danger">HO issue</Tag>}
              </div>
              <div className="col-start-2 min-w-0 text-[15px] lg:col-start-auto">
                {i.state === 'not_applicable' && <p className="text-ink-soft"><span className="text-muted">Reason:</span> {i.notApplicableReason}</p>}
                {i.files.length > 0 && (
                  <ul className="flex flex-col gap-0.5">
                    {i.files.map((f) => (
                      <li key={f.id} className="flex items-baseline justify-between gap-3">
                        <FileLink f={f} />
                        {gateEdit && (
                          <button type="button" onClick={() => remove(i.category, f.id, f.name)} disabled={!!w.busy} aria-label={`Remove ${f.name}`}
                            className="min-h-10 shrink-0 text-[15px] text-problem underline decoration-rule underline-offset-[3px] hover:decoration-problem sm:min-h-0">Remove</button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {i.hoNote && <p className="mt-1 text-problem"><span className="font-medium">HO note:</span> {i.hoNote}</p>}
                {i.state === 'missing' && !i.hoNote && <span className="hidden text-faint lg:inline">—</span>}
              </div>
              {(gateEdit || hoActs) ? (
                <div className="col-start-2 flex flex-wrap items-center gap-x-5 gap-y-2 pt-1 lg:col-start-auto lg:flex-nowrap lg:justify-end lg:pt-0">
                  {gateEdit && i.state !== 'not_applicable' && (
                    <>
                      {/* A real <label> around the file input: works where scripted .click() on a hidden input is blocked (sandboxed previews). */}
                      <label className={cn(buttonClasses('secondary', 'sm'), 'relative cursor-pointer focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ink', w.busy && 'pointer-events-none opacity-60')}>
                        {w.busy === `attach-${i.category}` ? 'Uploading…' : i.files.length ? 'Add PDF' : 'Attach PDF'}
                        <input ref={(el) => { inputs.current[i.category] = el; }} type="file" accept="application/pdf,.pdf" disabled={!!w.busy}
                          aria-label={`Attach PDF to ${meta.label}`} className="absolute inset-0 cursor-pointer opacity-0"
                          onChange={(e) => attach(i.category, e.target.files?.[0])} />
                      </label>
                      {i.files.length === 0 && <Button size="sm" variant="ghost" disabled={!!w.busy} onClick={() => { setNa(i.category); setNaReason(''); setNaErr(undefined); w.setError(null); }}>Not applicable</Button>}
                    </>
                  )}
                  {gateEdit && i.state === 'not_applicable' && (
                    <Button size="sm" variant="ghost" disabled={!!w.busy} onClick={() => undoNa(i.category)}>Undo</Button>
                  )}
                  {hoActs && (
                    <>
                      {i.hoCheck !== 'ok'
                        ? <Button size="sm" variant="secondary" disabled={!!w.busy} onClick={() => check(i.category, 'ok')}>Mark checked</Button>
                        : <Button size="sm" variant="ghost" disabled={!!w.busy} onClick={() => check(i.category, 'unchecked')}>Clear check</Button>}
                      <Button size="sm" variant="ghost" className="!text-problem hover:!decoration-problem" disabled={!!w.busy}
                        onClick={() => { setIssue(i.category); setIssueNote(i.hoNote ?? ''); setIssueErr(undefined); w.setError(null); }}>Note issue</Button>
                    </>
                  )}
                </div>
              ) : <span className="hidden lg:block" />}
            </li>
          );
        })}
      </ol>
      <FormDialog open={!!na} title="Mark not applicable?" confirmLabel="Mark not applicable" busy={!!w.busy} onCancel={() => setNa(null)} onConfirm={saveNa}>
        <p className="font-medium">{na && docCategoryMeta[na].label}</p>
        <WriteError error={w.error?.code === 'VALIDATION_FAILED' && naErr ? null : w.error} />
        <TextAreaField label="Why it does not apply" required rows={2} maxLength={300} value={naReason} onChange={(e) => { setNaReason(e.target.value); setNaErr(undefined); }} error={naErr}
          hint="Head Office will see this reason." />
      </FormDialog>
      <FormDialog open={!!issue} title="Note an issue" confirmLabel="Save issue" busy={!!w.busy} onCancel={() => setIssue(null)} onConfirm={saveIssue}>
        <p className="font-medium">{issue && docCategoryMeta[issue].label}</p>
        <WriteError error={w.error?.code === 'VALIDATION_FAILED' && issueErr ? null : w.error} />
        <TextAreaField label="Issue" required rows={3} maxLength={500} value={issueNote} onChange={(e) => { setIssueNote(e.target.value); setIssueErr(undefined); }} error={issueErr}
          hint="For follow-up only. To send it back to the Gate, use Request correction." />
      </FormDialog>
    </>
  );
}

export function CorrectionList({ p }: { p: DocumentPackageView }) {
  if (!p.corrections.length) return null;
  return (
    <Card title="Corrections asked for">
      <TableWrap>
        <table className="tbl tbl-wrap min-w-[720px]">
          <thead><tr><th scope="col">Documents</th><th scope="col">Reason</th><th scope="col">Requested</th><th scope="col">Gate response</th><th scope="col">Status</th></tr></thead>
          <tbody>
            {p.corrections.slice().reverse().map((c) => (
              <tr key={c.id}>
                <td className="align-top">{c.categories.map((x) => docCategoryMeta[x].label).join(', ')}</td>
                <td className="align-top">{c.reason}</td>
                <td className="align-top text-[15px] text-muted">{c.requestedBy}<br /><span className="font-mono text-[15px]">{formatDateTime(c.requestedAt)}</span></td>
                <td className="align-top">{c.responseNote ? <>{c.responseNote}<div className="font-mono text-[15px] text-muted">{formatDateTime(c.resolvedAt)}</div></> : '—'}</td>
                <td className="align-top"><Tag tone={c.resolvedAt ? 'success' : 'danger'}>{c.resolvedAt ? 'Resubmitted' : 'Open'}</Tag></td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
    </Card>
  );
}

/**
 * Manually verified DataMan milestones. No sync: each confirmation carries who checked,
 * when it was recorded here, the DataMan reference, and source = staff confirmed.
 */
export function ErpPanel({ p, canConfirm, onChanged }: { p: DocumentPackageView; canConfirm: boolean; onChanged: (msg: string, updated?: DocumentPackageView) => void }) {
  const { user } = useAuth();
  function canDo(type: ErpMilestoneType) {
    if (type === 'plant_head_grn_approval') return can(user, 'erp.plant_head_approval') || can(user, 'erp.confirm');
    if (type === 'purchase_voucher') return can(user, 'erp.purchase_voucher') || can(user, 'erp.confirm');
    if (type === 'final_posting') return can(user, 'erp.final_posting');
    return canConfirm;
  }
  const w = useWrite();
  const [dlg, setDlg] = useState<{ type: ErpMilestoneType; action: 'confirm' | 'reverse' } | null>(null);
  const [ref, setRef] = useState('');
  const [at, setAt] = useState('');
  const [note, setNote] = useState('');
  const [verified, setVerified] = useState(false);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [remind, setRemind] = useState(false);
  const [remindNote, setRemindNote] = useState('');
  const tracked = ['submitted_to_ho', 'under_ho_review', 'correction_requested', 'resubmitted', 'verified'].includes(p.status);

  function open(type: ErpMilestoneType, action: 'confirm' | 'reverse') {
    const suggested = type === 'plant_head_grn_approval' ? (p.visits.map((v) => v.officialGrnRef).filter(Boolean)[0] ?? '') : '';
    setRef(suggested); setAt(''); setNote(''); setVerified(false); setErrs({}); w.setError(null); setDlg({ type, action });
  }
  async function save() {
    if (!dlg) return;
    const ex: Record<string, string> = {};
    if (dlg.action === 'confirm') {
      if (dlg.type !== 'final_posting' && !ref.trim()) ex.dataManRef = `Enter the ${erpMilestoneMeta[dlg.type].refLabel.toLowerCase()}.`;
      if (at && !fromIstInput(at)) ex.erpOccurredAt = 'Enter a valid date and time.';
      if (!verified) ex.verifiedInDataManByStaff = 'Confirm you checked this in DataMan.';
    } else if (!note.trim()) ex.note = 'Enter the reason for reversing.';
    setErrs(ex);
    if (Object.keys(ex).length) return;
    const r = await w.run(`erp-${dlg.type}-${dlg.action}`, (k) => api.recordErpMilestone(p.id, {
      type: dlg.type, action: dlg.action, dataManRef: ref.trim() || undefined, erpOccurredAt: at ? fromIstInput(at)! : undefined, note, verifiedInDataManByStaff: verified,
    }, { idempotencyKey: k, expectedVersion: p.version }));
    if (r.ok) { onChanged(`${erpMilestoneMeta[dlg.type].short} ${dlg.action === 'confirm' ? 'confirmed' : 'reversed'}.`, r.data); setDlg(null); }
    else if (r.error?.code === 'VALIDATION_FAILED') setErrs(r.error.fields);
  }
  async function sendReminder() {
    const r = await w.run('remind', (k) => api.sendReminder(p.id, remindNote, { idempotencyKey: k, expectedVersion: p.version }));
    if (r.ok) { onChanged('Reminder logged.', r.data); setRemind(false); }
  }

  return (
    <Card title={<span id="erp">DataMan milestones</span>} subtitle="Entered by staff after checking DataMan. Not synced.">
      {!tracked && <p className="mb-3 text-[16px] text-ink">Tracking starts once the package reaches Head Office.</p>}
      <WriteError error={dlg || remind ? null : w.error} className="mb-3" />
      <TableWrap>
        <table className="tbl tbl-wrap min-w-[760px]">
          <thead><tr>
            <th scope="col">Step</th><th scope="col">Status</th><th scope="col">DataMan Ref.</th><th scope="col">Checked by / entered</th>
            {tracked && <th scope="col"><span className="sr-only">Action</span></th>}
          </tr></thead>
          <tbody>
            {ERP_ORDER.map((type, idx) => {
              const m = p.erp.find((x) => x.type === type)!;
              const meta = erpMilestoneMeta[type];
              const prevOk = idx === 0 || p.erp.find((x) => x.type === ERP_ORDER[idx - 1])!.status === 'confirmed';
              const nextConfirmed = ERP_ORDER.slice(idx + 1).some((t) => p.erp.find((x) => x.type === t)!.status === 'confirmed');
              return (
                <tr key={type}>
                  <td className="align-top">
                    <p className="font-medium text-ink"><span className="mr-2 font-mono text-[15px] font-normal text-muted">{String(idx + 1).padStart(2, '0')}</span>{meta.label}</p>
                    <p className="mt-0.5 pl-[30px] text-[16px] text-muted">{meta.hint}</p>
                  </td>
                  <td className="align-top"><Tag tone={m.status === 'confirmed' ? 'success' : 'warning'}>{m.status === 'confirmed' ? 'Confirmed' : 'Pending'}</Tag></td>
                  <td className="nowrap align-top font-mono">{m.status === 'confirmed' && m.dataManRef ? m.dataManRef : '—'}</td>
                  <td className="align-top text-[15px]">
                    {m.status === 'confirmed' ? (
                      <>
                        {m.confirmedBy} · <span className="font-mono text-[15px]">{formatDateTime(m.confirmedAt)}</span>
                        {m.erpOccurredAt && <div className="text-muted">DataMan time: <span className="font-mono text-[15px]">{formatDateTime(m.erpOccurredAt)}</span></div>}
                        {m.note && <div className="text-ink-soft">{m.note}</div>}
                      </>
                    ) : canConfirm && tracked && !prevOk ? <span className="text-muted">After “{erpMilestoneMeta[ERP_ORDER[idx - 1] ?? m.type].short}”</span> : '—'}
                  </td>
                  {tracked && canDo(type) && (
                    <td className="w-0 text-right align-top">
                      {m.status === 'pending'
                        ? <Button size="sm" variant="secondary" disabled={!prevOk || !!w.busy} onClick={() => open(type, 'confirm')} title={prevOk ? undefined : 'Confirm the previous milestone first'}>Confirm</Button>
                        : <Button size="sm" variant="ghost" className="!text-problem hover:!decoration-problem" disabled={nextConfirmed || !!w.busy} onClick={() => open(type, 'reverse')} title={nextConfirmed ? 'Reverse the later milestone first' : undefined}>Reverse</Button>}
                    </td>
                  )}
                  {tracked && !canDo(type) && <td className="w-0" />}
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableWrap>

      {tracked && p.erp[0]?.status === 'pending' && (
        <div className="mt-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-[16px] font-semibold">Plant Head reminders <span className="font-normal text-muted">· logged here only, nothing is sent</span></p>
            {(canDo('plant_head_grn_approval')) && <Button size="sm" variant="ghost" onClick={() => { setRemindNote(''); w.setError(null); setRemind(true); }}>Log reminder</Button>}
          </div>
          {p.reminders.length > 0 && (
            <ul className="mt-2 border-t border-rule text-[15px]">
              {p.reminders.slice().reverse().map((r) => <li key={r.id} className="border-b border-rule py-2"><span className="font-mono text-[15px] text-muted">{formatDateTime(r.sentAt)}</span> · {r.sentBy}{r.note ? ` — ${r.note}` : ''}</li>)}
            </ul>
          )}
        </div>
      )}

      <FormDialog open={!!dlg} title={dlg ? `${dlg.action === 'confirm' ? 'Confirm' : 'Reverse'}: ${erpMilestoneMeta[dlg.type].short}` : ''}
        confirmLabel={dlg?.action === 'reverse' ? 'Reverse milestone' : 'Confirm milestone'} danger={dlg?.action === 'reverse'} busy={!!w.busy} onCancel={() => setDlg(null)} onConfirm={save}>
        <WriteError error={w.error?.code === 'VALIDATION_FAILED' && Object.keys(errs ?? {}).length ? null : w.error} />
        {dlg?.action === 'confirm' ? (
          <>
            <TextField label={erpMilestoneMeta[dlg.type].refLabel} required={dlg.type !== 'final_posting'} mono value={ref} maxLength={40} onChange={(e) => setRef(e.target.value)} error={errs.dataManRef}
              hint="Exactly as DataMan shows it." autoComplete="off" />
            <TextField label="When it happened in DataMan (IST)" type="datetime-local" value={at} max={toIstInput()} onChange={(e) => setAt(e.target.value)} error={errs.erpOccurredAt}
              hint="Optional. The system also records its own time." />
            <TextAreaField label="Note" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} error={errs.note} />
            <CheckboxField checked={verified} onChange={setVerified} error={errs.verifiedInDataManByStaff}>I checked this in DataMan myself.</CheckboxField>
          </>
        ) : (
          <TextAreaField label="Reason for reversing" required rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} error={errs.note}
            hint="The earlier confirmation stays in the history." />
        )}
      </FormDialog>
      <FormDialog open={remind} title="Log a Plant Head reminder?" confirmLabel="Log reminder" busy={!!w.busy} onCancel={() => setRemind(false)} onConfirm={sendReminder}>
        <p>This records that a reminder is due. It does not send an email, SMS or WhatsApp message.</p>
        <WriteError error={w.error} />
        <TextAreaField label="Note" rows={2} maxLength={300} value={remindNote} onChange={(e) => setRemindNote(e.target.value)} />
      </FormDialog>
      <Note className="mt-4">The milestone list is pending KPMPL confirmation.</Note>
    </Card>
  );
}

export function PackageFacts({ p }: { p: DocumentPackageView }) {
  return (
    <dl className={kvGrid}>
      <ReadOnlyItem label="Supplier" value={p.supplierDisplayName} />
      <ReadOnlyItem label="Invoice No." value={p.invoiceRef ?? '—'} mono />
      <ReadOnlyItem label="Sent by" value={p.submittedBy ?? 'Not sent yet'} />
      <ReadOnlyItem label="Sent on" value={p.submittedAt ? <span className="font-mono">{formatDateTime(p.submittedAt)}</span> : '—'} />
    </dl>
  );
}

export function ChecklistNotice() {
  return (
    <Note>Attach each document or mark it not applicable before sending. The document list is pending KPMPL confirmation.</Note>
  );
}
