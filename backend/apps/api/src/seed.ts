import 'reflect-metadata';
import * as argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import { env } from './config/env';
import { PrismaService } from './infra/prisma/prisma.service';
import { AuditService } from './modules/audit/audit.service';
import { roleCapabilities } from './modules/identity-access/policy';

/**
 * Demo seed (brief §9): the 5 synthetic accounts with the brief's role codes, password
 * from DEMO_PASSWORD, and the fixture visits/packages that mirror the frontend's
 * src/api/mock/fixtures.ts (4 visits in different states, 2 packages). Everything is
 * synthetic (DEMO- prefixes) and the seed is idempotent: existing rows are left alone.
 */
const prisma = new PrismaService();
const audit = new AuditService(prisma);
const ago = (mins: number) => new Date(Date.now() - mins * 60_000);

async function seedRoles(): Promise<void> {
  for (const [code, capabilities] of Object.entries(roleCapabilities)) {
    const role = await prisma.role.upsert({ where: { code }, update: {}, create: { code } });
    for (const capability of capabilities) {
      const row = await prisma.capability.upsert({ where: { code: capability }, update: {}, create: { code: capability } });
      await prisma.roleCapability.upsert({ where: { roleId_capabilityId: { roleId: role.id, capabilityId: row.id } }, update: {}, create: { roleId: role.id, capabilityId: row.id } });
    }
  }
}

const ACCOUNTS = [
  { username: 'demo-gate', displayName: 'Demo Gate User', role: 'gate' },
  { username: 'demo-qc', displayName: 'Demo QC User', role: 'qc' },
  { username: 'demo-docs', displayName: 'Demo Document Authority', role: 'gate_doc' },
  { username: 'demo-ho', displayName: 'Demo HO User', role: 'ho' },
  { username: 'demo-admin', displayName: 'Demo Admin', role: 'admin' },
] as const;

