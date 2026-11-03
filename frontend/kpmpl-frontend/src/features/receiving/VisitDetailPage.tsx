import { useLocation, useParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { can } from '../../auth/permissions';
import { ButtonLink } from '../../components/ui/Button';
import { Alert } from '../../components/ui/States';
import { api } from '../../api';
import { useAsync } from '../../hooks/useAsync';
import { deriveNet, formatDecimal } from '../../domain/decimal';
import { formatDateTime } from '../../lib/format';
import { PageHeader, ReadOnlyItem, Section, kvGrid } from '../../components/ui/Layout';
import { ErrorState, LoadingState } from '../../components/ui/States';
import { ExitTag, GrnTag, QcTag, VisitStatusTags } from '../../components/ui/StatusTag';
import { Timeline } from '../../components/ui/Timeline';
import { NoDeductionNotice, QcHistory } from '../qc/QcReadings';

const kg = (q: { value: string; unit: string } | null) => (q ? formatDecimal(q.value) : null);

/** Receiving entry detail — one shared record viewed by every permitted role. */
export function VisitDetailPage() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const notice = (useLocation().state as { notice?: string } | null)?.notice;
  const { state, reload } = useAsync(async () => {
    const [visit, inspection, timeline] = await Promise.all([api.getVisit(id), api.getQcInspection(id).catch(() => null), api.getTimeline(id)]);
    return { visit, inspection, timeline };
  }, [id]);
  const crumbs = [{ label: 'Receiving Register', to: '/receiving' }, { label: 'Entry' }];

  if (state.status === 'loading' && !state.data) return <><PageHeader title="Receiving entry" crumbs={crumbs} /><LoadingState /></>;
  if (state.status === 'error') return <><PageHeader title="Receiving entry" crumbs={crumbs} /><ErrorState error={state.error} onRetry={reload} /></>;
  const { visit: v, inspection, timeline } = state.data!;
  const net = deriveNet(v.grossWeight, v.tareWeight);
  const submitted = inspection?.revisions.filter((r) => r.state === 'submitted').at(-1);

  const fu = can(user, 'gate.followup');
  return (
    <>
      <PageHeader mono title={v.officialGateEntryRef} crumbs={[{ label: 'Receiving Register', to: '/receiving' }, { label: v.officialGateEntryRef }]}
        status={<VisitStatusTags qc={v.qcStatus} exit={v.exitStatus} grn={v.grnStatus} />}
        description={<><span className="font-mono text-ink">{v.vehicleNumber}</span> · {v.supplierDisplayName} · {v.materialDisplayName}</>}
        actions={<>
          {can(user, 'receiving.edit') && v.exitStatus === 'on_premises' && <ButtonLink to={`/receiving/${v.id}/correct`} variant="ghost">Correct details</ButtonLink>}
          {can(user, 'qc.measure') && ['pending', 'in_progress', 'returned', 'submitted'].includes(v.qcStatus) && <ButtonLink to={`/qc/inspect/${v.id}`} variant={fu ? 'ghost' : 'primary'}>{v.qcStatus === 'submitted' ? (can(user, 'qc.decide') ? 'Record QC decision' : 'View QC') : 'Open QC inspection'}</ButtonLink>}
          {fu && <ButtonLink to={`/gate/follow-up/${v.id}`}>Tare, exit, GRN</ButtonLink>}
        </>} />
      {notice && <Alert tone="success" className="mb-8">{notice}</Alert>}

      <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-14">
        <div className="flex min-w-0 flex-col gap-11">
          <Section title="Where it stands">
            <ul className="border-t border-rule">
              {[
                { stage: 'QC', tag: <QcTag s={v.qcStatus} />, detail: submitted ? <>Latest submitted: revision <span className="font-mono">{submitted.revision}</span></> : 'No readings submitted' },
                { stage: 'Exit', tag: <ExitTag s={v.exitStatus} />, detail: v.physicalExitAt ? <>Out at <span className="font-mono">{formatDateTime(v.physicalExitAt)}</span></> : 'Truck inside' },
                { stage: 'GRN (DataMan)', tag: <GrnTag s={v.grnStatus} />, detail: v.officialGrnRef ? <>GRN No. <span className="font-mono text-ink">{v.officialGrnRef}</span>, entered by staff</> : 'Not entered yet' },
              ].map((r) => (
                <li key={r.stage} className="grid grid-cols-[128px_minmax(0,1fr)] gap-x-4 gap-y-0.5 border-b border-rule py-2.5 sm:grid-cols-[160px_190px_minmax(0,1fr)]">
                  <span className="text-[15px] text-muted">{r.stage}</span>
                  <span>{r.tag}</span>
                  <span className="col-start-2 text-[15px] text-ink-soft sm:col-start-auto">{r.detail}</span>
                </li>
              ))}
            </ul>
          </Section>

          <Section title="Gate entry">
            <dl className={kvGrid}>
              <ReadOnlyItem label="Gate Entry No." value={v.officialGateEntryRef} mono />
              <ReadOnlyItem label="Vehicle No." value={v.vehicleNumber} mono />
              <ReadOnlyItem label="Supplier" value={v.supplierDisplayName} />
              <ReadOnlyItem label="Material" value={v.materialDisplayName} />
              <ReadOnlyItem label="Challan No." value={v.challanRef ?? '—'} mono />
              <ReadOnlyItem label="PO No." value={v.poRef ?? '—'} mono />
              <ReadOnlyItem label="Arrival time" value={v.arrivedAt ? <span className="font-mono">{formatDateTime(v.arrivedAt)}</span> : 'Not recorded'} />
              <ReadOnlyItem label="Entered by" value={<>{v.createdBy} · <span className="font-mono text-[15px]">{formatDateTime(v.createdAt)}</span></>} />
              {v.notes && <ReadOnlyItem label="Remarks" value={v.notes} />}
            </dl>
          </Section>

          <Section title="Weighment">
            <dl className={kvGrid}>
              <ReadOnlyItem label="Gross Wt (kg)" value={kg(v.grossWeight) ?? 'Not recorded'} mono={!!v.grossWeight} />
              <ReadOnlyItem label="Tare Wt (kg)" value={kg(v.tareWeight) ?? 'Not recorded'} mono={!!v.tareWeight} />
              <ReadOnlyItem label="Net Wt (kg)" value={net ? formatDecimal(net) : '—'} mono={!!net} />
            </dl>
          </Section>

          <Section title="QC readings">
            {inspection && (inspection.revisions.length || inspection.reviews.length)
              ? <QcHistory inspection={inspection} />
              : <p className="border-t border-rule py-3 text-[16px] text-muted">No QC readings yet.</p>}
            <div className="mt-4"><NoDeductionNotice /></div>
          </Section>
        </div>

        <Section title="History">
          <Timeline events={timeline} />
        </Section>
      </div>
    </>
  );
}
