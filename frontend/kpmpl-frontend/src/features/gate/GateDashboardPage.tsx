import { Fragment, useMemo, type ReactNode } from 'react';
import { api } from '../../api';
import { useAsync } from '../../hooks/useAsync';
import { useAuth } from '../../auth/AuthContext';
import { can } from '../../auth/permissions';
import type { ReceivingVisit } from '../../domain/types';
import { ButtonLink } from '../../components/ui/Button';
import { CountLink, PageHeader, Section, TodoList, ViewLink, type TodoItem } from '../../components/ui/Layout';
import { EmptyState, ErrorState, LoadingState, Note } from '../../components/ui/States';
import { isToday } from '../../lib/format';
import { VisitList } from '../receiving/VisitList';
import { gateViews, type GateViewKey } from '../receiving/views';

const dayName = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const tiles: GateViewKey[] = ['awaiting_qc', 'qc_returned', 'ready_follow_up', 'exited_grn_pending'];
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** "Record tare for DEMO-GATE-0002" or "… for DEMO-GATE-0002, DEMO-GATE-0004 and 2 more". */
function refsText(vs: ReceivingVisit[]): ReactNode {
  const shown = vs.slice(0, 2);
  return (
    <>
      {shown.map((v, i) => (
        <Fragment key={v.id}>{i > 0 && (i === vs.length - 1 ? ' and ' : ', ')}<span className="whitespace-nowrap font-mono text-[15px]">{v.officialGateEntryRef}</span></Fragment>
      ))}
      {vs.length > 2 && ` and ${vs.length - 2} more`}
    </>
  );
}

/** Gate landing: one sentence on today, then what is waiting on the gate, then the latest entries. */
export function GateDashboardPage() {
  const { user } = useAuth();
  const counts = useAsync(async () => {
    const res = await Promise.all(tiles.map((t) => api.listVisits({ ...gateViews[t].query, pageSize: 1 })));
    return Object.fromEntries(tiles.map((t, i) => [t, res[i]?.total ?? 0])) as Record<GateViewKey, number>;
  }, []);
  const recent = useAsync(() => api.listVisits({ pageSize: 8 }), []);
  // Same grouping as the Tare / Exit / GRN list, read from existing records.
  const all = useAsync(() => api.listVisits({ pageSize: 500 }), []);

  const todo = useMemo(() => {
    const vs = all.state.data?.data;
    if (!vs) return null;
    const fu = can(user, 'gate.followup');
    const byAge = (a: ReceivingVisit, b: ReceivingVisit) => a.createdAt.localeCompare(b.createdAt);
    const needsTare = vs.filter((v) => v.exitStatus === 'on_premises' && !v.tareWeight).sort(byAge);
    const readyExit = vs.filter((v) => v.exitStatus === 'on_premises' && !!v.tareWeight).sort(byAge);
    const returned = vs.filter((v) => v.qcStatus === 'returned').sort(byAge);
    const grn = vs.filter((v) => v.exitStatus === 'exited' && v.grnStatus === 'not_recorded').sort(byAge);
    const one = (list: ReceivingVisit[], fuPath: boolean, listPath: string | undefined) =>
      list.length === 1 && list[0] ? (fuPath && fu ? `/gate/follow-up/${list[0].id}` : `/receiving/${list[0].id}`) : listPath;
    const items: (TodoItem | false)[] = [
      needsTare.length > 0 && { key: 'tare', count: needsTare.length, text: <>Record tare for {refsText(needsTare)}</>,
        to: one(needsTare, true, fu ? '/gate/follow-up?tab=needs_tare' : undefined), linkLabel: 'Open trucks waiting for tare' },
      readyExit.length > 0 && { key: 'exit', count: readyExit.length, text: <>Record exit for {refsText(readyExit)}</>,
        to: one(readyExit, true, fu ? '/gate/follow-up?tab=ready_exit' : undefined), linkLabel: 'Open trucks waiting to exit' },
      grn.length > 0 && { key: 'grn', count: grn.length, text: <>Enter the GRN No. for {refsText(grn)}</>,
        to: one(grn, true, '/receiving?view=exited_grn_pending'), linkLabel: 'Open trucks without a GRN No.' },
      returned.length > 0 && { key: 'ret', count: returned.length, text: <>{refsText(returned)} sent back to QC for correction</>,
        to: one(returned, false, '/receiving?view=qc_returned'), linkLabel: 'Open trucks returned by QC' },
    ];
    return { items: items.filter(Boolean) as TodoItem[], today: vs.filter((v) => isToday(v.createdAt)).length };
  }, [all.state.data, user]);

  const c = counts.state.status === 'success' ? counts.state.data : null;
  const parts = c ? ([
    ['awaiting_qc', c.awaiting_qc, 'waiting for QC', false],
    ['qc_returned', c.qc_returned, 'returned by QC', false],
    ['ready_follow_up', c.ready_follow_up, 'ready for tare or exit', true],
    ['exited_grn_pending', c.exited_grn_pending, 'out without a GRN', true],
  ] as const).filter(([, n]) => n > 0) : [];

  return (
    <>
      <PageHeader crumbs={[{ label: 'Home', to: '/home' }]}
        title="Gate"
        description={dayName.format(new Date())}
        actions={<>
          {can(user, 'gate.followup') && <ButtonLink to="/gate/follow-up" variant="ghost">Tare, exit, GRN</ButtonLink>}
          <ButtonLink to="/receiving/new">New receiving</ButtonLink>
        </>}
      />

      <section aria-label="Today" className="mb-12 max-w-4xl">
        {todo && c ? (
          <p className="text-[20px] leading-[1.6] tracking-[-0.005em] text-ink sm:text-[22px]">
            Today: <CountLink n={todo.today} to="/receiving">{plural(todo.today, 'truck', 'trucks')} in</CountLink>.{' '}
            {parts.length === 0 ? 'Nothing waiting.' : parts.map(([k, n, label, mine], i) => (
              <Fragment key={k}>
                <CountLink n={n} to={`/receiving?view=${k}`} signal={mine}>{label}</CountLink>
                {i < parts.length - 1 ? ', ' : '.'}
              </Fragment>
            ))}
          </p>
        ) : counts.state.status === 'error' ? (
          <p className="text-[16px] text-problem">Counts could not be loaded. <button type="button" className="act" onClick={counts.reload}>Try again</button></p>
        ) : <LoadingState className="py-2" />}
      </section>

      <div className="flex flex-col gap-12">
        <Section title="To do">
          {all.state.status === 'error' && <ErrorState error={all.state.error} onRetry={all.reload} />}
          {all.state.status !== 'error' && (todo ? <TodoList items={todo.items} /> : <LoadingState />)}
        </Section>
        <Section title="Latest entries" actions={<ViewLink to="/receiving">Full register</ViewLink>}>
          {recent.state.status === 'loading' && !recent.state.data && <LoadingState />}
          {recent.state.status === 'error' && <ErrorState error={recent.state.error} onRetry={recent.reload} />}
          {recent.state.status === 'success' && (recent.state.data.data.length
            ? <VisitList visits={recent.state.data.data} />
            : <EmptyState title="No trucks recorded yet." action={<ViewLink to="/receiving/new">New receiving</ViewLink>} />)}
        </Section>
      </div>
      <Note className="mt-8">Counts come from this system, not from DataMan.</Note>
    </>
  );
}
