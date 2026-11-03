import type { ReceivingVisit } from '../../domain/types';
import { useAuth } from '../../auth/AuthContext';
import { TruckCard, TruckCardList, actorsFor } from '../../components/truck/TruckCard';

/** Receiving register: colour-coded truck cards (row layout on wide screens). */
export function VisitList({ visits }: { visits: ReceivingVisit[] }) {
  const { user } = useAuth();
  const actors = actorsFor(user);
  return (
    <TruckCardList>
      {visits.map((v) => <li key={v.id}><TruckCard v={v} actors={actors} to={`/receiving/${v.id}`} /></li>)}
    </TruckCardList>
  );
}
