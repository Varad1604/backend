import type { QcInspection, QcReviewNote, QcRevision } from '../../domain/types';
import { formatDate, formatDateTime, formatTime } from '../../lib/format';
import { Tag } from '../../components/ui/StatusTag';

export const measurementLabel: Record<string, string> = { moisture: 'Moisture (%)', impurity: 'Impurity (%)' };

export function RevisionCard({ rev, current }: { rev: QcRevision; current?: boolean }) {
  return (
    <div className="border-b border-rule py-3 text-[15px]">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-semibold text-ink">Revision <span className="font-mono">{rev.revision}</span>{current ? <span className="font-normal text-muted"> · latest</span> : ''}</p>
        <Tag tone={rev.state === 'draft' ? 'warning' : 'neutral'}>{rev.state === 'draft' ? 'Draft' : 'Submitted'}</Tag>
      </div>
      <div className="mt-1.5">
        <dl className="grid max-w-[320px] grid-cols-[1fr_auto] gap-x-6 gap-y-0.5">
          {rev.measurements.map((m) => (
            <div key={m.code} className="contents">
              <dt className="text-muted">{measurementLabel[m.code] ?? m.code}</dt>
              <dd className="text-right font-mono font-medium text-ink">{m.value}</dd>
            </div>
          ))}
        </dl>
        {rev.remarks && <p className="mt-2"><span className="text-muted">Remarks:</span> {rev.remarks}</p>}
        {rev.revisionReason && <p className="mt-1"><span className="text-muted">Reason for revision:</span> {rev.revisionReason}</p>}
        <p className="mt-1.5 text-[16px] text-muted">{rev.recordedBy} · <span className="font-mono text-[15px]">{formatDateTime(rev.recordedAt)}</span></p>
      </div>
    </div>
  );
}

/** Revision + QC decision history, oldest preserved. */
export function QcHistory({ inspection }: { inspection: QcInspection }) {
  const items = [
    ...inspection.revisions.map((r) => ({ at: r.recordedAt, kind: 'rev' as const, r })),
    ...inspection.reviews.map((v) => ({ at: v.recordedAt, kind: 'decision' as const, v })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  const latest = inspection.revisions.at(-1)?.revision;
  return (
    <div className="flex flex-col border-t border-rule">
      {items.map((it, i) => it.kind === 'rev'
        ? <RevisionCard key={`r${i}`} rev={it.r} current={it.r.revision === latest} />
        : <DecisionNoteCard key={`v${i}`} note={it.v} />)}
    </div>
  );
}

export function NoDeductionNotice() {
  return (
    <p className="text-[15px] italic text-muted" role="note">
      <span className="not-italic">Note — </span>No deduction is worked out here. The QC formula is pending KPMPL confirmation.
    </p>
  );
}

export const decisionOutcomeLabel: Record<QcReviewNote['outcome'], string> = {
  returned: 'Returned for correction',
  accepted: 'Accepted',
  accepted_with_deduction: 'Accepted with deduction',
  rejected: 'Rejected',
};

/** One QC decision recorded by the QC Operator (D-03). */
export function DecisionNoteCard({ note }: { note: QcReviewNote }) {
  const bad = note.outcome === 'returned' || note.outcome === 'rejected';
  return (
    <div className="border-b border-rule py-3 text-[15px]">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-semibold text-ink">QC decision on revision <span className="font-mono">{note.forRevision}</span></p>
        <Tag tone={bad ? 'danger' : 'success'}>{decisionOutcomeLabel[note.outcome]}</Tag>
      </div>
      {note.outcome === 'returned' && (
        <p className="mt-1 text-[15px] text-muted">Returned for re-check on {formatDate(note.recordedAt)} at {formatTime(note.recordedAt)} IST. <span lang="mr">पुन्हा तपासणीसाठी परत केले.</span></p>
      )}
      <div className="mt-1.5">
        <p>{note.reason}</p>
        {note.outcome === 'accepted_with_deduction' && <p className="mt-1 text-muted">Deduction amount not calculated. Formula pending KPMPL confirmation.</p>}
        <p className="mt-1.5 text-[16px] text-muted">{note.recordedBy} · <span className="font-mono text-[15px]">{formatDateTime(note.recordedAt)}</span>{note.demonstrationOnly ? ' · demo record' : ''}</p>
      </div>
    </div>
  );
}

/** Compact "what QC said" block for Gate and other readers. */
export function LatestQcSummary({ inspection }: { inspection: QcInspection | null }) {
  const sub = inspection?.revisions.filter((r) => r.state === 'submitted').at(-1);
  const decision = inspection?.reviews.at(-1);
  if (!sub) return <p className="border-t border-rule pt-3 text-[16px] text-muted">QC readings not submitted yet.</p>;
  return (
    <div className="flex flex-col border-t border-rule">
      <RevisionCard rev={sub} current />
      {decision && decision.forRevision === sub.revision && <DecisionNoteCard note={decision} />}
    </div>
  );
}
