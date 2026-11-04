import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuthService } from '../identity-access/auth.service';
import type { Actor } from '../identity-access/identity.types';
import { QcReadService } from '../qc/qc-read.service';
import { MovementReadService } from '../movement-grn/movement-read.service';
import { WeighmentService } from '../weighment/weighment.service';
import { ReceivingService } from '../receiving/receiving.service';

function csvCell(value: unknown) { let text = value === null || value === undefined ? '' : String(value); if (/^[=+\-@]/.test(text)) text = "'" + text; return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; }
// The CSV columns mirror the frontend's RECEIVING_CSV_COLUMNS exactly (brief §5.5, D-10 pending).
const COLUMNS = ['Gate Entry No.', 'Vehicle No.', 'Supplier', 'Material', 'Gross Wt (kg)', 'Tare Wt (kg)', 'Net Wt (kg)', 'QC status', 'Exit status', 'Exit time (IST)', 'GRN status', 'GRN No.', 'Entry time (IST)', 'Entered by'];
// The frontend renders times as "02 Nov 2026, 11:45 am IST" (en-IN, Asia/Kolkata).
const ist = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
const istDateTime = (iso: string | null) => (iso ? `${ist.format(new Date(iso))} IST` : '');
const HO_VISIBLE = ['submitted_to_ho', 'under_ho_review', 'correction_requested', 'resubmitted', 'verified'];
// B-22: packages keep their DataMan milestones while they move through accounting, so the
// overview ERP counters must keep counting them after verification.
const ERP_COUNTING_STATES = [...HO_VISIBLE, 'with_accounting', 'with_head_accountant', 'accounting_approved', 'forwarded_to_head_accountant', 'returned_to_ho', 'returned_to_accountant', 'bill_posted'];

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService, private readonly auth: AuthService, private readonly qc: QcReadService,
    private readonly movement: MovementReadService, private readonly weights: WeighmentService, private readonly receiving: ReceivingService) {}
  /** Brief §5.5: OverviewData computed exactly as the mock getOverview(), "today" = Asia/Kolkata day. */
  async overview(actor: Actor) {
    await this.auth.authorize(actor, 'overview.view');
    const now = new Date(); const ist = new Date(now.getTime() + 330 * 60_000);
    const dayStart = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - 330 * 60_000); const dayEnd = new Date(dayStart.getTime() + 86_400_000);
    return this.prisma.$transaction(async tx => {
      const [visits, packages] = await Promise.all([
        tx.receivingVisit.findMany({ orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
        tx.documentPackage.findMany({ include: { erp: true } }),
      ]);
      const ids = visits.map(visit => visit.id);
      const [qcStates, movementStates, weighments] = await Promise.all([
        this.qc.states(tx, ids), this.movement.states(tx, ids),
        tx.weighment.findMany({ where: { visitId: { in: ids } }, orderBy: [{ recordedAt: 'asc' }, { id: 'asc' }] }),
      ]);
      const rows = visits.map(visit => {
        const weights = this.weights.current(weighments.filter(reading => reading.visitId === visit.id));
        const movementState = movementStates.get(visit.id)!;
        return { visit, qcStatus: qcStates.get(visit.id)?.qcStatus ?? 'pending', ...weights,
          exitStatus: movementState.exitStatus, grnStatus: movementState.grnStatus, physicalExitAt: movementState.physicalExitAt, officialGrnRef: movementState.officialGrnRef };
      });
      const onPrem = rows.filter(row => row.exitStatus === 'on_premises');
      const isToday = (iso: string | null) => Boolean(iso) && iso! >= dayStart.toISOString() && iso! < dayEnd.toISOString();
      const qcHasResult = (status: string) => !['pending', 'in_progress'].includes(status);
      const hoVisible = packages.filter(pkg => ERP_COUNTING_STATES.includes(pkg.status));
      const confirmed = (pkgId: string, type: string) => packages.find(pkg => pkg.id === pkgId)?.erp.find(milestone => milestone.type === type)?.status === 'confirmed';
      const erpCount = (type: string, status: 'pending' | 'confirmed', gate?: (pkgId: string) => boolean) =>
        hoVisible.filter(pkg => (!gate || gate(pkg.id)) && pkg.erp.find(milestone => milestone.type === type)?.status === status).length;
      // The three overview lists carry full visit snapshots (with actor names).
      const snapshots = await this.receiving.snapshots(tx, visits);
      const snapshotById = new Map(snapshots.map(snapshot => [snapshot.id, snapshot]));
      const list = (rowsToTake: typeof rows) => rowsToTake.map(row => snapshotById.get(row.visit.id)!);
      const grnExited = rows.filter(row => row.grnStatus === 'not_recorded' && row.exitStatus === 'exited')
        .sort((a, b) => (a.physicalExitAt ?? '').localeCompare(b.physicalExitAt ?? ''));
      return { data: {
        generatedAt: now.toISOString(),
        receiving: { total: rows.length, today: rows.filter(row => isToday(row.visit.createdAt.toISOString())).length, onPremises: onPrem.length },
        qc: {
          awaitingInspection: rows.filter(row => row.qcStatus === 'pending').length,
          inProgress: rows.filter(row => row.qcStatus === 'in_progress').length,
          returned: rows.filter(row => row.qcStatus === 'returned').length,
          awaitingReview: rows.filter(row => row.qcStatus === 'submitted').length,
          decided: rows.filter(row => ['accepted', 'accepted_with_deduction', 'rejected'].includes(row.qcStatus)).length,
        },
        gate: {
          needsTare: onPrem.filter(row => !row.tareWeight).length,
          readyToExit: onPrem.filter(row => row.tareWeight && qcHasResult(row.qcStatus)).length,
          exitedToday: rows.filter(row => isToday(row.physicalExitAt)).length,
          grnPending: rows.filter(row => row.grnStatus === 'not_recorded').length,
        },
        documents: {
          draft: packages.filter(pkg => ['draft', 'ready_for_gate_check'].includes(pkg.status)).length,
          withHo: packages.filter(pkg => ['submitted_to_ho', 'under_ho_review', 'resubmitted'].includes(pkg.status)).length,
          correctionRequested: packages.filter(pkg => pkg.status === 'correction_requested').length,
          verified: packages.filter(pkg => pkg.status === 'verified').length,
          // Accounting chain (audit KPMPL-002): in-flight accounting and posted bills were
          // invisible to management. withAccounting covers every not-yet-posted accounting state.
          withAccounting: packages.filter(pkg => ['with_accounting', 'with_head_accountant', 'accounting_approved'].includes(pkg.status)).length,
          billPosted: packages.filter(pkg => pkg.status === 'bill_posted').length,
        },
        erp: {
          approvalPending: erpCount('plant_head_grn_approval', 'pending'),
          voucherPending: erpCount('purchase_voucher', 'pending', pkgId => confirmed(pkgId, 'plant_head_grn_approval')),
          postingPending: erpCount('final_posting', 'pending', pkgId => confirmed(pkgId, 'purchase_voucher')),
          posted: erpCount('final_posting', 'confirmed'),
        },
        oldestAwaitingQc: list(rows.filter(row => ['pending', 'in_progress', 'returned'].includes(row.qcStatus)).slice(0, 5)),
        longestOnPremises: list(onPrem.slice(0, 5)),
        grnPendingList: list(grnExited.slice(0, 5)),
      } };
    });
  }
  async csv(actor: Actor, from?: string, to?: string) {
    await this.auth.authorize(actor, 'overview.view'); const start = from ? new Date(`${from}T00:00:00+05:30`) : undefined; const end = to ? new Date(`${to}T23:59:59.999+05:30`) : undefined;
    return this.prisma.$transaction(async tx => {
      const visits = await tx.receivingVisit.findMany({ where: { ...(start || end ? { createdAt: { ...(start ? { gte: start } : {}), ...(end ? { lte: end } : {}) } } : {}) },
        include: { weighments: { orderBy: [{ recordedAt: 'asc' }, { id: 'asc' }] }, qcInspections: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1 } }, orderBy: { createdAt: 'desc' } });
      const [qcStates, movementStates, creators] = await Promise.all([
        this.qc.states(tx, visits.map(visit => visit.id)), this.movement.states(tx, visits.map(visit => visit.id)),
        tx.user.findMany({ where: { id: { in: [...new Set(visits.map(visit => visit.createdBy))] } }, select: { id: true, fullName: true } }),
      ]);
      const names = new Map(creators.map(user => [user.id, user.fullName]));
      const rows = visits.map(visit => {
        const { grossWeight, tareWeight, netWeight } = this.weights.current(visit.weighments);
        const movementState = movementStates.get(visit.id)!;
        return [
          visit.officialGateEntryRef, visit.vehicleNumber, visit.supplierDisplayName, visit.materialDisplayName,
          grossWeight?.value, tareWeight?.value, netWeight?.value, qcStates.get(visit.id)?.qcStatus ?? 'pending', movementState.exitStatus,
          istDateTime(movementState.physicalExitAt), movementState.grnStatus, movementState.officialGrnRef, istDateTime(visit.createdAt.toISOString()),
          names.get(visit.createdBy) ?? 'Unknown user',
        ];
      });
      return '\uFEFF' + [COLUMNS, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
    });
  }
}
