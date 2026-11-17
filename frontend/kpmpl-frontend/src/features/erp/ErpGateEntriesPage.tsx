import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../../api';
import type { ErpGateEntry, ErpGateEntryDetail } from '../../domain/types';
import { useAsync } from '../../hooks/useAsync';
import { useAuth } from '../../auth/AuthContext';
import { can } from '../../auth/permissions';
import { formatDate, formatDateTime, formatTime, relativeAge } from '../../lib/format';
import { Card, ListCard, ListToolbar, PageHeader, ReadOnlyItem, TableWrap, TextButton, ViewLink, kvGrid } from '../../components/ui/Layout';
import { Alert, EmptyState, ErrorState, LoadingState, Note } from '../../components/ui/States';
import { Tag } from '../../components/ui/StatusTag';
import { TextField } from '../../components/ui/Field';
import { ButtonLink } from '../../components/ui/Button';
import { emptyListTitle, grnLabel, isErpOutage, reportedFields, weighmentLabel, weightText } from './erpView';

/**
 * DataMan ERP gate entries — READ-ONLY views over the two accepted ERP endpoints
 * (GET /erp/gate-entries, GET /erp/gate-entries/:docId). Requires `erp.read`.
 *
 * Rules enforced here:
 *  - An ERP outage (503) is never rendered as "no records found".
 *  - Only fields the backend actually returns are shown; weights are displayed as ERP
 *    recorded them in kg and are never recomputed.
 *  - Missing weighment/GRN is an explicit state, not an error and not a zero.
 */

function dateText(iso: string | null): string {
  return iso ? formatDate(iso) : '—';
}

