import { api } from '../../api';
import { useAsync } from '../../hooks/useAsync';
import { useAuth } from '../../auth/AuthContext';
import { can } from '../../auth/permissions';
import { Card, TextButton } from '../../components/ui/Layout';
import { TruckCard, TruckCardList, actorsFor } from '../../components/truck/TruckCard';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States';

/**
 * Trucks recorded at the Gate whose documents have not yet reached Head Office.
 * Shown on the Document Packages page (to start a package) and read-only on the Head Office Inbox,
 * so every role sees new Gate entries as soon as they are saved.
 */
export function GateArrivals({ mode }: { mode: 'gate' | 'ho' }) {
  const { user } = useAuth();
  const { state, reload } = useAsync(async () => {
    const [visits, pkgs] = await Promise.all([api.listVisits({ pageSize: 500 }), api.listPackages(mode)]);
    const sent = new Set(pkgs.filter((p) => !['draft', 'ready_for_gate_check'].includes(p.status)).flatMap((p) => p.visitIds));
    const inPkg = new Map(pkgs.flatMap((p) => p.visitIds.map((id) => [id, p] as const)));
    return visits.data.filter((v) => !sent.has(v.id)).map((v) => ({ v, pkg: inPkg.get(v.id) }));
  }, []);
  const rows = state.data ?? [];
  const canStart = can(user, 'docs.prepare');
  const canView = can(user, 'receiving.view');
  const actors = actorsFor(user);
  return (
    <Card as="div" title={mode === 'gate' ? 'Trucks from the gate' : 'Still at the gate'}
      subtitle={mode === 'gate' ? 'Not yet sent to Head Office. Start one package per supplier invoice.' : 'Papers not sent yet. The Gate makes these packages; shown here for information.'}
      actions={<TextButton onClick={reload}>Refresh</TextButton>}>
      {state.status === 'loading' && !state.data && <LoadingState />}
      {state.status === 'error' && <ErrorState error={state.error} onRetry={reload} />}
      {state.data && state.status !== 'error' && (rows.length === 0 ? <EmptyState title="Nothing waiting at the gate." /> : (
        <TruckCardList>
          {rows.map(({ v, pkg }) => (
            <li key={v.id}>
              <TruckCard v={v} actors={actors} to={canStart ? (pkg ? `/documents/${pkg.id}` : `/documents/new?visit=${v.id}`) : canView ? `/receiving/${v.id}` : undefined}
                chip={pkg ? { tone: 'waiting', label: `In ${pkg.packageRef} · not sent` } : canStart ? { tone: 'action', label: 'No package yet' } : undefined}
                action={canStart ? (pkg ? 'Open package' : 'Start package') : undefined}
                extra={v.officialGrnRef ? <p className="text-[15px] text-ink-soft">GRN <span className="font-mono">{v.officialGrnRef}</span></p> : undefined} />
            </li>
          ))}
        </TruckCardList>
      ))}
    </Card>
  );
}
