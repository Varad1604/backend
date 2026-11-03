import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../api';
import { useAsync } from '../../hooks/useAsync';
import type { ReceivingVisit } from '../../domain/types';
import { ListCard, ListToolbar, PageHeader, TextButton } from '../../components/ui/Layout';
import { TruckCard, TruckCardList, actorsFor } from '../../components/truck/TruckCard';
import { useAuth } from '../../auth/AuthContext';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States';
import { Tabs } from '../../components/ui/Tabs';
import { SearchBox } from '../../components/ui/SearchBox';
import { deriveNet, formatDecimal } from '../../domain/decimal';

type Tab = 'needs_tare' | 'ready_exit' | 'grn_pending' | 'completed';

/** Shared with the Home counts so a badge always matches its list. */
// eslint-disable-next-line react-refresh/only-export-components
export const followUpTests: Record<Tab, (v: ReceivingVisit) => boolean> = {
  needs_tare: (v) => v.exitStatus === 'on_premises' && !v.tareWeight,
  ready_exit: (v) => v.exitStatus === 'on_premises' && !!v.tareWeight,
  grn_pending: (v) => !!v.tareWeight && v.grnStatus === 'not_recorded',
  completed: (v) => v.exitStatus === 'exited' && v.grnStatus === 'reference_recorded',
};

/** Grouping uses the three independent fields; nothing is merged into one status. */
const tabs: { key: Tab; label: string; test: (v: ReceivingVisit) => boolean; empty: string }[] = [
  { key: 'needs_tare', label: 'Weigh empty truck', test: followUpTests.needs_tare, empty: 'No trucks waiting to be weighed right now.' },
  { key: 'ready_exit', label: 'Ready to leave', test: followUpTests.ready_exit, empty: 'No trucks waiting to leave right now.' },
  { key: 'grn_pending', label: 'GRN No. missing', test: followUpTests.grn_pending, empty: 'No GRN pending.' },
  { key: 'completed', label: 'Done', test: followUpTests.completed, empty: 'Nothing completed yet.' },
];

function nextStep(v: ReceivingVisit): string {
  if (v.exitStatus === 'on_premises' && !v.tareWeight) return 'Weigh empty truck';
  if (v.exitStatus === 'on_premises' && ['pending', 'in_progress'].includes(v.qcStatus)) return 'Waiting for QC';
  if (v.exitStatus === 'on_premises') return 'Let truck out';
  if (v.grnStatus === 'not_recorded') return 'Enter GRN No.';
  return 'View';
}

const tabJob: Record<Tab, string | null> = { needs_tare: 'tare', ready_exit: 'exit', grn_pending: 'grn', completed: null };

/** Gate follow-up — work list. */
export function FollowUpListPage() {
  const [params, setParams] = useSearchParams();
  const tab = (tabs.find((t) => t.key === params.get('tab'))?.key ?? 'needs_tare');
  const [q, setQ] = useState('');
  const actors = actorsFor(useAuth().user);
  const { state, reload } = useAsync(() => api.listVisits({ pageSize: 500 }), []);

  const counts = useMemo(() => Object.fromEntries(tabs.map((t) => [t.key, (state.data?.data ?? []).filter(t.test).length])), [state.data]);
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    const t = tabs.find((x) => x.key === tab)!;
    return (state.data?.data ?? []).filter(t.test)
      .filter((v) => !s || [v.vehicleNumber, v.officialGateEntryRef, v.supplierDisplayName].some((f) => f.toLowerCase().includes(s)))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }, [state.data, tab, q]);

  return (
    <>
      <PageHeader title="Tare / Exit / GRN" description="Weigh the empty truck, let it out, then enter the GRN No. from DataMan." />
      <ListCard>
        <ListToolbar>
          <Tabs label="Follow-up step" active={tab} onSelect={(k) => setParams((p) => { p.set('tab', k); return p; })}
            items={tabs.map((t) => ({ key: t.key, label: t.label, count: state.data ? counts[t.key] : null }))} />
          <div className="flex items-end gap-5 pb-1 lg:pb-0">
            <SearchBox id="fu-search" value={q} onChange={setQ} label="Find by vehicle, Gate Entry No. or supplier" />
            <TextButton onClick={reload} className="pb-2.5">{state.status === 'loading' ? 'Refreshing…' : 'Refresh'}</TextButton>
          </div>
        </ListToolbar>
        {state.status === 'loading' && !state.data && <LoadingState />}
        {state.status === 'error' && <ErrorState error={state.error} onRetry={reload} />}
        {state.data && state.status !== 'error' && (rows.length === 0
          ? <EmptyState title={q ? 'No matching trucks.' : tabs.find((t) => t.key === tab)!.empty} />
          : (
            <TruckCardList>
              {rows.map((v) => {
                const net = deriveNet(v.grossWeight, v.tareWeight);
                const step = nextStep(v);
                return (
                  <li key={v.id}>
                    <TruckCard v={v} actors={actors} to={`/gate/follow-up/${v.id}${tabJob[tab] ? `?do=${tabJob[tab]}` : ''}`} action={step.startsWith('Waiting') ? undefined : step}
                      extra={(v.tareWeight || v.officialGrnRef) && (
                        <p className="mt-1 flex flex-wrap gap-x-4 text-[15px] text-ink-soft">
                          {v.tareWeight && <span>Empty <span className="font-mono">{formatDecimal(v.tareWeight.value)} kg</span></span>}
                          {net && <span>Net <span className="font-mono font-semibold">{formatDecimal(net)} kg</span></span>}
                          {v.officialGrnRef && <span>GRN <span className="font-mono">{v.officialGrnRef}</span></span>}
                        </p>
                      )} />
                  </li>
                );
              })}
            </TruckCardList>
          ))}
      </ListCard>
    </>
  );
}