/** ERP list + its filters. Pagination is server-side (meta.totalPages). */
export function ErpGateEntriesPage() {
  const { user } = useAuth();
  const [page, setPage] = useState(1);
  const [docIdDraft, setDocIdDraft] = useState('');
  const [vTypeDraft, setVTypeDraft] = useState('');
  const [docId, setDocId] = useState('');
  const [vType, setVType] = useState('');

  const { state, reload } = useAsync(
    () => api.listErpGateEntries({ page, limit: 20, docId: docId || undefined, vType: vType || undefined }),
    [page, docId, vType],
  );

  const applyFilters = () => {
    setPage(1);
    setDocId(docIdDraft.trim());
    setVType(vTypeDraft.trim());
  };

  const clearFilters = () => {
    setDocIdDraft('');
    setVTypeDraft('');
    setDocId('');
    setVType('');
    setPage(1);
  };

  const canRead = can(user, 'erp.read');
  const error = state.status === 'error' ? state.error : null;
  const pageData = state.status === 'success' ? state.data : null;
  const totalPages = pageData?.totalPages ?? 0;

  // Non-ERP roles never reach this route (RequireCap); this is the in-page fallback.
  if (!canRead) {
    return (
      <>
        <PageHeader title="ERP Gate Entries" description="DataMan records — read only" />
        <Alert tone="warning" title="Not permitted">Your account does not have access to DataMan ERP records.</Alert>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="ERP Gate Entries"
        description="DataMan gate entries, weighment and GRN records — read only"
        actions={<ButtonLink to="/erp-milestones" variant="ghost">ERP milestones</ButtonLink>}
      />

      <ListCard>
        <ListToolbar>
          <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
            <TextField
              label="Gate entry DocId"
              value={docIdDraft}
              onChange={(e) => setDocIdDraft(e.target.value)}
              placeholder="Exact GateInOut.DocId"
            />
            <TextField
              label="Voucher type (V_Type)"
              value={vTypeDraft}
              onChange={(e) => setVTypeDraft(e.target.value)}
              placeholder="e.g. PCHLG"
              hint="Exact match. 'PCHLG' is the sampled GRN type; the full value set is not verified."
            />
            <TextButton onClick={applyFilters}>Apply</TextButton>
            {(docId || vType) && <TextButton onClick={clearFilters}>Clear</TextButton>}
          </div>
          <div className="flex items-baseline gap-4 whitespace-nowrap pb-1 text-[15px] text-muted" aria-live="polite">
            {pageData && <span><span className="font-mono">{pageData.total}</span> gate entries</span>}
            <TextButton onClick={reload}>Refresh</TextButton>
          </div>
        </ListToolbar>

        {state.status === 'loading' && !pageData && <LoadingState label="Loading ERP gate entries…" />}
        {error && isErpOutage(error) && (
          <div className="p-4">
            <Alert tone="warning" title="ERP unavailable" role="alert">
              The DataMan ERP data source is temporarily unavailable, so gate entries cannot be loaded.
              This is not an empty result. KPMPL records are unaffected.
            </Alert>
            <div className="mt-3"><TextButton onClick={reload}>Try again</TextButton></div>
          </div>
        )}
        {error && !isErpOutage(error) && <ErrorState error={error} onRetry={reload} />}

        {pageData && !error && (
          pageData.data.length === 0 ? (
            <EmptyState
              title={emptyListTitle(docId, vType)}
              action={docId || vType ? <TextButton onClick={clearFilters}>Clear filters</TextButton> : undefined}
            />
          ) : (
            <>
              <TableWrap>
                <table className="tbl min-w-[960px]">
                  <thead>
                    <tr>
                      <th scope="col">DocId</th>
                      <th scope="col">V_Type</th>
                      <th scope="col">V_No</th>
                      <th scope="col">V_Date</th>
                      <th scope="col">PartyCode</th>
                      <th scope="col">VehicleNo</th>
                      <th scope="col">Gate out</th>
                      <th scope="col" className="num">Gross (kg)</th>
                      <th scope="col" className="num">Tare (kg)</th>
                      <th scope="col" className="num">Net (kg)</th>
                      <th scope="col">Weighment</th>
                      <th scope="col">GRN</th>
                      <th scope="col"><span className="sr-only">Open</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageData.data.map((e: ErpGateEntry) => (
                      <tr key={e.docId}>
                        <td className="font-mono">{e.docId}</td>
                        <td>{e.vType ?? '—'}</td>
                        <td className="font-mono">{e.vNo ?? '—'}</td>
                        <td>{dateText(e.vDate)}</td>
                        <td>{e.partyCode ?? '—'}</td>
                        <td>{e.vehicleNo ?? '—'}</td>
                        <td>{e.gateOutDate ? relativeAge(e.gateOutDate) : 'Not out'}</td>
                        <td className="num">{e.grossWeight?.value ?? '—'}</td>
                        <td className="num">{e.tareWeight?.value ?? '—'}</td>
                        <td className="num">{e.netWeight?.value ?? '—'}</td>
                        <td>{e.hasWeighment ? <Tag tone="success">{weighmentLabel(e)}</Tag> : <Tag tone="neutral">{weighmentLabel(e)}</Tag>}</td>
                        <td>
                          {e.hasGrn
                            ? <Tag tone={e.grnApprovalStatus === 'APPROVED' ? 'success' : 'warning'}>{grnLabel(e)}</Tag>
                            : <Tag tone="neutral">{grnLabel(e)}</Tag>}
                        </td>
                        <td><ViewLink to={`/erp/gate-entries/${encodeURIComponent(e.docId)}`} label={`Open gate entry ${e.docId}`} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>

              <div className="flex items-center justify-between gap-4 px-4 py-3">
                <span className="text-[15px] text-muted" aria-live="polite">
                  Page <span className="font-mono">{pageData.page}</span> of <span className="font-mono">{Math.max(totalPages, 1)}</span>
                  {' · '}<span className="font-mono">{pageData.total}</span> total
                </span>
                <div className="flex items-center gap-4">
                  <button
                    type="button"
                    className="act min-h-10 text-[15px] disabled:opacity-40"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1 || state.status === 'loading'}
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    className="act min-h-10 text-[15px] disabled:opacity-40"
                    onClick={() => setPage((p) => p + 1)}
                    disabled={page >= Math.max(totalPages, 1) || state.status === 'loading'}
                  >
                    Next
                  </button>
                </div>
              </div>
            </>
          )
        )}
      </ListCard>

      <Note>
        Weights are shown exactly as recorded in DataMan (Decimal(12,3), kg); KPMPL does not recompute them.
        A dash means the related record does not exist in ERP.
      </Note>
    </>
  );
}

/** One gate entry with every related weighment and GRN row from ERP. */
export function ErpGateEntryDetailPage() {
  const { user } = useAuth();
  const { docId } = useParams<{ docId: string }>();

  const { state, reload } = useAsync(
    () => (docId ? api.getErpGateEntry(docId) : Promise.reject(new Error('missing docId'))),
    [docId],
  );

  if (!can(user, 'erp.read')) {
    return (
      <>
        <PageHeader title="ERP Gate Entry" description="DataMan record — read only" />
        <Alert tone="warning" title="Not permitted">Your account does not have access to DataMan ERP records.</Alert>
      </>
    );
  }

  if (!docId) {
    return (
      <>
        <PageHeader title="ERP Gate Entry" description="DataMan record — read only" />
        <Alert tone="danger" title="Missing gate entry">No gate entry DocId was supplied.</Alert>
        <div className="mt-4"><ButtonLink to="/erp/gate-entries" variant="ghost">Back to gate entries</ButtonLink></div>
      </>
    );
  }

  const header = (
    <PageHeader
      title={docId}
      mono
      description="DataMan gate entry, weighment and GRN — read only"
      crumbs={[{ label: 'ERP gate entries', to: '/erp/gate-entries' }, { label: docId }]}
    />
  );

  if (state.status === 'loading' && !state.data) {
    return <>{header}<LoadingState label="Loading gate entry…" /></>;
  }

  if (state.status === 'error') {
    const e = state.error;
    return (
      <>
        {header}
        {isErpOutage(e) ? (
          <>
            <Alert tone="warning" title="ERP unavailable" role="alert">
              The DataMan ERP data source is temporarily unavailable, so this gate entry cannot be loaded.
              This is not the same as a missing record.
            </Alert>
            <div className="mt-3"><TextButton onClick={reload}>Try again</TextButton></div>
          </>
        ) : e.code === 'NOT_FOUND' ? (
          <>
            <Alert tone="danger" title="Gate entry not found">
              {e.message || 'This DocId does not exist in DataMan ERP.'}
            </Alert>
            <div className="mt-4"><ButtonLink to="/erp/gate-entries" variant="ghost">Back to gate entries</ButtonLink></div>
          </>
        ) : (
          <ErrorState error={e} onRetry={reload} />
        )}
      </>
    );
  }

  if (!state.data) return <>{header}<LoadingState label="Loading gate entry…" /></>;

  const entry: ErpGateEntryDetail = state.data;

  return (
    <>
      <PageHeader
        title={entry.docId}
        mono
        description={`${entry.vType ?? '—'} · ${entry.vNo ?? '—'} · ${entry.vehicleNo ?? 'No vehicle'}`}
        crumbs={[{ label: 'ERP gate entries', to: '/erp/gate-entries' }, { label: entry.docId }]}
        actions={<ButtonLink to="/erp/gate-entries" variant="ghost">Back to gate entries</ButtonLink>}
      />

      <Card title="Gate entry" subtitle="GateInOut">
        <dl className={kvGrid}>
          <ReadOnlyItem label="DocId" value={entry.docId} mono />
          <ReadOnlyItem label="Voucher type (V_Type)" value={entry.vType ?? '—'} />
          <ReadOnlyItem label="Voucher no. (V_No)" value={entry.vNo ?? '—'} mono />
          <ReadOnlyItem label="Voucher date (V_Date)" value={dateText(entry.vDate)} />
          {/* V_Time is a SQL time-of-day (stored at 1900-01-01), so only the time is meaningful. */}
          <ReadOnlyItem label="Voucher time (V_Time)" value={entry.vTime ? formatTime(entry.vTime) : '—'} />
          <ReadOnlyItem label="Party code" value={entry.partyCode ?? '—'} />
          <ReadOnlyItem label="Vehicle no." value={entry.vehicleNo ?? '—'} mono />
          <ReadOnlyItem label="Gate out" value={entry.gateOutDate ? formatDateTime(entry.gateOutDate) : 'Not recorded'} />
        </dl>
      </Card>

      <Card title="Weighment" subtitle="Weightment">
        {entry.hasWeighment ? (
          <>
            <dl className={kvGrid}>
              <ReadOnlyItem label="Gross weight" value={weightText(entry.grossWeight)} mono />
              <ReadOnlyItem label="Tare weight" value={weightText(entry.tareWeight)} mono />
              <ReadOnlyItem label="Net weight" value={weightText(entry.netWeight)} mono />
            </dl>
            <TableWrap className="mt-4">
              <table className="tbl min-w-[720px]">
                <thead>
                  <tr>
                    <th scope="col">Weigh slip</th>
                    <th scope="col" className="num">Gross (kg)</th>
                    <th scope="col" className="num">Tare (kg)</th>
                    <th scope="col" className="num">Net (kg)</th>
                    <th scope="col">Weigh date</th>
                    <th scope="col">Weigh out</th>
                  </tr>
                </thead>
                <tbody>
                  {entry.weighments.map((w) => (
                    <tr key={w.weighmentDocId}>
                      <td className="font-mono">{w.weighSlipNo ?? w.weighmentDocId}</td>
                      <td className="num">{w.grossWeight?.value ?? '—'}</td>
                      <td className="num">{w.tareWeight?.value ?? '—'}</td>
                      <td className="num">{w.netWeight?.value ?? '—'}</td>
                      <td>{w.weighDate ? formatDateTime(w.weighDate) : '—'}</td>
                      <td>{w.weighDateOut ? formatDateTime(w.weighDateOut) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </>
        ) : (
          <EmptyState title="No weighment recorded for this gate entry in ERP." />
        )}
      </Card>

      <Card title="GRN (PChallan)" subtitle="PChallan">
        {entry.hasGrn ? (
          <TableWrap>
            <table className="tbl min-w-[720px]">
              <thead>
                <tr>
                  <th scope="col">Challan DocId</th>
                  <th scope="col">V_Type</th>
                  <th scope="col">V_No</th>
                  <th scope="col">GRN date</th>
                  <th scope="col">Approval status</th>
                </tr>
              </thead>
              <tbody>
                {entry.grns.map((g) => (
                  <tr key={g.challanDocId}>
                    <td className="font-mono">{g.challanDocId}</td>
                    <td>{g.vType ?? '—'}</td>
                    <td className="font-mono">{g.vNo ?? '—'}</td>
                    <td>{g.grnDate ? formatDate(g.grnDate) : '—'}</td>
                    <td>{g.approvalStatus
                      ? <Tag tone={g.approvalStatus === 'APPROVED' ? 'success' : 'warning'}>{g.approvalStatus}</Tag>
                      : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        ) : (
          <EmptyState title="No GRN (PChallan) recorded for this gate entry in ERP." />
        )}
      </Card>

      {entry.fieldsAvailable.length > 0 && (
        <Note>
          Fields returned by ERP for this record: <span className="font-mono">{reportedFields(entry)}</span>.
          Values are shown as recorded in DataMan; net weight is the ERP value, not a recomputation.
        </Note>
      )}
    </>
  );
}