async function seedUsers(): Promise<Map<string, string>> {
  const passwordHash = await argon2.hash(env.DEMO_PASSWORD!, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
  const ids = new Map<string, string>();
  for (const account of ACCOUNTS) {
    const user = await prisma.user.upsert({
      where: { employeeCode: account.username },
      update: { fullName: account.displayName, isActive: true, synthetic: true },
      create: { id: randomUUID(), employeeCode: account.username, fullName: account.displayName, passwordHash, mustChangePassword: false, synthetic: true, isActive: true },
    });
    ids.set(account.username, user.id);
    const role = await prisma.role.findUniqueOrThrow({ where: { code: account.role } });
    await prisma.userRole.upsert({ where: { userId_roleId: { userId: user.id, roleId: role.id } }, update: {}, create: { userId: user.id, roleId: role.id, grantedBy: user.id } });
  }
  return ids;
}

async function seedReferenceValues(): Promise<void> {
  const entries: [string, string][] = [
    ['supplier', 'Demo Supplier A'], ['supplier', 'Demo Supplier B'], ['supplier', 'Demo Supplier C'],
    ['material', 'Domestic Waste Paper'],
  ];
  for (const [kind, value] of entries) {
    await prisma.referenceValue.upsert({ where: { kind_value: { kind, value } }, update: { active: true }, create: { kind, value } });
  }
}

async function seedVisits(userId: string): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  const plan = [
    { ref: 'DEMO-GATE-0001', vehicle: 'DEMO-MH-00-AA-0001', supplier: 'Demo Supplier A', challan: 'DEMO-CH-1001',
      gross: '15000.000', tare: '5500.000', qcStatus: 'submitted', exited: true, exitAt: ago(140), grn: 'DEMO-GRN-0007', createdMinsAgo: 330, version: 5,
      qc: { moisture: '9.20', impurity: '1.00', remarks: 'Demo observed values; no deduction calculated', at: ago(300) } },
    { ref: 'DEMO-GATE-0002', vehicle: 'DEMO-MH-00-BB-0002', supplier: 'Demo Supplier B', challan: null,
      gross: '12200.000', tare: null, qcStatus: 'pending', exited: false, exitAt: null, grn: null, createdMinsAgo: 55, version: 1, qc: null },
    { ref: 'DEMO-GATE-0003', vehicle: 'DEMO-MH-00-CC-0003', supplier: 'Demo Supplier A', challan: null,
      gross: '18000.000', tare: null, qcStatus: 'returned', exited: false, exitAt: null, grn: null, createdMinsAgo: 200, version: 3,
      qc: { moisture: '14.00', impurity: '2.00', remarks: 'Demo: wet bales observed on top layer.', at: ago(170) } },
    { ref: 'DEMO-GATE-0004', vehicle: 'DEMO-MH-00-DD-0004', supplier: 'Demo Supplier C', challan: null,
      gross: '10900.000', tare: '4200.000', qcStatus: 'submitted', exited: true, exitAt: ago(35), grn: null, createdMinsAgo: 260, version: 4,
      qc: { moisture: '8.50', impurity: '0.80', remarks: 'Demo observed values.', at: ago(220) } },
  ];
  for (const visit of plan) {
    const existing = await prisma.receivingVisit.findFirst({ where: { officialGateEntryRef: visit.ref } });
    if (existing) { ids.set(visit.ref, existing.id); continue; }
    const createdAt = ago(visit.createdMinsAgo);
    const created = await prisma.receivingVisit.create({ data: {
      officialGateEntryRef: visit.ref, vehicleNumber: visit.vehicle, supplierDisplayName: visit.supplier, materialDisplayName: 'Domestic Waste Paper',
      challanRef: visit.challan, arrivedAt: createdAt, createdBy: userId, isDemo: true, version: visit.version,
      createdAt, updatedAt: visit.exitAt ?? createdAt,
    } });
    ids.set(visit.ref, created.id);
    await prisma.weighment.create({ data: { visitId: created.id, kind: 'gross', value: visit.gross, unit: 'kg', recordedBy: userId, recordedAt: createdAt } });
    if (visit.tare) await prisma.weighment.create({ data: { visitId: created.id, kind: 'tare', value: visit.tare, unit: 'kg', recordedBy: userId, recordedAt: ago(160) } });
    if (visit.qc) {
      const qcUser = await prisma.user.findUniqueOrThrow({ where: { employeeCode: 'demo-qc' } });
      const inspection = await prisma.qCInspection.create({ data: { visitId: created.id, createdBy: qcUser.id, qcStatus: visit.qcStatus } });
      const revision = await prisma.qCRevision.create({ data: { inspectionId: inspection.id, revisionNo: 1, state: 'submitted',
        visitVersion: 2, measurements: [ { code: 'moisture', value: visit.qc.moisture, unit: 'percent' }, { code: 'impurity', value: visit.qc.impurity, unit: 'percent' } ],
        remarks: visit.qc.remarks, submittedBy: qcUser.id, submittedAt: visit.qc.at } });
      await prisma.qCInspection.update({ where: { id: inspection.id }, data: { currentRevisionId: revision.id } });
      for (const [code, value] of [['moisture', visit.qc.moisture], ['impurity', visit.qc.impurity]] as const) {
        await prisma.qCMeasurement.create({ data: { revisionId: revision.id, code, value, unit: 'percent' } });
      }
      if (visit.qcStatus === 'returned') {
        // D-03: the QC operator makes the final decision, including sending readings back for a re-check.
        await prisma.qCReview.create({ data: { inspectionId: inspection.id, outcome: 'returned',
          reason: 'Demo: re-check moisture on a second sample and resubmit.', demonstrationOnly: false, forRevision: 1, recordedBy: qcUser.id, recordedAt: ago(150) } });
      }
    }
    if (visit.exited) await prisma.vehicleExit.create({ data: { visitId: created.id, physicalExitAt: visit.exitAt!, recordedBy: userId, recordedAt: visit.exitAt! } });
    if (visit.grn) {
      const reference = await prisma.gRNReference.create({ data: { officialGrnRef: visit.grn, verifiedBy: userId, source: 'manual_staff_confirmation', recordedAt: ago(60) } });
      await prisma.gRNLink.create({ data: { visitId: created.id, grnReferenceId: reference.id, createdBy: userId, createdAt: ago(60) } });
    }
  }
  return ids;
}

