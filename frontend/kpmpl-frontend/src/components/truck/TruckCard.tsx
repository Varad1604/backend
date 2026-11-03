import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Clock } from 'lucide-react';
import type { ReceivingVisit, User } from '../../domain/types';
import { can } from '../../auth/permissions';
import { formatDecimal } from '../../domain/decimal';
import { formatDate, formatTime, isToday } from '../../lib/format';
import { StatusChip, toneClasses, type UiTone } from '../ui/StatusChip';
import { cn } from '../ui/cn';

/** Vehicle number in a number-plate frame. */
export function NumberPlate({ value, className }: { value: string; className?: string }) {
  return <span className={cn('plate text-[17px]', className)}>{value}</span>;
}

export type Actor = 'gate' | 'qc';
export type TruckStage = 'done' | 'needs_grn' | 'rejected' | 'qc_recheck' | 'waiting_qc' | 'waiting_decision' | 'needs_tare' | 'ready_exit';

export const stageLabel: Record<TruckStage, string> = {
  done: 'Complete',
  needs_grn: 'Left mill · enter GRN No.',
  rejected: 'QC rejected',
  qc_recheck: 'QC re-check',
  waiting_qc: 'Waiting for QC',
  waiting_decision: 'Waiting for QC decision',
  needs_tare: 'Weigh empty truck',
  ready_exit: 'Ready to leave',
};

/** Where the truck stands, read from the three independent status fields (no combined status is stored). */
export function truckStage(v: ReceivingVisit): { stage: TruckStage; actor: Actor | null } {
  if (v.exitStatus === 'exited') return v.grnStatus === 'reference_recorded' ? { stage: 'done', actor: null } : { stage: 'needs_grn', actor: 'gate' };
  if (v.qcStatus === 'rejected') return { stage: 'rejected', actor: null };
  if (v.qcStatus === 'returned') return { stage: 'qc_recheck', actor: 'qc' };
  if (v.qcStatus === 'pending' || v.qcStatus === 'in_progress') return { stage: 'waiting_qc', actor: 'qc' };
  if (v.qcStatus === 'submitted') return { stage: 'waiting_decision', actor: 'qc' };
  if (!v.tareWeight) return { stage: 'needs_tare', actor: 'gate' };
  return { stage: 'ready_exit', actor: 'gate' };
}

export function actorsFor(user: User | null): Actor[] {
  const a: Actor[] = [];
  if (can(user, 'gate.followup')) a.push('gate');
  if (can(user, 'qc.measure')) a.push('qc');
  return a;
}

/** Tone for a truck as seen by this user: blue only when the next step is theirs. */
export function truckTone(v: ReceivingVisit, actors: Actor[]): UiTone {
  const { stage, actor } = truckStage(v);
  if (stage === 'done') return 'done';
  if (stage === 'rejected') return 'problem';
  if (actor && actors.includes(actor)) return 'action';
  if (stage === 'qc_recheck') return 'problem';
  return 'waiting';
}

const when = (iso: string) => (isToday(iso) ? formatTime(iso) : `${formatDate(iso)} · ${formatTime(iso)}`);

/**
 * One truck. Card on phones/tablets; on wide screens the same element lays out as a row
 * (card/table hybrid). Left accent + chip use the shared tone mapping.
 */
export function TruckCard({ v, to, actors, chip, action, extra }: {
  v: ReceivingVisit; to?: string; actors: Actor[];
  /** Override the stage chip (e.g. a QC-only label). */
  chip?: { tone: UiTone; label: ReactNode };
  /** Right-side call to action text, e.g. "Weigh empty truck". */
  action?: ReactNode;
  extra?: ReactNode;
}) {
  const tone = chip?.tone ?? truckTone(v, actors);
  const label = chip?.label ?? stageLabel[truckStage(v).stage];
  const body = (
    <div className={cn('grid gap-x-6 gap-y-2 rounded-xl border border-rule border-l-[6px] bg-surface p-4 shadow-sm transition-colors',
      'lg:grid-cols-[minmax(220px,auto)_minmax(0,1fr)_auto] lg:items-center', toneClasses[tone].accent,
      to && 'group-hover:border-brand-600 group-hover:shadow-md')}>
      <div className="flex min-w-0 flex-col gap-1.5">
        <NumberPlate value={v.vehicleNumber} className="self-start" />
        <span className="font-mono text-[15px] text-muted">{v.officialGateEntryRef}</span>
      </div>
      <div className="min-w-0 text-[16px]">
        <p className="truncate font-semibold text-ink">{v.supplierDisplayName}</p>
        <p className="flex flex-wrap items-center gap-x-3 text-[15px] text-muted">
          <span>{v.materialDisplayName}</span>
          {v.grossWeight && <span className="font-mono">{formatDecimal(v.grossWeight.value)} kg</span>}
          <span className="inline-flex items-center gap-1"><Clock aria-hidden size={15} strokeWidth={1.75} />{when(v.createdAt)}</span>
        </p>
        {extra}
      </div>
      <div className="flex flex-wrap items-center gap-3 lg:justify-end">
        <StatusChip tone={tone}>{label}</StatusChip>
        {action && <span className="text-[16px] font-semibold text-brand-700 group-hover:underline">{action} <span aria-hidden>→</span></span>}
      </div>
    </div>
  );
  if (!to) return body;
  return <Link to={to} className="group block rounded-xl focus-visible:outline-3 focus-visible:outline-offset-2" aria-label={`${v.officialGateEntryRef} ${v.vehicleNumber}`}>{body}</Link>;
}

export function TruckCardList({ children }: { children: ReactNode }) {
  return <ul className="flex flex-col gap-3">{children}</ul>;
}
