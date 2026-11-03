import { Fragment, type ReactNode } from 'react';
import type { Tone } from '../../domain/status';
import { exitStatusMeta, grnStatusMeta, qcStatusMeta } from '../../domain/status';
import type { ExitStatus, GrnStatus, QcStatus } from '../../domain/types';
import { cn } from './cn';
import { StatusChip, toUiTone } from './StatusChip';

/** Status chip using the one shared tone mapping (see StatusChip). */
export function Tag({ tone, children, title, className }: { tone: Tone; children: ReactNode; title?: string; className?: string }) {
  return <span title={title} className={className}><StatusChip tone={toUiTone[tone]} size="sm">{children}</StatusChip></span>;
}

export const QcTag = ({ s }: { s: QcStatus }) => <Tag tone={qcStatusMeta[s].tone}>{qcStatusMeta[s].label}</Tag>;
export const ExitTag = ({ s }: { s: ExitStatus }) => <Tag tone={exitStatusMeta[s].tone}>{exitStatusMeta[s].label}</Tag>;
export const GrnTag = ({ s }: { s: GrnStatus }) => <Tag tone={grnStatusMeta[s].tone}>{grnStatusMeta[s].label}</Tag>;

/** Three independent statuses on one line, never merged: "QC submitted · On premises · GRN pending". */
export function VisitStatusTags({ qc, exit, grn, className }: { qc: QcStatus; exit: ExitStatus; grn: GrnStatus; className?: string }) {
  return <StatusLine className={className} items={[<QcTag key="q" s={qc} />, <ExitTag key="e" s={exit} />, <GrnTag key="g" s={grn} />]} />;
}

export function StatusLine({ items, className }: { items: ReactNode[]; className?: string }) {
  return (
    <span className={cn('inline-flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[16px]', className)}>
      {items.map((it, i) => (
        <Fragment key={i}>
          {i > 0 && <span aria-hidden className="text-field">·</span>}
          {it}
        </Fragment>
      ))}
    </span>
  );
}
