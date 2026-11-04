/**
 * SYNTHETIC fixtures from 15_DEMO_TEST_DATA_AND_STATES §1–2.
 * Invented identities only — not client facts, not official ERP number formats.
 * Times are generated relative to "now" so the register always shows a working day.
 */
import { DEMO_ACCOUNTS, MOCK_DEMO_PASSWORD } from '../../auth/demoAccounts';
import type { DocCategory, DocumentItem, DocumentPackage, ErpMilestone, QcInspection, ReceivingVisit, TimelineEvent, User } from '../../domain/types';

export const DEMO_PASSWORD = MOCK_DEMO_PASSWORD;

/** Seed accounts shown on the login role picker. Admin-created accounts live in the mock DB. */
export const demoUsers: User[] = /* @__PURE__ */ DEMO_ACCOUNTS.map((a) => ({
  id: a.username, username: a.username, displayName: a.displayName, roles: [a.role], synthetic: true, active: true,
}));

export const demoSuppliers = ['Demo Supplier A', 'Demo Supplier B', 'Demo Supplier C'];
export const demoMaterials = ['Domestic Waste Paper'];

const ago = (mins: number) => new Date(Date.now() - mins * 60000).toISOString();

export interface MockDb {
  users: User[];
  packages: DocumentPackage[];
  visits: ReceivingVisit[];
  inspections: QcInspection[];
  timeline: Record<string, TimelineEvent[]>;
  idempotency: Record<string, unknown>;
  seq: number;
  /** Mock-only per-user passwords (after a reset or change). Absent = MOCK_DEMO_PASSWORD. Older saved DBs lack it. */
  passwords?: Record<string, string>;
}

function visit(p: Partial<ReceivingVisit> & Pick<ReceivingVisit, 'id' | 'officialGateEntryRef' | 'vehicleNumber' | 'supplierDisplayName'>, createdMinsAgo: number): ReceivingVisit {
  const createdAt = ago(createdMinsAgo);
  return {
    materialDisplayName: 'Domestic Waste Paper',
    challanRef: null,
    poRef: null,
    arrivedAt: createdAt,
    grossWeight: null,
    tareWeight: null,
    notes: null,
    qcStatus: 'pending',
    exitStatus: 'on_premises',
    grnStatus: 'not_recorded',
    officialGrnRef: null,
    physicalExitAt: null,
    createdBy: 'Demo Gate User',
    updatedAt: createdAt,
    version: 1,
    createdAt,
    ...p,
  };
}