async function seedTimeline(ids: Map<string, string>, userId: string): Promise<void> {
  const qcUser = await prisma.user.findUniqueOrThrow({ where: { employeeCode: 'demo-qc' } });
  // Mirror the fixtures' visit timelines (CONTRACT_DIFF #83 wording). Seed-time appends only.
  const events: ({ visit: string; action: string; detail?: string; source?: 'app' | 'manual_staff_confirmation'; actorId: string })[] = [];
  const v1 = ids.get('DEMO-GATE-0001')!, v2 = ids.get('DEMO-GATE-0002')!, v3 = ids.get('DEMO-GATE-0003')!, v4 = ids.get('DEMO-GATE-0004')!;
  events.push(
    { visit: v1, action: 'receiving_created', detail: 'Gross 15000.000 kg recorded. Sent to QC pending list.', actorId: userId },
    { visit: v1, action: 'qc_submitted', detail: 'No automatic deduction configured.', actorId: qcUser.id },
    { visit: v1, action: 'weight_recorded', detail: 'Tare 5500.000 kg. Net 9500.000 kg (display only).', actorId: userId },
    { visit: v1, action: 'exit_recorded', detail: 'Staff confirmed mill exit checks.', actorId: userId },
    { visit: v1, action: 'grn_reference_recorded', detail: 'DEMO-GRN-0007 — staff states it was checked in DataMan.', source: 'manual_staff_confirmation', actorId: userId },
    { visit: v2, action: 'receiving_created', detail: 'Gross 12200.000 kg recorded. Sent to QC pending list.', actorId: userId },
    { visit: v3, action: 'receiving_created', detail: 'Gross 18000.000 kg recorded. Sent to QC pending list.', actorId: userId },
    { visit: v3, action: 'qc_submitted', actorId: qcUser.id },
    { visit: v3, action: 'qc_returned', detail: 'Re-check moisture on a second sample.', actorId: qcUser.id },
    { visit: v4, action: 'receiving_created', detail: 'Gross 10900.000 kg recorded. Sent to QC pending list.', actorId: userId },
    { visit: v4, action: 'qc_submitted', actorId: qcUser.id },
    { visit: v4, action: 'weight_recorded', detail: 'Tare 4200.000 kg. Net 6700.000 kg (display only).', actorId: userId },
    { visit: v4, action: 'exit_recorded', detail: 'Staff confirmed mill exit checks. GRN not yet recorded.', actorId: userId },
  );
  for (const event of events) {
    const exists = await prisma.auditEvent.findFirst({ where: { entityType: 'ReceivingVisit', entityId: event.visit, action: event.action } });
    if (exists) continue;
    await prisma.$transaction(tx => audit.append(tx, { entityType: 'ReceivingVisit', entityId: event.visit, action: event.action,
      actorId: event.actorId, ...(event.detail ? { newValue: { detail: event.detail } } : {}), source: event.source ?? 'app' }));
  }
}

