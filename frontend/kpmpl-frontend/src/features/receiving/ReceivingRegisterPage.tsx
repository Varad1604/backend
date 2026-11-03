import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../api';
import { useAsync } from '../../hooks/useAsync';
import { useAuth } from '../../auth/AuthContext';
import { can } from '../../auth/permissions';
import { ListCard, ListToolbar, PageHeader, TextButton, ViewLink } from '../../components/ui/Layout';
import { ButtonLink } from '../../components/ui/Button';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States';
import { Tabs } from '../../components/ui/Tabs';
import { SearchBox } from '../../components/ui/SearchBox';
import { VisitList } from './VisitList';
import { gateViews, isGateViewKey, type GateViewKey } from './views';

/** Receiving Register — search by Gate Entry No., vehicle or supplier. */
export function ReceivingRegisterPage() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const view: GateViewKey = isGateViewKey(params.get('view')) ? (params.get('view') as GateViewKey) : 'all';
  const search = params.get('q') ?? '';
  const [draft, setDraft] = useState(search);
  useEffect(() => setDraft(search), [search]);

  // Debounced search so typing a vehicle number filters without extra clicks.
  useEffect(() => {
    const t = setTimeout(() => {
      if (draft !== search) setParams((p) => { if (draft) p.set('q', draft); else p.delete('q'); return p; }, { replace: true });
    }, 300);
    return () => clearTimeout(t);
  }, [draft, search, setParams]);

  const { state, reload } = useAsync(() => api.listVisits({ ...gateViews[view].query, search }), [view, search]);
  // Count per filter, read with the same queries (one row each, only the total is used).
  const keys = Object.keys(gateViews) as GateViewKey[];
  const counts = useAsync(async () => {
    const res = await Promise.all(keys.map((k) => api.listVisits({ ...gateViews[k].query, search, pageSize: 1 })));
    return Object.fromEntries(keys.map((k, i) => [k, res[i]?.total ?? 0])) as Record<GateViewKey, number>;
  }, [search, state.data]);

  const setView = (k: GateViewKey) => setParams((p) => { if (k === 'all') p.delete('view'); else p.set('view', k); return p; });

  return (
    <>
      <PageHeader
        title="Receiving Register"
        actions={can(user, 'receiving.create') && <ButtonLink to="/receiving/new">New receiving</ButtonLink>}
      />

      <ListCard>
        <ListToolbar>
          <Tabs label="Filter by status" active={view} onSelect={setView}
            items={keys.map((k) => ({ key: k, label: gateViews[k].label, count: counts.state.data ? counts.state.data[k] : null }))} />
          <div className="flex flex-wrap items-end gap-x-5 gap-y-2 pb-1 lg:pb-0">
            <SearchBox id="register-search" value={draft} onChange={setDraft} label="Search by Gate Entry No., vehicle or supplier" />
            {state.data && state.status !== 'error' && (
              <span className="flex items-baseline gap-4 whitespace-nowrap pb-2.5 text-[15px] text-muted" aria-live="polite">
                <span><span className="font-mono">{state.data.total}</span> shown{state.status === 'loading' ? ', updating…' : ''}</span>
                <TextButton onClick={reload}>Refresh</TextButton>
              </span>
            )}
          </div>
        </ListToolbar>

        {state.status === 'loading' && !state.data && <LoadingState />}
        {state.status === 'error' && <ErrorState error={state.error} onRetry={reload} />}
        {state.data && state.status !== 'error' && (
          state.data.data.length === 0 ? (
            <EmptyState
              title={search ? 'No records match this search.' : view === 'all' ? 'No trucks recorded yet.' : 'No trucks in this list.'}
              action={search ? <TextButton onClick={() => setDraft('')}>Clear search</TextButton>
                : view === 'all' && can(user, 'receiving.create') ? <ViewLink to="/receiving/new">New receiving</ViewLink> : undefined}
            />
          ) : <VisitList visits={state.data.data} />
        )}
      </ListCard>
    </>
  );
}
