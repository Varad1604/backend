import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../api';
import { useAsync } from '../../hooks/useAsync';
import type { QcStatus } from '../../domain/types';
import { ListCard, ListToolbar, PageHeader, TextButton } from '../../components/ui/Layout';
import { TruckCard, TruckCardList, actorsFor } from '../../components/truck/TruckCard';
import { useAuth } from '../../auth/AuthContext';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States';
import { Tabs } from '../../components/ui/Tabs';
import { SearchBox } from '../../components/ui/SearchBox';
import { relativeAge } from '../../lib/format';

const tabs: { key: QcStatus; label: string; empty: string }[] = [
  { key: 'pending', label: 'Pending', empty: 'No trucks waiting for QC right now.' },
  { key: 'in_progress', label: 'Draft', empty: 'No drafts.' },
  { key: 'returned', label: 'Returned', empty: 'Nothing returned for correction.' },
  { key: 'submitted', label: 'Awaiting decision', empty: 'Nothing waiting for a QC decision.' },
];

const action: Record<string, string> = { pending: 'Take sample', in_progress: 'Continue', returned: 'Correct readings', submitted: 'Decide' };

/** QC pending queue. Oldest first so trucks are inspected in arrival order. */
export function QcQueuePage() {
  const [params, setParams] = useSearchParams();
  const tab = (tabs.find((t) => t.key === params.get('tab'))?.key ?? 'pending');
  const [q, setQ] = useState('');
  const actors = actorsFor(useAuth().user);
  const { state, reload } = useAsync(() => api.getQcQueue(), []);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    (state.data ?? []).forEach((i) => { c[i.visit.qcStatus] = (c[i.visit.qcStatus] ?? 0) + 1; });
    return c;
  }, [state.data]);

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (state.data ?? []).filter((i) => i.visit.qcStatus === tab &&
      (!s || [i.visit.vehicleNumber, i.visit.officialGateEntryRef, i.visit.supplierDisplayName].some((f) => f.toLowerCase().includes(s))));
  }, [state.data, tab, q]);

  return (
    <>
      <PageHeader title="QC Queue" description="Oldest truck at the top. Take samples in this order." />
      <ListCard>
        <ListToolbar>
          <Tabs label="QC status" active={tab} onSelect={(k) => setParams((p) => { if (k === 'pending') p.delete('tab'); else p.set('tab', k); return p; })}
            items={tabs.map((t) => ({ key: t.key, label: t.label, count: state.data ? counts[t.key] ?? 0 : null }))} />
          <div className="flex items-end gap-5 pb-1 lg:pb-0">
            <SearchBox id="qc-search" value={q} onChange={setQ} label="Find by vehicle, Gate Entry No. or supplier" />
            <TextButton onClick={reload} className="pb-2.5">{state.status === 'loading' ? 'Refreshing…' : 'Refresh'}</TextButton>
          </div>
        </ListToolbar>
        {state.status === 'loading' && !state.data && <LoadingState />}
        {state.status === 'error' && <ErrorState error={state.error} onRetry={reload} />}
        {state.data && state.status !== 'error' && (rows.length === 0
          ? <EmptyState title={q ? 'No matching trucks.' : tabs.find((t) => t.key === tab)!.empty} />
          : (
            <TruckCardList>
              {rows.map(({ visit: v, latestRevision, lastReturnReason }) => (
                <li key={v.id}>
                  <TruckCard v={v} actors={actors} to={`/qc/inspect/${v.id}`} action={action[v.qcStatus] ?? 'Open'}
                    extra={<>
                      {latestRevision ? <p className="text-[15px] text-muted">Revision <span className="font-mono">{latestRevision}</span> · in {relativeAge(v.createdAt)}</p> : <p className="text-[15px] text-muted">In {relativeAge(v.createdAt)}</p>}
                      {lastReturnReason && <p className="mt-1 text-[15px] font-medium text-problem">Sent back: {lastReturnReason}</p>}
                    </>} />
                </li>
              ))}
            </TruckCardList>
          ))}
      </ListCard>
    </>
  );
}
