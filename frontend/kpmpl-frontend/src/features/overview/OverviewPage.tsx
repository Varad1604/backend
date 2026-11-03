import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, toApiError, type ApiError } from '../../api';
import { useAsync } from '../../hooks/useAsync';
import { useAuth } from '../../auth/AuthContext';
import { can } from '../../auth/permissions';
import type { ReceivingVisit } from '../../domain/types';
import { CountLink, PageHeader, Section, TextButton, TodoList, type TodoItem } from '../../components/ui/Layout';
import { ErrorState, LoadingState, Note } from '../../components/ui/States';
import { WriteError } from '../../components/ui/WriteError';
import { TruckCard, TruckCardList, actorsFor } from '../../components/truck/TruckCard';
import { downloadBlob, formatTime, relativeAge } from '../../lib/format';
import { cn } from '../../components/ui/cn';

type Stat = { label: string; value: number; to?: string; warn?: boolean };

function StatGroup({ title, stats }: { title: string; stats: Stat[] }) {
  return (
    <Section title={title}>
      <ul className="border-t border-rule">
        {stats.map((s) => (
          <li key={s.label} className="flex min-h-10 items-baseline justify-between gap-3 border-b border-rule py-2 text-[16px]">
            {s.to ? <Link to={s.to} className="lnk">{s.label}</Link> : <span className="text-ink-soft">{s.label}</span>}
            <span className={cn('font-mono font-medium', s.warn && s.value > 0 ? 'text-signal' : 'text-ink')}>{s.value}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function MiniList({ title, rows, empty, when }: { title: string; rows: ReceivingVisit[]; empty: string; when: (v: ReceivingVisit) => string }) {
  const { user } = useAuth();
  const linkable = can(user, 'receiving.view');
  return (
    <Section title={title}>
      {rows.length === 0 ? <p className="border-t border-rule py-3 text-[16px] text-muted">{empty}</p> : (
        <TruckCardList>
          {rows.map((v) => (
            <li key={v.id}><TruckCard v={v} actors={actorsFor(user)} to={linkable ? `/receiving/${v.id}` : undefined} extra={<p className="text-[15px] text-muted">{when(v)}</p>} /></li>
          ))}
        </TruckCardList>
      )}
    </Section>
  );
}

/** Operations overview — plain counts and short lists. */
export function OverviewPage() {
  const { user } = useAuth();
  const { state, reload } = useAsync(() => api.getOverview(), []);
  const canRegister = can(user, 'receiving.view');
  const link = (to: string) => (canRegister ? to : undefined);

  const [csvError, setCsvError] = useState<ApiError | null>(null);
  const [csvBusy, setCsvBusy] = useState(false);
  /** http: server CSV (GET /reports/receiving.csv, brief §5.5). mock: same columns, built in the browser. */
  async function exportCsv() {
    if (csvBusy) return;
    setCsvBusy(true);
    setCsvError(null);
    try {
      const { filename, blob } = await api.exportReceivingCsv();
      downloadBlob(filename, blob);
    } catch (e) {
      setCsvError(toApiError(e));
    } finally {
      setCsvBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Operations Overview"
        actions={<>
          <TextButton onClick={reload} className="text-[16px]">Refresh</TextButton>
          {canRegister && <TextButton onClick={exportCsv} className="text-[16px]">{csvBusy ? 'Preparing CSV…' : 'Export CSV'}</TextButton>}
        </>} />
      {state.status === 'loading' && !state.data && <LoadingState />}
      {csvError && <WriteError error={csvError} className="mb-8" />}
      {state.status === 'error' && <ErrorState error={state.error} onRetry={reload} />}
      {state.data && (() => {
        const o = state.data;
        const fu = can(user, 'gate.followup');
        const n = (x: number, one: string, many: string) => `${x} ${x === 1 ? one : many}`;
        const attention = [
          o.qc.awaitingInspection > 0 && { key: 'qc', text: `${n(o.qc.awaitingInspection, 'truck', 'trucks')} waiting for QC inspection`, to: link('/receiving?view=awaiting_qc') },
          o.qc.returned > 0 && { key: 'ret', text: `${n(o.qc.returned, 'QC inspection', 'QC inspections')} returned for correction`, to: link('/receiving?view=qc_returned'), tone: 'bad' as const },
          o.gate.needsTare > 0 && { key: 'tare', text: `${n(o.gate.needsTare, 'truck', 'trucks')} waiting for tare`, to: fu ? '/gate/follow-up?tab=needs_tare' : undefined },
          o.gate.grnPending > 0 && { key: 'grn', text: `${n(o.gate.grnPending, 'truck', 'trucks')} with GRN No. pending`, to: link('/receiving?view=exited_grn_pending') },
          o.documents.correctionRequested > 0 && { key: 'doc', text: `${n(o.documents.correctionRequested, 'document package', 'document packages')} with a correction requested`, to: can(user, 'docs.prepare') ? '/documents?tab=fix' : can(user, 'ho.inbox') ? '/head-office?tab=fix' : undefined, tone: 'bad' as const },
          o.erp.approvalPending > 0 && { key: 'erp', text: `${n(o.erp.approvalPending, 'package', 'packages')} waiting for Plant Head approval`, to: can(user, 'ho.inbox') ? '/erp-milestones' : undefined },
        ].filter(Boolean) as { key: string; text: string; to?: string; tone?: 'bad' }[];
        const todo: TodoItem[] = attention.map((a) => ({ key: a.key, count: Number(a.text.split(' ')[0]), text: a.text.replace(/^\d+ /, ''), to: a.to }));
        return (
          <div className="flex flex-col gap-12">
            <section aria-label="Summary" className="max-w-4xl">
              <p className="text-[20px] leading-[1.6] tracking-[-0.005em] text-ink sm:text-[22px]">
                At <span className="font-mono">{formatTime(o.generatedAt)}</span>:{' '}
                <CountLink n={o.receiving.onPremises} to={link('/receiving')}>{o.receiving.onPremises === 1 ? 'truck' : 'trucks'} on premises</CountLink>,{' '}
                <CountLink n={o.qc.awaitingInspection} to={link('/receiving?view=awaiting_qc')}>waiting for QC</CountLink>,{' '}
                <CountLink n={o.gate.needsTare} to={fu ? '/gate/follow-up?tab=needs_tare' : undefined}>waiting for tare</CountLink>, and{' '}
                <CountLink n={o.documents.withHo} to={can(user, 'ho.inbox') ? '/head-office' : undefined}>{o.documents.withHo === 1 ? 'package' : 'packages'} with Head Office</CountLink>.
              </p>
            </section>
            <Section title="To do"><TodoList items={todo} empty="Nothing is held up right now." /></Section>
            <div className="grid gap-x-10 gap-y-10 md:grid-cols-2 xl:grid-cols-4 xl:items-start">
              <StatGroup title="Receiving" stats={[
                { label: 'Trucks on premises', value: o.receiving.onPremises, to: link('/receiving') },
                { label: 'Recorded today', value: o.receiving.today, to: link('/receiving') },
              ]} />
              <StatGroup title="Quality control" stats={[
                { label: 'Awaiting inspection', value: o.qc.awaitingInspection, warn: true, to: link('/receiving?view=awaiting_qc') },
                { label: 'Draft in progress', value: o.qc.inProgress },
                { label: 'Returned for correction', value: o.qc.returned, warn: true, to: link('/receiving?view=qc_returned') },
                { label: 'Submitted, awaiting QC decision', value: o.qc.awaitingReview },
              ]} />
              <StatGroup title="Gate follow-up" stats={[
                { label: 'Need tare', value: o.gate.needsTare, warn: true, to: can(user, 'gate.followup') ? '/gate/follow-up?tab=needs_tare' : undefined },
                { label: 'Weighed, exit pending', value: o.gate.readyToExit, to: can(user, 'gate.followup') ? '/gate/follow-up?tab=ready_exit' : undefined },
                { label: 'Exited today', value: o.gate.exitedToday },
                { label: 'GRN pending', value: o.gate.grnPending, warn: true, to: link('/receiving?view=exited_grn_pending') },
              ]} />
              <StatGroup title="Documents and ERP" stats={[
                { label: 'Packages being prepared', value: o.documents.draft, to: can(user, 'docs.prepare') ? '/documents' : undefined },
                { label: 'With Head Office', value: o.documents.withHo, to: can(user, 'ho.inbox') ? '/head-office' : undefined },
                { label: 'Correction requested', value: o.documents.correctionRequested, warn: true },
                { label: 'Plant Head approval pending', value: o.erp.approvalPending, warn: true, to: can(user, 'ho.inbox') ? '/erp-milestones' : undefined },
                // Accounting chain (audit KPMPL-002): management sees in-flight and posted work.
                { label: 'In accounting', value: o.documents.withAccounting, to: can(user, 'accounting.inbox') ? '/accounting' : undefined },
                { label: 'Bills posted', value: o.documents.billPosted, to: can(user, 'accounting.inbox') ? '/accounting?tab=posted' : undefined },
              ]} />
            </div>
            <div className="grid gap-x-8 gap-y-10 xl:grid-cols-1">
              <MiniList title="Oldest waiting for QC" rows={o.oldestAwaitingQc} empty="No trucks waiting for QC." when={(v) => `arrived ${relativeAge(v.createdAt)}`} />
              <MiniList title="Longest on premises" rows={o.longestOnPremises} empty="No trucks on premises." when={(v) => `arrived ${relativeAge(v.createdAt)}`} />
              <MiniList title="Exited, GRN pending" rows={o.grnPendingList} empty="No GRN pending." when={(v) => (v.physicalExitAt ? `exited ${relativeAge(v.physicalExitAt)}` : '')} />
            </div>
            <Note>From this system, not DataMan. Report layout pending KPMPL confirmation.</Note>
          </div>
        );
      })()}
    </>
  );
}