async function seedPackages(ids: Map<string, string>, userId: string): Promise<void> {
  const gate = userId; const ho = await prisma.user.findUniqueOrThrow({ where: { employeeCode: 'demo-ho' } });
  const categories = ['supplier_invoice', 'factory_grn', 'weighbridge_slip', 'qc_slip', 'supporting_bill', 'eway_bill'] as const;
  const milestones = ['plant_head_grn_approval', 'purchase_voucher', 'final_posting'] as const;
  const file = (name: string, minsAgo: number) => ({ originalName: name, sizeBytes: 180_000 + name.length * 1000, uploadedBy: userId, uploadedAt: ago(minsAgo), scanStatus: 'clean' });
  const packages = [
    { ref: 'DEMO-PKG-0001', visitRef: 'DEMO-GATE-0001', invoiceRef: 'DEMO-INV-0101', supplier: 'Demo Supplier A', status: 'under_ho_review',
      version: 6, createdAt: ago(58), submittedBy: (await prisma.user.findUniqueOrThrow({ where: { employeeCode: 'demo-docs' } })).id, submittedAt: ago(50),
      files: [
        { category: 'supplier_invoice', ...file('DEMO-INV-0101.pdf', 58) }, { category: 'factory_grn', ...file('DEMO-GRN-0007.pdf', 57) },
        { category: 'weighbridge_slip', ...file('DEMO-WB-0001-gross.pdf', 57) }, { category: 'weighbridge_slip', ...file('DEMO-WB-0001-tare.pdf', 57) },
        { category: 'qc_slip', ...file('DEMO-QC-0001.pdf', 56) },
      ],
      notApplicable: [ ['supporting_bill', 'Demo: no separate supporting bill for this load.'], ['eway_bill', 'Not needed for this load (sample.)'] ] as [string, string][],
      hoChecks: [ ['supplier_invoice', 'ok'], ['factory_grn', 'ok'] ] as [string, string][],
      erpConfirmed: { type: 'plant_head_grn_approval', dataManRef: 'DEMO-GRN-0007', at: ago(30), confirmedAt: ago(20), by: ho.id, note: 'Demo: approval seen in DataMan GRN screen.' },
      history: [
        { action: 'package_created', detail: 'Linked DEMO-GATE-0001.', at: ago(58), actorId: userId },
        { action: 'mark_ready', detail: null, at: ago(55), actorId: userId },
        { action: 'submit_to_ho', detail: 'Authority confirmed the packet is complete.', at: ago(50), actorId: await prisma.user.findUniqueOrThrow({ where: { employeeCode: 'demo-docs' } }).then(user => user.id) },
        { action: 'start_review', detail: null, at: ago(40), actorId: ho.id },
        { action: 'Plant Head GRN approval confirmed', detail: 'DEMO-GRN-0007 — staff states it was checked in DataMan.', at: ago(20), actorId: ho.id },
      ] },
    { ref: 'DEMO-PKG-0002', visitRef: 'DEMO-GATE-0004', invoiceRef: 'DEMO-INV-0102', supplier: 'Demo Supplier C', status: 'draft',
      version: 2, createdAt: ago(25), submittedBy: null, submittedAt: null,
      files: [ { category: 'supplier_invoice', ...file('DEMO-INV-0102.pdf', 25) } ],
      notApplicable: [], hoChecks: [], erpConfirmed: null,
      history: [ { action: 'package_created', detail: 'Linked DEMO-GATE-0004. GRN not yet recorded.', at: ago(25), actorId: userId } ] },
  ];
  for (const pkg of packages) {
    if (await prisma.documentPackage.findUnique({ where: { packageRef: pkg.ref } })) continue;
    const visitId = ids.get(pkg.visitRef)!;
    const created = await prisma.documentPackage.create({ data: {
      packageRef: pkg.ref, invoiceRef: pkg.invoiceRef, supplierDisplayName: pkg.supplier, status: pkg.status, version: pkg.version,
      checklistVersion: 1, createdBy: userId, submittedBy: pkg.submittedBy, submittedAt: pkg.submittedAt, createdAt: pkg.createdAt, updatedAt: pkg.history.at(-1)!.at,
      visits: { create: [{ visitId }] },
      items: { create: categories.map((category, position) => ({ category, position,
        notApplicableReason: pkg.notApplicable.find(([cat]) => cat === category)?.[1] ?? null,
        hoCheck: pkg.hoChecks.find(([cat]) => cat === category)?.[1] ?? 'unchecked' })) },
      files: { create: pkg.files.map(entry => ({ id: randomUUID(), category: entry.category, storageKey: `packages/synthetic/${randomUUID()}.pdf`,
        sha256: '0'.repeat(64), size: entry.sizeBytes, originalName: entry.originalName, scanStatus: 'clean', uploadedBy: entry.uploadedBy, uploadedAt: entry.uploadedAt })) },
      erp: { create: milestones.map(type => { const confirmed = pkg.erpConfirmed?.type === type; return { type,
        status: confirmed ? 'confirmed' : 'pending', dataManRef: confirmed ? pkg.erpConfirmed!.dataManRef : null,
        erpOccurredAt: confirmed ? pkg.erpConfirmed!.at : null, note: confirmed ? pkg.erpConfirmed!.note : null,
        confirmedAt: confirmed ? pkg.erpConfirmed!.confirmedAt : null, confirmedBy: confirmed ? pkg.erpConfirmed!.by : null, source: 'manual_staff_confirmation' }; }) },
      history: { create: pkg.history.map(entry => ({ action: entry.action, detail: entry.detail ?? undefined, actorId: entry.actorId, recordedAt: entry.at, source: entry.action.includes('confirmed') ? 'manual_staff_confirmation' : 'app' })) },
    } });
    void created;
    // Visit audit note about the package link (mock wording).
    await prisma.$transaction(tx => audit.append(tx, { entityType: 'ReceivingVisit', entityId: visitId, actorId: userId,
      action: 'package_linked', newValue: { visitId, packageRef: pkg.ref, detail: `Linked to document package ${pkg.ref}.` } }));
  }
  // Keep the runtime reference sequence ahead of the hardcoded demo refs: the demo
  // packages insert DEMO-PKG-000N rows directly, and the first real create draws
  // nextval('"PackageRefSeq"') — without this sync it collides on packageRef (unique).
  await prisma.$executeRaw`SELECT setval('"PackageRefSeq"', GREATEST((SELECT COALESCE(MAX(CAST(SUBSTRING("packageRef" FROM 10) AS INTEGER)), 0) FROM "DocumentPackage"), 0) + 1, false)`;
  void gate;
}

async function main(): Promise<void> {
  if (env.APP_MODE !== 'demo') throw new Error('The demo seed runs only with APP_MODE=demo.');
  if (!env.DEMO_PASSWORD) throw new Error('DEMO_PASSWORD is required for the demo seed.');
  await seedRoles();
  const users = await seedUsers();
  await seedReferenceValues();
  const ids = await seedVisits(users.get('demo-gate')!);
  await seedTimeline(ids, users.get('demo-gate')!);
  await seedPackages(ids, users.get('demo-gate')!);
  console.log('Demo seed loaded: 5 users (demo-gate, demo-qc, demo-docs, demo-ho, demo-admin), 4 visits, 2 packages.');
}

void main().then(() => prisma.$disconnect()).catch(async error => { console.error('Demo seed failed:', error); await prisma.$disconnect(); process.exitCode = 1; });