export function buildFixtures(): MockDb {
  const visits: ReceivingVisit[] = [
    visit({
      id: 'demo-visit-001', officialGateEntryRef: 'DEMO-GATE-0001', vehicleNumber: 'DEMO-MH-00-AA-0001',
      supplierDisplayName: 'Demo Supplier A', challanRef: 'DEMO-CH-1001',
      grossWeight: { value: '15000.000', unit: 'kg' }, tareWeight: { value: '5500.000', unit: 'kg' },
      qcStatus: 'submitted', exitStatus: 'exited', physicalExitAt: ago(140),
      grnStatus: 'reference_recorded', officialGrnRef: 'DEMO-GRN-0007', version: 5,
    }, 330),
    visit({
      id: 'demo-visit-002', officialGateEntryRef: 'DEMO-GATE-0002', vehicleNumber: 'DEMO-MH-00-BB-0002',
      supplierDisplayName: 'Demo Supplier B', grossWeight: { value: '12200.000', unit: 'kg' }, qcStatus: 'pending',
    }, 55),
    visit({
      id: 'demo-visit-003', officialGateEntryRef: 'DEMO-GATE-0003', vehicleNumber: 'DEMO-MH-00-CC-0003',
      supplierDisplayName: 'Demo Supplier A', grossWeight: { value: '18000.000', unit: 'kg' }, qcStatus: 'returned', version: 3,
    }, 200),
    visit({
      id: 'demo-visit-004', officialGateEntryRef: 'DEMO-GATE-0004', vehicleNumber: 'DEMO-MH-00-DD-0004',
      supplierDisplayName: 'Demo Supplier C', grossWeight: { value: '10900.000', unit: 'kg' }, tareWeight: { value: '4200.000', unit: 'kg' },
      qcStatus: 'submitted', exitStatus: 'exited', physicalExitAt: ago(35), version: 4,
    }, 260),
    visit({
      id: 'demo-visit-005', officialGateEntryRef: 'DEMO-GATE-0005', vehicleNumber: 'DEMO-MH-00-EE-0005',
      supplierDisplayName: 'Demo Supplier A', challanRef: 'DEMO-CH-1005',
      grossWeight: { value: '13600.000', unit: 'kg' }, tareWeight: { value: '5100.000', unit: 'kg' },
      qcStatus: 'accepted', exitStatus: 'exited', physicalExitAt: ago(90),
      grnStatus: 'reference_recorded', officialGrnRef: 'DEMO-GRN-0011', version: 6,
    }, 300),
  ];

  const inspections: QcInspection[] = [
    {
      inspectionId: 'demo-qc-001', visitId: 'demo-visit-001', qcStatus: 'submitted',
      revisions: [{ revision: 1, state: 'submitted', measurements: [
        { code: 'moisture', value: '9.20', unit: 'percent' }, { code: 'impurity', value: '1.00', unit: 'percent' },
      ], remarks: 'Demo observed values; no deduction calculated', revisionReason: null, recordedBy: 'Demo QC User', recordedAt: ago(300) }],
      reviews: [], deductionCalculation: { status: 'not_configured', value: null },
    },
    {
      inspectionId: 'demo-qc-003', visitId: 'demo-visit-003', qcStatus: 'returned',
      revisions: [{ revision: 1, state: 'submitted', measurements: [
        { code: 'moisture', value: '14.00', unit: 'percent' }, { code: 'impurity', value: '2.00', unit: 'percent' },
      ], remarks: 'Demo: wet bales observed on top layer.', revisionReason: null, recordedBy: 'Demo QC User', recordedAt: ago(170) }],
      reviews: [{ outcome: 'returned', reason: 'Demo: re-check moisture on a second sample and resubmit.', demonstrationOnly: false, recordedBy: 'Demo QC User', recordedAt: ago(150), forRevision: 1 }],
      deductionCalculation: { status: 'not_configured', value: null },
    },
    {
      inspectionId: 'demo-qc-004', visitId: 'demo-visit-004', qcStatus: 'submitted',
      revisions: [{ revision: 1, state: 'submitted', measurements: [
        { code: 'moisture', value: '8.50', unit: 'percent' }, { code: 'impurity', value: '0.80', unit: 'percent' },
      ], remarks: 'Demo observed values.', revisionReason: null, recordedBy: 'Demo QC User', recordedAt: ago(220) }],
      reviews: [], deductionCalculation: { status: 'not_configured', value: null },
    },
  ];

  const ev = (id: string, minsAgo: number, actor: string, action: string, detail?: string) =>
    ({ id, at: ago(minsAgo), actor, action, detail, source: 'app' as const });

  const timeline: Record<string, TimelineEvent[]> = {
    'demo-visit-001': [
      ev('t1', 330, 'Demo Gate User', 'Receiving visit created', 'Gross 15000.000 kg recorded. Sent to QC pending list.'),
      ev('t2', 300, 'Demo QC User', 'QC readings submitted (revision 1)', 'No automatic deduction configured.'),
      ev('t3', 160, 'Demo Gate User', 'Tare recorded', 'Tare 5500.000 kg.'),
      ev('t4', 140, 'Demo Gate User', 'Physical exit recorded'),
      { ...ev('t5', 60, 'Demo Gate User', 'Official GRN reference recorded', 'DEMO-GRN-0007 — staff states it was checked in DataMan.'), source: 'manual_staff_confirmation' },
    ],
    'demo-visit-002': [ev('t6', 55, 'Demo Gate User', 'Receiving visit created', 'Gross 12200.000 kg recorded. Sent to QC pending list.')],
    'demo-visit-003': [
      ev('t7', 200, 'Demo Gate User', 'Receiving visit created', 'Gross 18000.000 kg recorded. Sent to QC pending list.'),
      ev('t8', 170, 'Demo QC User', 'QC readings submitted (revision 1)'),
      ev('t9', 150, 'Demo QC User', 'QC returned for correction', 'Re-check moisture on a second sample.'),
    ],
    'demo-visit-004': [
      ev('t10', 260, 'Demo Gate User', 'Receiving visit created', 'Gross 10900.000 kg recorded. Sent to QC pending list.'),
      ev('t11', 220, 'Demo QC User', 'QC readings submitted (revision 1)'),
      ev('t12', 60, 'Demo Gate User', 'Tare recorded', 'Tare 4200.000 kg.'),
      ev('t13', 35, 'Demo Gate User', 'Physical exit recorded', 'GRN not yet generated in DataMan.'),
    ],
  };

  // demo-visit-001: GRN recorded → package with HO; demo-visit-004: GRN pending → draft package shows the gap.
  const f = (id: string, name: string, minsAgo: number, by = 'Demo Gate User') =>
    ({ id, name, sizeBytes: 180_000 + id.length * 1000, mimeType: 'application/pdf', uploadedAt: ago(minsAgo), uploadedBy: by, synthetic: true });
  const item = (category: DocCategory, p: Partial<DocumentItem> = {}): DocumentItem =>
    ({ category, state: 'missing', files: [], notApplicableReason: null, hoCheck: 'unchecked', hoNote: null, ...p });
  const erpPending = (): ErpMilestone[] => (['plant_head_grn_approval', 'purchase_voucher', 'final_posting'] as const)
    .map((type) => ({ type, status: 'pending', dataManRef: null, erpOccurredAt: null, note: null, confirmedBy: null, confirmedAt: null, source: 'manual_staff_confirmation' }));

  const pkg1Erp = erpPending();
  pkg1Erp[0] = { ...pkg1Erp[0]!, status: 'confirmed', dataManRef: 'DEMO-GRN-0007', erpOccurredAt: ago(30), note: 'Demo: approval seen in DataMan GRN screen.', confirmedBy: 'Demo HO User', confirmedAt: ago(20) };

  const packages: DocumentPackage[] = [
    {
      id: 'demo-pkg-001', packageRef: 'DEMO-PKG-0001', visitIds: ['demo-visit-001'], invoiceRef: 'DEMO-INV-0101',
      supplierDisplayName: 'Demo Supplier A', status: 'under_ho_review', checklistVersion: 'demo-checklist-0 (not approved)',
      items: [
        item('supplier_invoice', { state: 'attached', files: [f('demo-file-01', 'DEMO-INV-0101.pdf', 58)], hoCheck: 'ok' }),
        item('factory_grn', { state: 'attached', files: [f('demo-file-02', 'DEMO-GRN-0007.pdf', 57)], hoCheck: 'ok' }),
        item('weighbridge_slip', { state: 'attached', files: [f('demo-file-03', 'DEMO-WB-0001-gross.pdf', 57), f('demo-file-04', 'DEMO-WB-0001-tare.pdf', 57)] }),
        item('qc_slip', { state: 'attached', files: [f('demo-file-05', 'DEMO-QC-0001.pdf', 56)] }),
        item('supporting_bill', { state: 'not_applicable', notApplicableReason: 'Demo: no separate supporting bill for this load.' }),
        item('eway_bill', { state: 'not_applicable', notApplicableReason: 'Not needed for this load (sample).' }),
      ],
      submittedBy: 'Demo Document Authority', submittedAt: ago(50), corrections: [], erp: pkg1Erp, reminders: [], accounting: null, accountingChecks: [],
      history: [
        { id: 'p1', at: ago(58), actor: 'Demo Gate User', action: 'Package created', detail: 'Linked DEMO-GATE-0001.', source: 'app' },
        { id: 'p2', at: ago(55), actor: 'Demo Gate User', action: 'Marked ready for authority check', source: 'app' },
        { id: 'p3', at: ago(50), actor: 'Demo Document Authority', action: 'Sent to Head Office', detail: 'Authority confirmed the packet is complete.', source: 'app' },
        { id: 'p4', at: ago(40), actor: 'Demo HO User', action: 'Head Office review started', source: 'app' },
        { id: 'p5', at: ago(20), actor: 'Demo HO User', action: 'Plant Head GRN approval confirmed', detail: 'DEMO-GRN-0007 — staff states it was checked in DataMan.', source: 'manual_staff_confirmation' },
      ],
      createdBy: 'Demo Gate User', createdAt: ago(58), updatedAt: ago(20), version: 6,
    },
    {
      id: 'demo-pkg-002', packageRef: 'DEMO-PKG-0002', visitIds: ['demo-visit-004'], invoiceRef: 'DEMO-INV-0102',
      supplierDisplayName: 'Demo Supplier C', status: 'draft', checklistVersion: 'demo-checklist-0 (not approved)',
      items: [
        item('supplier_invoice', { state: 'attached', files: [f('demo-file-06', 'DEMO-INV-0102.pdf', 25)] }),
        item('factory_grn'), item('weighbridge_slip'), item('qc_slip'), item('supporting_bill'), item('eway_bill'),
      ],
      submittedBy: null, submittedAt: null, corrections: [], erp: erpPending(), reminders: [], accounting: null, accountingChecks: [],
      history: [{ id: 'p6', at: ago(25), actor: 'Demo Gate User', action: 'Package created', detail: 'Linked DEMO-GATE-0004. GRN not yet recorded.', source: 'app' }],
      createdBy: 'Demo Gate User', createdAt: ago(25), updatedAt: ago(25), version: 2,
    },
    {
      id: 'demo-pkg-003', packageRef: 'DEMO-PKG-0003', visitIds: ['demo-visit-005'], invoiceRef: 'DEMO-INV-0103',
      supplierDisplayName: 'Demo Supplier A', status: 'verified', checklistVersion: 'demo-checklist-0 (not approved)',
      items: [
        item('supplier_invoice', { state: 'attached', files: [f('demo-file-07', 'DEMO-INV-0103.pdf', 120)], hoCheck: 'ok' }),
        item('factory_grn', { state: 'attached', files: [f('demo-file-08', 'DEMO-GRN-0011.pdf', 119)], hoCheck: 'ok' }),
        item('weighbridge_slip', { state: 'attached', files: [f('demo-file-09', 'DEMO-WB-0005-gross.pdf', 119), f('demo-file-10', 'DEMO-WB-0005-tare.pdf', 119)], hoCheck: 'ok' }),
        item('qc_slip', { state: 'not_applicable', notApplicableReason: 'Demo: QC clearance recorded in the system.' }),
        item('supporting_bill', { state: 'not_applicable', notApplicableReason: 'Demo: included in the supplier invoice.' }),
        item('eway_bill', { state: 'not_applicable', notApplicableReason: 'Demo: not required for this load.' }),
      ],
      submittedBy: 'Demo Document Authority', submittedAt: ago(110), corrections: [], erp: erpPending(), reminders: [], accounting: null, accountingChecks: [],
      history: [
        { id: 'p7', at: ago(120), actor: 'Demo Gate User', action: 'Package created', detail: 'Linked DEMO-GATE-0005.', source: 'app' },
        { id: 'p8', at: ago(118), actor: 'Demo Gate User', action: 'Marked ready for authority check', source: 'app' },
        { id: 'p9', at: ago(110), actor: 'Demo Document Authority', action: 'Sent to Head Office', detail: 'Authority confirmed the packet is complete.', source: 'app' },
        { id: 'p10', at: ago(100), actor: 'Demo HO User', action: 'Head Office review started', source: 'app' },
        { id: 'p11', at: ago(80), actor: 'Demo HO User', action: 'Documents verified by Head Office', detail: 'Next: Accounts reviews the package.', source: 'app' },
      ],
      createdBy: 'Demo Gate User', createdAt: ago(120), updatedAt: ago(80), version: 5,
    },
  ];

  return { users: demoUsers.map((u) => ({ ...u })), packages, visits, inspections, timeline, idempotency: {}, seq: 100 };
}
