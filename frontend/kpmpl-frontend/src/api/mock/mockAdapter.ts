/**
 * Synthetic in-browser adapter for the prototype. It imitates the backend contract
 * (06) including permission checks, validation, idempotency and version conflicts, so
 * the UI's error paths are real. It is NOT a backend and holds no business policy
 * beyond what 06 states; every rule that is not client-confirmed is commented with its
 * decision ID and labelled in the UI as a prototype assumption.
 */
import type { PackageAction, ReceivingApi, VersionedWrite, WriteOptions } from '../ReceivingApi';
import type { AccountingAction } from '../../domain/types';
import { ApiError } from '../errors';
import { emitSessionExpired } from '../../auth/sessionEvents';
import { buildCsv, formatDateTime } from '../../lib/format';
import { mockTemporaryPassword, uuidV4 } from '../../lib/ids';
import { buildFixtures, demoMaterials, demoSuppliers, DEMO_PASSWORD, type MockDb } from './fixtures';
import { ALL_ROLES, can, type Capability } from '../../auth/permissions';
import { MIN_PASSWORD_LENGTH } from '../../domain/types';
import { deriveNet, isDecimalString } from '../../domain/decimal';
import { DOC_CATEGORIES, ERP_ORDER, HO_VISIBLE, ACCOUNTING_VISIBLE, docCategoryMeta, erpMilestoneMeta } from '../../domain/status';
import type {
  CreatedUser, CreateReceivingVisitInput, DocCategory, DocumentPackage, DocumentPackageView, OverviewData, QcInspection,
  QcQueueItem, QcSubmitInput, ReceivingVisit, TimelineEvent, User,
} from '../../domain/types';

// v3: D-03 (2026-11-03) moved the QC decision to the QC Operator; older stored demo data is rebuilt.
const DB_KEY = 'kpmpl-proto-db-v3';
/** v0.5 receiving CSV columns (pending D-10). The server CSV (GET /reports/receiving.csv) uses the same. */
export const RECEIVING_CSV_COLUMNS = ['Gate Entry No.', 'Vehicle No.', 'Supplier', 'Material', 'Gross Wt (kg)', 'Tare Wt (kg)', 'Net Wt (kg)', 'QC status', 'Exit status', 'Exit time (IST)', 'GRN status', 'GRN No.', 'Entry time (IST)', 'Entered by'];
const SESSION_KEY = 'kpmpl-proto-session-v3';

/* ---------- storage with graceful fallback (sandboxed previews have no localStorage) ---------- */
// Fallback: memory mirrored into window.name, which survives reloads in the same tab even inside sandboxed iframes.
const NAME_PREFIX = 'kpmpl-proto:';
const memory = new Map<string, string>(readWindowName());
function readWindowName(): [string, string][] {
  try { return window.name.startsWith(NAME_PREFIX) ? Object.entries(JSON.parse(window.name.slice(NAME_PREFIX.length)) as Record<string, string>) : []; } catch { return []; }
}
function persistMemory() {
  try { window.name = NAME_PREFIX + JSON.stringify(Object.fromEntries(memory)); } catch { /* ignore */ }
}
const storage = {
  get(k: string): string | null {
    try { return window.localStorage.getItem(k); } catch { return memory.get(k) ?? null; }
  },
  set(k: string, v: string) {
    try { window.localStorage.setItem(k, v); } catch { memory.set(k, v); persistMemory(); }
  },
  remove(k: string) {
    try { window.localStorage.removeItem(k); } catch { memory.delete(k); persistMemory(); }
  },
};

/* ---------- prototype controls (exposed in the Prototype tools panel) ---------- */
interface MockControls {
  latencyMs: number;
  failNextWrite: boolean;
  listeners: Set<() => void>;
  set(patch: Partial<Pick<MockControls, 'latencyMs' | 'failNextWrite'>>): void;
}
export const mockControls: MockControls = {
  latencyMs: 350,
  /** When true, the next write fails as if the network dropped (AT-14). */
  failNextWrite: false,
  listeners: new Set<() => void>(),
  set(patch) {
    Object.assign(mockControls, patch);
    mockControls.listeners.forEach((l) => l());
  },
};

/**
 * Uploaded PDF content is kept only in this browser tab (object URLs), never persisted.
 * A real backend stores files privately and serves them from GET /document-files/{id}/content
 * (brief §5.7); fixture files have no content at all.
 */
const fileBlobs = new Map<string, string>();

export function resetDemoData() {
  storage.set(DB_KEY, JSON.stringify(buildFixtures()));
}

function load(): MockDb {
  const raw = storage.get(DB_KEY);
  if (raw) {
    try { return JSON.parse(raw) as MockDb; } catch { /* fall through */ }
  }
  const db = buildFixtures();
  storage.set(DB_KEY, JSON.stringify(db));
  return db;
}
function save(db: MockDb) { storage.set(DB_KEY, JSON.stringify(db)); }

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const delay = () => new Promise((r) => setTimeout(r, mockControls.latencyMs + Math.random() * 150));
let reqCounter = 0;
const requestId = () => `demo-request-${++reqCounter}`;
const nowIso = () => new Date().toISOString();
const evId = () => `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

function currentUser(db = load()): User {
  const id = storage.get(SESSION_KEY);
  const u = db.users.find((x) => x.id === id);
  if (!u || !u.active) {
    emitSessionExpired();
    throw new ApiError('UNAUTHENTICATED', 'Please sign in.', 401);
  }
  return u;
}
function requireCap(cap: Capability, db = load()): User {
  const u = currentUser(db);
  if (!can(u, cap)) throw new ApiError('FORBIDDEN', 'Your account does not have permission for this action.', 403, {}, requestId());
  return u;
}
function requireAny(caps: Capability[], db = load()): User {
  const u = currentUser(db);
  if (!caps.some((c) => can(u, c))) throw new ApiError('FORBIDDEN', 'Your account does not have permission for this action.', 403, {}, requestId());
  return u;
}
async function writeGate() {
  await delay();
  if (mockControls.failNextWrite) {
    mockControls.set({ failNextWrite: false });
    throw new ApiError('NETWORK_UNAVAILABLE', 'Network unavailable (simulated).', 0, {}, requestId());
  }
}
const fail = (fields: Record<string, string>, message = 'Please check the highlighted fields.') => {
  if (Object.keys(fields).length) throw new ApiError('VALIDATION_FAILED', message, 422, fields, requestId());
};
const rule = (message: string) => new ApiError('DOMAIN_RULE', message, 422, {}, requestId());

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const SAFE_TEXT = /^[\p{L}\p{N} .,/&()'_#:-]*$/u;
function checkText(fields: Record<string, string>, key: string, value: string | undefined, label: string, required: boolean, max = 60) {
  const v = value ?? '';
  if (required && v.trim() === '') fields[key] = `Enter the ${label}.`;
  else if (v.length > max) fields[key] = `${cap(label)} must be ${max} characters or fewer.`;
  else if (v && !SAFE_TEXT.test(v)) fields[key] = `${cap(label)} contains characters that are not allowed.`;
}
function checkReason(fields: Record<string, string>, key: string, value: string | undefined, what: string, max = 500) {
  const v = (value ?? '').trim();
  if (!v) fields[key] = `Enter the reason for ${what}.`;
  else if (v.length > max) fields[key] = `Reason must be ${max} characters or fewer.`;
}
const isZero = (v: string) => /^0+(\.0+)?$/.test(v);

function idem<T>(db: MockDb, key: string): T | undefined {
  return db.idempotency[key] as T | undefined;
}
function findVisit(db: MockDb, id: string): ReceivingVisit {
  const v = db.visits.find((x) => x.id === id);
  if (!v) throw new ApiError('NOT_FOUND', 'Record not found.', 404);
  return v;
}
function checkVersion(current: number, opts: VersionedWrite) {
  if (current !== opts.expectedVersion) throw new ApiError('VERSION_CONFLICT', 'Record changed.', 409, {}, requestId());
}
function logVisit(db: MockDb, visitId: string, ev: Omit<TimelineEvent, 'id' | 'at'> & { at?: string }) {
  (db.timeline[visitId] ??= []).push({ id: evId(), at: ev.at ?? nowIso(), ...ev });
}
function bumpVisit(v: ReceivingVisit) {
  v.version += 1;
  v.updatedAt = nowIso();
}

/* ---------- module 2 helpers ---------- */
function viewOf(db: MockDb, p: DocumentPackage): DocumentPackageView {
  return clone({ ...p, visits: p.visitIds.map((id) => db.visits.find((v) => v.id === id)).filter(Boolean) as ReceivingVisit[] });
}
function findPkg(db: MockDb, id: string): DocumentPackage {
  const p = db.packages.find((x) => x.id === id);
  if (!p) throw new ApiError('NOT_FOUND', 'Package not found.', 404);
  return p;
}
const GATE_EDITABLE: DocumentPackage['status'][] = ['draft', 'ready_for_gate_check', 'correction_requested'];
function logPkg(p: DocumentPackage, actor: string, action: string, detail?: string, source: TimelineEvent['source'] = 'app') {
  p.history.push({ id: evId(), at: nowIso(), actor, action, detail, source });
  p.version += 1;
  p.updatedAt = nowIso();
}
/**
 * Prototype completeness rule: every candidate row is either attached or explicitly marked
 * not applicable with a reason. The official mandatory/conditional checklist is D-05.
 */
function missingRows(p: DocumentPackage): DocCategory[] {
  return p.items.filter((i) => i.state === 'missing' || (i.state === 'attached' && i.files.length === 0)).map((i) => i.category);
}
function checkPackageVisits(db: MockDb, visitIds: string[], fields: Record<string, string>, ignorePkg?: string) {
  if (!visitIds.length) { fields.visitIds = 'Link at least one receiving visit.'; return; }
  const visits = visitIds.map((id) => db.visits.find((v) => v.id === id));
  if (visits.some((v) => !v)) { fields.visitIds = 'One of the selected visits no longer exists.'; return; }
  const suppliers = new Set(visits.map((v) => v!.supplierDisplayName));
  // One package per supplier invoice context; several trucks may share an invoice (C-06).
  if (suppliers.size > 1) fields.visitIds = 'All linked trucks must be from the same supplier.';
  const taken = visitIds.find((id) => db.packages.some((p) => p.id !== ignorePkg && p.visitIds.includes(id)));
  if (taken) {
    const v = db.visits.find((x) => x.id === taken)!;
    fields.visitIds = `${v.officialGateEntryRef} is already linked to another document package.`;
  }
}

export const mockAdapter: ReceivingApi = {
  /* ================= auth ================= */
  async login(username, password) {
    await delay();
    const db = load();
    const u = db.users.find((x) => x.username === username.trim().toLowerCase());
    if (!u || password !== (db.passwords?.[u.id] ?? DEMO_PASSWORD)) throw new ApiError('UNAUTHENTICATED', 'Username or password is incorrect.', 401);
    if (!u.active) throw new ApiError('FORBIDDEN', 'This account has been deactivated. Contact your administrator.', 403);
    storage.set(SESSION_KEY, u.id);
    return clone(u);
  },
  me() {
    const id = storage.get(SESSION_KEY);
    const u = load().users.find((x) => x.id === id && x.active);
    return Promise.resolve(u ? clone(u) : null);
  },
  logout() {
    storage.remove(SESSION_KEY);
    return Promise.resolve();
  },

  async changePassword(input, opts) {
    const user = currentUser();
    await writeGate();
    const db = load();
    if (idem(db, opts.idempotencyKey)) return;
    const fields: Record<string, string> = {};
    if (input.currentPassword !== (db.passwords?.[user.id] ?? DEMO_PASSWORD)) fields.currentPassword = 'Current password is incorrect.';
    // Prototype mirror of brief §5.6: minimum 10 characters (breach-list check is server-only).
    if (input.newPassword.length < MIN_PASSWORD_LENGTH) fields.newPassword = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
    else if (input.newPassword === input.currentPassword) fields.newPassword = 'Choose a password different from the current one.';
    fail(fields);
    (db.passwords ??= {})[user.id] = input.newPassword;
    const u = db.users.find((x) => x.id === user.id)!;
    u.mustChangePassword = false;
    db.idempotency[opts.idempotencyKey] = true;
    save(db);
  },

  /* ================= receiving ================= */
  async listVisits(q) {
    await delay();
    const db = load();
    requireAny(['receiving.view', 'docs.prepare'], db);
    const s = (q.search ?? '').trim().toLowerCase();
    let rows = db.visits.filter((v) =>
      !s || [v.officialGateEntryRef, v.vehicleNumber, v.supplierDisplayName, v.officialGrnRef ?? ''].some((f) => f.toLowerCase().includes(s)));
    if (q.qcStatus?.length) rows = rows.filter((v) => q.qcStatus!.includes(v.qcStatus));
    if (q.exitStatus) rows = rows.filter((v) => v.exitStatus === q.exitStatus);
    if (q.grnStatus) rows = rows.filter((v) => v.grnStatus === q.grnStatus);
    rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 50;
    return { data: clone(rows.slice((page - 1) * pageSize, page * pageSize)), page, pageSize, total: rows.length };
  },

  async getVisit(id) {
    await delay();
    const db = load();
    requireAny(['receiving.view', 'qc.queue.view', 'docs.prepare', 'ho.inbox'], db);
    return clone(findVisit(db, id));
  },

  async getTimeline(visitId) {
    await delay();
    const db = load();
    requireAny(['receiving.view', 'ho.inbox'], db);
    return clone((db.timeline[visitId] ?? []).slice().sort((a, b) => b.at.localeCompare(a.at)));
  },

  getReferenceData() {
    return Promise.resolve({ suppliers: [...demoSuppliers], materials: [...demoMaterials] });
  },

  async createVisit(input: CreateReceivingVisitInput, opts: WriteOptions) {
    const user = requireCap('receiving.create');
    await writeGate();
    const db = load();
    const prior = idem<ReceivingVisit>(db, opts.idempotencyKey);
    if (prior) return clone(prior);

    const fields: Record<string, string> = {};
    checkText(fields, 'officialGateEntryRef', input.officialGateEntryRef, 'ERP Gate Entry Number', true, 40);
    checkText(fields, 'vehicleNumber', input.vehicleNumber, 'vehicle number', true, 30);
    checkText(fields, 'supplierDisplayName', input.supplierDisplayName, 'supplier', true, 80);
    checkText(fields, 'materialDisplayName', input.materialDisplayName, 'material', true, 80);
    checkText(fields, 'challanRef', input.challanRef, 'challan reference', false, 40);
    checkText(fields, 'poRef', input.poRef, 'PO reference', false, 40);
    if (!input.grossWeight || !isDecimalString(input.grossWeight.value) || isZero(input.grossWeight.value)) {
      fields.grossWeight = 'Enter a gross weight greater than zero.';
    }
    fail(fields);

    // Demonstration duplicate rule: exact same official ref already exists. The real
    // uniqueness scope is NOT decided (KPM-X-003, D-01) — the backend will own this.
    const dup = db.visits.find((v) => v.officialGateEntryRef === input.officialGateEntryRef);
    if (dup) {
      throw new ApiError('DUPLICATE_CANDIDATE',
        `A receiving visit with Gate Entry Number ${dup.officialGateEntryRef} already exists (vehicle ${dup.vehicleNumber}).`,
        409, { officialGateEntryRef: 'This Gate Entry Number is already recorded.' }, requestId(), { existingId: dup.id });
    }

    const now = nowIso();
    db.seq += 1;
    const v: ReceivingVisit = {
      id: `demo-visit-${String(db.seq).padStart(3, '0')}`,
      officialGateEntryRef: input.officialGateEntryRef,
      vehicleNumber: input.vehicleNumber,
      supplierDisplayName: input.supplierDisplayName,
      materialDisplayName: input.materialDisplayName,
      challanRef: input.challanRef || null,
      poRef: input.poRef || null,
      arrivedAt: input.arrivedAt ?? null,
      grossWeight: input.grossWeight,
      tareWeight: null,
      notes: input.notes || null,
      qcStatus: 'pending',
      exitStatus: 'on_premises',
      grnStatus: 'not_recorded',
      officialGrnRef: null,
      physicalExitAt: null,
      createdAt: now,
      createdBy: user.displayName,
      updatedAt: now,
      version: 1,
    };
    db.visits.push(v);
    logVisit(db, v.id, { at: now, actor: user.displayName, action: 'Receiving visit created',
      detail: `Gross ${v.grossWeight!.value} kg recorded. Sent to QC pending list.`, source: 'app' });
    db.idempotency[opts.idempotencyKey] = v;
    save(db);
    return clone(v);
  },

  async correctVisit(id, input, opts) {
    const user = requireCap('receiving.edit');
    await writeGate();
    const db = load();
    const prior = idem<ReceivingVisit>(db, opts.idempotencyKey);
    if (prior) return clone(prior);
    const v = findVisit(db, id);
    checkVersion(v.version, opts);
    // Prototype assumption: Gate corrections allowed only while the truck is on premises (02 §5, D-12).
    if (v.exitStatus === 'exited') throw rule('This truck has exited. Gate details are locked; a correction after exit needs an authorised process (pending KPMPL).');

    const fields: Record<string, string> = {};
    checkText(fields, 'vehicleNumber', input.vehicleNumber, 'vehicle number', true, 30);
    checkText(fields, 'supplierDisplayName', input.supplierDisplayName, 'supplier', true, 80);
    checkText(fields, 'materialDisplayName', input.materialDisplayName, 'material', true, 80);
    checkText(fields, 'challanRef', input.challanRef, 'challan reference', false, 40);
    checkText(fields, 'poRef', input.poRef, 'PO reference', false, 40);
    if ((input.notes ?? '').length > 500) fields.notes = 'Notes must be 500 characters or fewer.';
    if (!isDecimalString(input.grossWeight.value) || isZero(input.grossWeight.value)) fields.grossWeight = 'Enter a gross weight greater than zero.';
    else if (v.tareWeight && !deriveNet(input.grossWeight, v.tareWeight)) fields.grossWeight = `Gross must be more than the recorded tare (${v.tareWeight.value} kg).`;
    checkReason(fields, 'reason', input.reason, 'this correction');
    fail(fields);

    const changes: string[] = [];
    const track = (label: string, before: string | null, after: string | null) => {
      if ((before ?? '') !== (after ?? '')) changes.push(`${label}: ${before || '—'} → ${after || '—'}`);
    };
    track('Vehicle', v.vehicleNumber, input.vehicleNumber);
    track('Supplier', v.supplierDisplayName, input.supplierDisplayName);
    track('Material', v.materialDisplayName, input.materialDisplayName);
    track('Challan', v.challanRef, input.challanRef || null);
    track('PO', v.poRef, input.poRef || null);
    track('Notes', v.notes, input.notes || null);
    track('Gross (kg)', v.grossWeight?.value ?? null, input.grossWeight.value);
    if (!changes.length) throw new ApiError('VALIDATION_FAILED', 'Nothing was changed.', 422, { reason: 'Change at least one field, or go back.' }, requestId());
    if (input.supplierDisplayName !== v.supplierDisplayName && db.packages.some((p) => p.visitIds.includes(v.id))) {
      throw rule('This visit is linked to a document package. Remove it from the package before changing the supplier.');
    }

    Object.assign(v, {
      vehicleNumber: input.vehicleNumber, supplierDisplayName: input.supplierDisplayName, materialDisplayName: input.materialDisplayName,
      challanRef: input.challanRef || null, poRef: input.poRef || null, notes: input.notes || null, grossWeight: input.grossWeight,
    });
    bumpVisit(v);
    logVisit(db, v.id, { actor: user.displayName, action: 'Gate details corrected', detail: `${changes.join('; ')}. Reason: ${input.reason.trim()}`, source: 'app' });
    db.idempotency[opts.idempotencyKey] = v;
    save(db);
    return clone(v);
  },

  /* ================= gate follow-up ================= */
  async recordTare(id, input, opts) {
    const user = requireCap('gate.followup');
    await writeGate();
    const db = load();
    const prior = idem<ReceivingVisit>(db, opts.idempotencyKey);
    if (prior) return clone(prior);
    const v = findVisit(db, id);
    checkVersion(v.version, opts);
    if (v.exitStatus === 'exited') throw rule('The truck has already exited. Tare is locked.');
    const fields: Record<string, string> = {};
    if (!isDecimalString(input.value) || isZero(input.value)) fields.value = 'Enter a tare weight greater than zero.';
    else if (!deriveNet(v.grossWeight, { value: input.value, unit: 'kg' })) fields.value = `Tare must be less than the gross weight (${v.grossWeight?.value ?? '—'} kg).`;
    const isCorrection = !!v.tareWeight;
    if (isCorrection) checkReason(fields, 'correctionReason', input.correctionReason, 'changing the tare');
    fail(fields);
    const before = v.tareWeight?.value;
    v.tareWeight = { value: input.value, unit: 'kg' };
    bumpVisit(v);
    logVisit(db, v.id, {
      actor: user.displayName, source: 'app',
      action: isCorrection ? 'Tare corrected' : 'Tare recorded',
      detail: isCorrection ? `Tare ${before} → ${input.value} kg. Reason: ${input.correctionReason!.trim()}` : `Tare ${input.value} kg. Net ${deriveNet(v.grossWeight, v.tareWeight)} kg (display only).`,
    });
    db.idempotency[opts.idempotencyKey] = v;
    save(db);
    return clone(v);
  },

  async recordExit(id, input, opts) {
    const user = requireCap('gate.followup');
    await writeGate();
    const db = load();
    const prior = idem<ReceivingVisit>(db, opts.idempotencyKey);
    if (prior) return clone(prior);
    const v = findVisit(db, id);
    checkVersion(v.version, opts);
    if (v.exitStatus === 'exited') throw rule('Physical exit is already recorded for this truck.');
    // Prototype assumptions (D-04): empty weighment precedes exit (02 §1), and QC must have
    // recorded readings. QC submission alone never triggers exit (05 §3).
    if (!v.tareWeight) throw rule('Record the tare (empty) weight before recording exit.');
    if (v.qcStatus === 'pending' || v.qcStatus === 'in_progress') throw rule('QC has not submitted readings for this truck yet.');
    const fields: Record<string, string> = {};
    if (!input.millChecksConfirmed) fields.millChecksConfirmed = 'Confirm the mill’s exit checks were completed.';
    const at = Date.parse(input.physicalExitAt);
    if (Number.isNaN(at)) fields.physicalExitAt = 'Enter the exit date and time.';
    else if (at > Date.now() + 5 * 60000) fields.physicalExitAt = 'Exit time cannot be in the future.';
    else if (at < Date.parse(v.createdAt) - 60000) fields.physicalExitAt = 'Exit time cannot be before the truck was recorded at the Gate.';
    if ((input.remarks ?? '').length > 500) fields.remarks = 'Remarks must be 500 characters or fewer.';
    fail(fields);
    v.exitStatus = 'exited';
    v.physicalExitAt = new Date(at).toISOString();
    bumpVisit(v);
    logVisit(db, v.id, {
      actor: user.displayName, source: 'app', action: 'Physical exit recorded',
      detail: [`Staff confirmed mill exit checks.`, v.grnStatus === 'not_recorded' ? 'GRN not yet recorded.' : '', input.remarks?.trim() ? `Remarks: ${input.remarks.trim()}` : ''].filter(Boolean).join(' '),
    });
    db.idempotency[opts.idempotencyKey] = v;
    save(db);
    return clone(v);
  },

  async recordGrn(id, input, opts) {
    const user = requireCap('gate.followup');
    await writeGate();
    const db = load();
    const prior = idem<ReceivingVisit>(db, opts.idempotencyKey);
    if (prior) return clone(prior);
    const v = findVisit(db, id);
    checkVersion(v.version, opts);
    // Prototype assumption: DataMan generates the GRN after empty weighment (02 §1).
    if (!v.tareWeight) throw rule('Record the tare weight first. The GRN is generated in DataMan after empty weighment.');
    const fields: Record<string, string> = {};
    checkText(fields, 'officialGrnRef', input.officialGrnRef, 'official GRN reference', true, 40);
    if (!input.verifiedInDataManByStaff) fields.verifiedInDataManByStaff = 'Confirm you checked this GRN in DataMan.';
    const isCorrection = v.grnStatus === 'reference_recorded';
    if (isCorrection) {
      if (input.officialGrnRef === v.officialGrnRef) fields.officialGrnRef = 'This is the same reference already recorded.';
      checkReason(fields, 'correctionReason', input.correctionReason, 'changing the GRN reference');
    }
    fail(fields);
    const before = v.officialGrnRef;
    v.officialGrnRef = input.officialGrnRef; // opaque string, stored exactly as typed
    v.grnStatus = 'reference_recorded';
    bumpVisit(v);
    // GRN may legitimately repeat across visits (D-01/D-11): note it, don't block.
    const shared = db.visits.filter((x) => x.id !== v.id && x.officialGrnRef === input.officialGrnRef).map((x) => x.officialGateEntryRef);
    logVisit(db, v.id, {
      actor: user.displayName, source: 'manual_staff_confirmation',
      action: isCorrection ? 'Official GRN reference corrected' : 'Official GRN reference recorded',
      detail: [isCorrection ? `${before} → ${input.officialGrnRef}. Reason: ${input.correctionReason!.trim()}.` : `${input.officialGrnRef} — staff states it was checked in DataMan.`,
        shared.length ? `Same GRN also recorded on ${shared.join(', ')}.` : ''].filter(Boolean).join(' '),
    });
    db.idempotency[opts.idempotencyKey] = v;
    save(db);
    return clone(v);
  },

  /* ================= QC ================= */
  async getQcQueue() {
    await delay();
    const db = load();
    requireCap('qc.queue.view', db);
    const items: QcQueueItem[] = db.visits
      .filter((v) => ['pending', 'in_progress', 'returned', 'submitted'].includes(v.qcStatus))
      .map((v) => queueItem(db, v))
      .sort((a, b) => a.visit.createdAt.localeCompare(b.visit.createdAt)); // oldest first: work in arrival order
    return clone(items);
  },

  async getQcInspection(visitId) {
    await delay();
    const db = load();
    requireAny(['qc.queue.view', 'receiving.view', 'ho.inbox'], db);
    return clone(db.inspections.find((i) => i.visitId === visitId) ?? null);
  },

  async submitQc(visitId: string, input: QcSubmitInput, opts) {
    const user = requireCap('qc.measure');
    await writeGate();
    const db = load();
    const prior = idem<QcInspection>(db, opts.idempotencyKey);
    if (prior) return clone(prior);

    const v = findVisit(db, visitId);
    checkVersion(v.version, opts);
    if (!['pending', 'in_progress', 'returned'].includes(v.qcStatus)) {
      throw rule('This inspection has already been submitted. Corrections are possible only after it is returned.');
    }

    const fields: Record<string, string> = {};
    for (const m of input.measurements) {
      if (!isDecimalString(m.value)) fields[m.code] = 'Enter a valid reading.';
    }
    if (input.intent === 'submit') {
      for (const code of ['moisture', 'impurity'] as const) {
        if (!input.measurements.some((m) => m.code === code)) fields[code] = `Enter the ${code} reading before submitting.`;
      }
    }
    if ((input.remarks ?? '').length > 1000) fields.remarks = 'Remarks must be 1000 characters or fewer.';
    let insp = db.inspections.find((i) => i.visitId === visitId);
    const isResubmission = v.qcStatus === 'returned' || (insp?.revisions.some((r) => r.state === 'submitted') ?? false);
    if (input.intent === 'submit' && isResubmission && !(input.revisionReason ?? '').trim()) {
      fields.revisionReason = 'Enter the reason for this revised submission.';
    }
    fail(fields);

    const now = nowIso();
    if (!insp) {
      insp = { inspectionId: `demo-qc-${visitId.slice(-3)}`, visitId, qcStatus: 'pending', revisions: [], reviews: [], deductionCalculation: { status: 'not_configured', value: null } };
      db.inspections.push(insp);
    }
    const last = insp.revisions.at(-1);
    const rev = {
      revision: last && last.state === 'draft' ? last.revision : (last?.revision ?? 0) + 1,
      state: input.intent === 'submit' ? 'submitted' as const : 'draft' as const,
      measurements: input.measurements,
      remarks: input.remarks?.trim() || null,
      revisionReason: input.revisionReason?.trim() || null,
      recordedBy: user.displayName,
      recordedAt: now,
    };
    if (last && last.state === 'draft') insp.revisions[insp.revisions.length - 1] = rev; else insp.revisions.push(rev);

    // A returned case stays "returned" while a draft correction is being prepared.
    const newStatus = input.intent === 'submit' ? 'submitted' : v.qcStatus === 'returned' ? 'returned' : 'in_progress';
    insp.qcStatus = newStatus;
    v.qcStatus = newStatus;
    bumpVisit(v);
    logVisit(db, visitId, {
      at: now, actor: user.displayName, source: 'app',
      action: input.intent === 'submit' ? `QC readings submitted (revision ${rev.revision})` : `QC draft saved (revision ${rev.revision})`,
      detail: input.intent === 'submit' ? (rev.revisionReason ? `Revision reason: ${rev.revisionReason}` : 'No automatic deduction configured.') : undefined,
    });
    db.idempotency[opts.idempotencyKey] = insp;
    save(db);
    return clone(insp);
  },

  // D-03 (2026-11-03): the QC Operator who submitted the readings records the final decision.
  async decideQc(visitId, input, opts) {
    const user = requireCap('qc.decide');
    await writeGate();
    const db = load();
    const prior = idem<QcInspection>(db, opts.idempotencyKey);
    if (prior) return clone(prior);
    const v = findVisit(db, visitId);
    checkVersion(v.version, opts);
    const insp = db.inspections.find((i) => i.visitId === visitId);
    if (v.qcStatus !== 'submitted' || !insp) throw rule('A QC decision can be recorded only after the readings are submitted. Refresh to see its current state.');
    const fields: Record<string, string> = {};
    if (!['returned', 'accepted', 'accepted_with_deduction', 'rejected'].includes(input.outcome)) fields.outcome = 'Choose an outcome.';
    const needsReason = input.outcome !== 'accepted';
    if (needsReason) checkReason(fields, 'reason', input.reason, 'this outcome', 1000);
    else if ((input.reason ?? '').length > 1000) fields.reason = 'Reason must be 1000 characters or fewer.';
    fail(fields);
    const forRevision = insp.revisions.filter((r) => r.state === 'submitted').at(-1)!.revision;
    insp.reviews.push({ outcome: input.outcome, reason: input.reason.trim() || 'No remarks.', demonstrationOnly: false, recordedBy: user.displayName, recordedAt: nowIso(), forRevision });
    insp.qcStatus = input.outcome;
    v.qcStatus = input.outcome;
    bumpVisit(v);
    const label = { returned: 'QC returned for correction', accepted: 'QC accepted', accepted_with_deduction: 'QC accepted with deduction', rejected: 'QC rejected' }[input.outcome];
    logVisit(db, visitId, {
      actor: user.displayName, source: 'app', action: label,
      detail: [input.reason.trim(), input.outcome === 'accepted_with_deduction' ? 'Deduction amount not calculated. Formula pending KPMPL confirmation.' : ''].filter(Boolean).join(' '),
    });
    db.idempotency[opts.idempotencyKey] = insp;
    save(db);
    return clone(insp);
  },

  /* ================= overview ================= */
  async exportReceivingCsv(range = {}) {
    await delay();
    const db = load();
    requireCap('overview.view', db);
    // Same columns as v0.5 (report columns pending D-10); the server endpoint must match them.
    const rows = db.visits
      .filter((v) => (!range.from || v.createdAt >= range.from) && (!range.to || v.createdAt <= range.to))
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const csv = buildCsv(RECEIVING_CSV_COLUMNS, rows.map((v) => [v.officialGateEntryRef, v.vehicleNumber, v.supplierDisplayName, v.materialDisplayName,
      v.grossWeight?.value, v.tareWeight?.value, deriveNet(v.grossWeight, v.tareWeight), v.qcStatus, v.exitStatus,
      v.physicalExitAt ? formatDateTime(v.physicalExitAt) : '', v.grnStatus, v.officialGrnRef, formatDateTime(v.createdAt), v.createdBy]));
    return { filename: `kpmpl-receiving-demo-${new Date().toISOString().slice(0, 10)}.csv`, blob: new Blob([csv], { type: 'text/csv;charset=utf-8' }) };
  },

  async getOverview() {
    await delay();
    const db = load();
    requireCap('overview.view', db);
    const V = db.visits;
    const today = new Date().toDateString();
    const isToday = (iso: string | null) => !!iso && new Date(iso).toDateString() === today;
    const onPrem = V.filter((v) => v.exitStatus === 'on_premises');
    const qcHasResult = (s: ReceivingVisit['qcStatus']) => !['pending', 'in_progress'].includes(s);
    const erpCount = (type: string, status: 'pending' | 'confirmed', gate?: (p: DocumentPackage) => boolean) =>
      db.packages.filter((p) => HO_VISIBLE.includes(p.status) && (!gate || gate(p)) && p.erp.find((m) => m.type === type)?.status === status).length;
    const confirmed = (p: DocumentPackage, t: string) => p.erp.find((m) => m.type === t)?.status === 'confirmed';
    const o: OverviewData = {
      generatedAt: nowIso(),
      receiving: { total: V.length, today: V.filter((v) => isToday(v.createdAt)).length, onPremises: onPrem.length },
      qc: {
        awaitingInspection: V.filter((v) => v.qcStatus === 'pending').length,
        inProgress: V.filter((v) => v.qcStatus === 'in_progress').length,
        returned: V.filter((v) => v.qcStatus === 'returned').length,
        awaitingReview: V.filter((v) => v.qcStatus === 'submitted').length,
        decided: V.filter((v) => ['accepted', 'accepted_with_deduction', 'rejected'].includes(v.qcStatus)).length,
      },
      gate: {
        needsTare: onPrem.filter((v) => !v.tareWeight).length,
        readyToExit: onPrem.filter((v) => v.tareWeight && qcHasResult(v.qcStatus)).length,
        exitedToday: V.filter((v) => isToday(v.physicalExitAt)).length,
        grnPending: V.filter((v) => v.grnStatus === 'not_recorded').length,
      },
      documents: {
        draft: db.packages.filter((p) => ['draft', 'ready_for_gate_check'].includes(p.status)).length,
        withHo: db.packages.filter((p) => ['submitted_to_ho', 'under_ho_review', 'resubmitted'].includes(p.status)).length,
        correctionRequested: db.packages.filter((p) => p.status === 'correction_requested').length,
        verified: db.packages.filter((p) => p.status === 'verified').length,
      },
      erp: {
        approvalPending: erpCount('plant_head_grn_approval', 'pending'),
        voucherPending: erpCount('purchase_voucher', 'pending', (p) => confirmed(p, 'plant_head_grn_approval')),
        postingPending: erpCount('final_posting', 'pending', (p) => confirmed(p, 'purchase_voucher')),
        posted: erpCount('final_posting', 'confirmed'),
      },
      oldestAwaitingQc: clone(V.filter((v) => ['pending', 'in_progress', 'returned'].includes(v.qcStatus)).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(0, 5)),
      longestOnPremises: clone(onPrem.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(0, 5)),
      grnPendingList: clone(V.filter((v) => v.grnStatus === 'not_recorded' && v.exitStatus === 'exited').sort((a, b) => (a.physicalExitAt ?? '').localeCompare(b.physicalExitAt ?? '')).slice(0, 5)),
    };
    return o;
  },

  /* ================= administration ================= */
  async listUsers() {
    await delay();
    const db = load();
    requireCap('admin.users', db);
    return clone(db.users);
  },

  async createUser(input, opts) {
    const admin = requireCap('admin.users');
    await writeGate();
    const db = load();
    const prior = idem<CreatedUser>(db, opts.idempotencyKey);
    if (prior) return clone(prior);
    const fields: Record<string, string> = {};
    const username = input.username.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(username)) fields.username = 'Use 3–32 lowercase letters, digits, dot, dash or underscore.';
    else if (db.users.some((u) => u.username === username)) fields.username = 'This username is already taken.';
    checkText(fields, 'displayName', input.displayName, 'display name', true, 60);
    if (!input.roles.length) fields.roles = 'Choose at least one role.';
    else if (input.roles.some((r) => !ALL_ROLES.includes(r))) fields.roles = 'Unknown role.';
    fail(fields);
    db.seq += 1;
    const u: User = { id: `demo-user-${db.seq}`, username, displayName: input.displayName.trim(), roles: input.roles, synthetic: true, active: true, mustChangePassword: true };
    const temporaryPassword = mockTemporaryPassword();
    db.users.push(u);
    (db.passwords ??= {})[u.id] = temporaryPassword;
    const created: CreatedUser = { ...u, temporaryPassword };
    db.idempotency[opts.idempotencyKey] = created;
    void admin;
    save(db);
    return clone(created);
  },

  async updateUser(id, input, opts) {
    void opts; // idempotency is not simulated for this call
    const admin = requireCap('admin.users');
    await writeGate();
    const db = load();
    const u = db.users.find((x) => x.id === id);
    if (!u) throw new ApiError('NOT_FOUND', 'User not found.', 404);
    const fields: Record<string, string> = {};
    if (input.displayName !== undefined) checkText(fields, 'displayName', input.displayName, 'display name', true, 60);
    if (input.roles !== undefined && !input.roles.length) fields.roles = 'Choose at least one role.';
    fail(fields);
    const next = { ...u, ...input, displayName: input.displayName?.trim() ?? u.displayName };
    const activeAdmins = db.users.map((x) => (x.id === id ? next : x)).filter((x) => x.active && x.roles.includes('admin'));
    if (!activeAdmins.length) throw rule('At least one active System Admin must remain.');
    if (id === admin.id && input.active === false) throw rule('You cannot deactivate your own account.');
    Object.assign(u, next);
    save(db);
    return clone(u);
  },

  async adminResetPassword(id, opts) {
    requireCap('admin.users');
    await writeGate();
    const db = load();
    const prior = idem<{ temporaryPassword: string }>(db, opts.idempotencyKey);
    if (prior) return clone(prior);
    const u = db.users.find((x) => x.id === id);
    if (!u) throw new ApiError('NOT_FOUND', 'User not found.', 404);
    const temporaryPassword = mockTemporaryPassword();
    (db.passwords ??= {})[u.id] = temporaryPassword;
    u.mustChangePassword = true;
    const result = { temporaryPassword };
    db.idempotency[opts.idempotencyKey] = result;
    save(db);
    // Brief §5.6: a reset revokes the user's sessions. The mock has one session per tab.
    if (storage.get(SESSION_KEY) === u.id) storage.remove(SESSION_KEY);
    return clone(result);
  },

  /* ================= module 2 ================= */
  async listPackages(scope) {
    await delay();
    const db = load();
    if (scope === 'gate') requireCap('docs.prepare', db);
    else if (scope === 'ho') requireCap('ho.inbox', db);
    else requireCap('accounting.inbox', db);
    const list = scope === 'ho' ? db.packages.filter((p) => HO_VISIBLE.includes(p.status))
      : scope === 'accounting' ? db.packages.filter((p) => ACCOUNTING_VISIBLE.includes(p.status))
      : db.packages;
    return list.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map((p) => viewOf(db, p));
  },

  async getPackage(id) {
    await delay();
    const db = load();
    const u = requireAny(['docs.prepare', 'ho.inbox', 'accounting.inbox'], db);
    const p = findPkg(db, id);
    // Union visibility: preparers see all, HO sees HO_VISIBLE, Accounts sees ACCOUNTING_VISIBLE.
    const visible = can(u, 'docs.prepare')
      || (can(u, 'ho.inbox') && HO_VISIBLE.includes(p.status))
      || (can(u, 'accounting.inbox') && ACCOUNTING_VISIBLE.includes(p.status));
    if (!visible) throw new ApiError('NOT_FOUND', 'Package not found.', 404);
    return viewOf(db, p);
  },

  async createPackage(input, opts) {
    const user = requireCap('docs.prepare');
    await writeGate();
    const db = load();
    const prior = idem<string>(db, opts.idempotencyKey);
    if (prior) return viewOf(db, findPkg(db, prior));
    const fields: Record<string, string> = {};
    checkPackageVisits(db, input.visitIds, fields);
    checkText(fields, 'invoiceRef', input.invoiceRef, 'supplier invoice reference', false, 40);
    fail(fields);
    db.seq += 1;
    const now = nowIso();
    const n = db.packages.length + 1;
    const visits = input.visitIds.map((id) => findVisit(db, id));
    const p: DocumentPackage = {
      id: `demo-pkg-${db.seq}`, packageRef: `DEMO-PKG-${String(n).padStart(4, '0')}`, visitIds: input.visitIds,
      invoiceRef: input.invoiceRef?.trim() || null, supplierDisplayName: visits[0]!.supplierDisplayName, status: 'draft',
      checklistVersion: 'demo-checklist-0 (not approved)',
      items: DOC_CATEGORIES.map((category) => ({ category, state: 'missing', files: [], notApplicableReason: null, hoCheck: 'unchecked', hoNote: null })),
      submittedBy: null, submittedAt: null, corrections: [],
      erp: ERP_ORDER.map((type) => ({ type, status: 'pending', dataManRef: null, erpOccurredAt: null, note: null, confirmedBy: null, confirmedAt: null, source: 'manual_staff_confirmation' })),
      reminders: [], history: [], accounting: null, createdBy: user.displayName, createdAt: now, updatedAt: now, version: 0,
    };
    logPkg(p, user.displayName, 'Package created', `Linked ${visits.map((v) => v.officialGateEntryRef).join(', ')}.`);
    db.packages.push(p);
    visits.forEach((v) => logVisit(db, v.id, { actor: user.displayName, action: `Linked to document package ${p.packageRef}`, source: 'app' }));
    db.idempotency[opts.idempotencyKey] = p.id;
    save(db);
    return viewOf(db, p);
  },

  async updatePackage(id, input, opts) {
    const user = requireCap('docs.prepare');
    await writeGate();
    const db = load();
    const p = findPkg(db, id);
    checkVersion(p.version, opts);
    if (!GATE_EDITABLE.includes(p.status)) throw rule('This package is with Head Office and cannot be changed now.');
    const fields: Record<string, string> = {};
    if (input.visitIds) checkPackageVisits(db, input.visitIds, fields, p.id);
    if (input.invoiceRef !== undefined) checkText(fields, 'invoiceRef', input.invoiceRef, 'supplier invoice reference', false, 40);
    fail(fields);
    const parts: string[] = [];
    if (input.visitIds) {
      const added = input.visitIds.filter((x) => !p.visitIds.includes(x));
      const removed = p.visitIds.filter((x) => !input.visitIds!.includes(x));
      const ref = (vid: string) => findVisit(db, vid).officialGateEntryRef;
      if (added.length) parts.push(`Added ${added.map(ref).join(', ')}`);
      if (removed.length) parts.push(`Removed ${removed.map(ref).join(', ')}`);
      added.forEach((vid) => logVisit(db, vid, { actor: user.displayName, action: `Linked to document package ${p.packageRef}`, source: 'app' }));
      removed.forEach((vid) => logVisit(db, vid, { actor: user.displayName, action: `Removed from document package ${p.packageRef}`, source: 'app' }));
      p.visitIds = input.visitIds;
      p.supplierDisplayName = findVisit(db, input.visitIds[0]!).supplierDisplayName;
    }
    if (input.invoiceRef !== undefined && (input.invoiceRef.trim() || null) !== p.invoiceRef) {
      parts.push(`Invoice ref ${p.invoiceRef ?? '—'} → ${input.invoiceRef.trim() || '—'}`);
      p.invoiceRef = input.invoiceRef.trim() || null;
    }
    if (parts.length) logPkg(p, user.displayName, 'Package details updated', parts.join('; ') + '.');
    save(db);
    return viewOf(db, p);
  },

  async attachFile(id, input, opts) {
    const user = requireCap('docs.prepare');
    await writeGate();
    const db = load();
    const prior = idem<string>(db, opts.idempotencyKey);
    if (prior) return viewOf(db, findPkg(db, prior));
    const p = findPkg(db, id);
    checkVersion(p.version, opts);
    if (!GATE_EDITABLE.includes(p.status)) throw rule('This package is with Head Office. Files can be changed only if HO requests a correction.');
    const fields: Record<string, string> = {};
    const { file } = input;
    // Prototype file rule: PDF only, up to 10 MB (brief §5.9; the server also checks %PDF- magic bytes and scans).
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) fields.file = 'Only PDF files can be attached.';
    else if (file.size > 10 * 1024 * 1024) fields.file = 'The file is larger than 10 MB.';
    else if (file.size === 0) fields.file = 'The file is empty.';
    fail(fields);
    const fileId = `file-${uuidV4()}`;
    const item = p.items.find((i) => i.category === input.category)!;
    item.files.push({ id: fileId, name: file.name.slice(0, 120), sizeBytes: file.size, mimeType: 'application/pdf', uploadedAt: nowIso(), uploadedBy: user.displayName, synthetic: false });
    try { fileBlobs.set(fileId, URL.createObjectURL(file)); } catch { /* no object URLs (tests): file is listed without a preview */ }
    item.state = 'attached';
    item.notApplicableReason = null;
    item.hoCheck = 'unchecked';
    logPkg(p, user.displayName, 'File attached', `${docCategoryMeta[input.category].label}: ${file.name}`);
    if (p.status === 'ready_for_gate_check') { p.status = 'draft'; logPkg(p, user.displayName, 'Returned to draft', 'Files changed after it was marked ready.'); }
    db.idempotency[opts.idempotencyKey] = p.id;
    save(db);
    return viewOf(db, p);
  },

  async removeFile(id, category, fileId, opts) {
    const user = requireCap('docs.prepare');
    await writeGate();
    const db = load();
    const p = findPkg(db, id);
    checkVersion(p.version, opts);
    if (!GATE_EDITABLE.includes(p.status)) throw rule('This package is with Head Office and cannot be changed now.');
    const item = p.items.find((i) => i.category === category)!;
    const f = item.files.find((x) => x.id === fileId);
    if (!f) throw new ApiError('NOT_FOUND', 'File not found.', 404);
    item.files = item.files.filter((x) => x.id !== fileId);
    if (!item.files.length) item.state = 'missing';
    item.hoCheck = 'unchecked';
    const blobUrl = fileBlobs.get(fileId);
    if (blobUrl) { try { URL.revokeObjectURL(blobUrl); } catch { /* ignore */ } fileBlobs.delete(fileId); }
    logPkg(p, user.displayName, 'File removed', `${docCategoryMeta[category].label}: ${f.name}`);
    if (p.status === 'ready_for_gate_check') { p.status = 'draft'; logPkg(p, user.displayName, 'Returned to draft', 'Files changed after it was marked ready.'); }
    save(db);
    return viewOf(db, p);
  },

  async setNotApplicable(id, category, reason, opts) {
    const user = requireCap('docs.prepare');
    await writeGate();
    const db = load();
    const p = findPkg(db, id);
    checkVersion(p.version, opts);
    if (!GATE_EDITABLE.includes(p.status)) throw rule('This package is with Head Office and cannot be changed now.');
    const item = p.items.find((i) => i.category === category)!;
    if (reason !== null) {
      const fields: Record<string, string> = {};
      checkReason(fields, 'reason', reason, 'marking this document not applicable', 300);
      fail(fields);
      if (item.files.length) throw rule('Remove the attached files before marking this document not applicable.');
      item.state = 'not_applicable';
      item.notApplicableReason = reason.trim();
      logPkg(p, user.displayName, 'Marked not applicable', `${docCategoryMeta[category].label}: ${reason.trim()}`);
    } else {
      item.state = item.files.length ? 'attached' : 'missing';
      item.notApplicableReason = null;
      logPkg(p, user.displayName, 'Not-applicable mark removed', docCategoryMeta[category].label);
    }
    item.hoCheck = 'unchecked';
    if (p.status === 'ready_for_gate_check') { p.status = 'draft'; logPkg(p, user.displayName, 'Returned to draft', 'Checklist changed after it was marked ready.'); }
    save(db);
    return viewOf(db, p);
  },

  async packageAction(id, action: PackageAction, opts) {
    await writeGate();
    const db = load();
    const p = findPkg(db, id);
    const prior = idem<string>(db, opts.idempotencyKey);
    if (prior) return viewOf(db, p);
    checkVersion(p.version, opts);
    const fields: Record<string, string> = {};
    switch (action.kind) {
      case 'mark_ready': {
        const u = requireCap('docs.prepare', db);
        if (p.status !== 'draft') throw rule('Only a draft package can be marked ready.');
        const miss = missingRows(p);
        if (miss.length) throw rule(`Attach or mark not applicable: ${miss.map((c) => docCategoryMeta[c].label).join(', ')}.`);
        p.status = 'ready_for_gate_check';
        logPkg(p, u.displayName, 'Marked ready for authority check');
        break;
      }
      case 'back_to_draft': {
        const u = requireCap('docs.submit', db);
        if (p.status !== 'ready_for_gate_check') throw rule('Only a package waiting for authority check can be sent back.');
        checkReason(fields, 'reason', action.reason, 'sending it back');
        fail(fields);
        p.status = 'draft';
        logPkg(p, u.displayName, 'Sent back to Gate for changes', action.reason.trim());
        break;
      }
      case 'submit_to_ho': {
        const u = requireCap('docs.submit', db);
        if (!['ready_for_gate_check', 'correction_requested'].includes(p.status)) throw rule('This package is not waiting to be sent.');
        const miss = missingRows(p);
        if (miss.length) throw rule(`Attach or mark not applicable: ${miss.map((c) => docCategoryMeta[c].label).join(', ')}.`);
        if (!action.confirmComplete) fields.confirmComplete = 'Confirm you checked the packet is complete.';
        const isResub = p.status === 'correction_requested';
        if (isResub) checkReason(fields, 'responseNote', action.responseNote, 'what was corrected');
        fail(fields);
        if (isResub) {
          const open = p.corrections.find((c) => !c.resolvedAt);
          if (open) { open.resolvedAt = nowIso(); open.responseNote = action.responseNote!.trim(); }
        }
        p.status = isResub ? 'resubmitted' : 'submitted_to_ho';
        p.submittedBy = u.displayName;
        p.submittedAt = nowIso();
        logPkg(p, u.displayName, isResub ? 'Resubmitted to Head Office' : 'Sent to Head Office',
          isResub ? `Correction note: ${action.responseNote!.trim()}` : 'Authority confirmed the packet is complete. Head Office can open the PDFs now.');
        p.visitIds.forEach((vid) => logVisit(db, vid, { actor: u.displayName, action: `Documents ${isResub ? 'resubmitted' : 'sent'} to Head Office (${p.packageRef})`, source: 'app' }));
        break;
      }
      case 'start_review': {
        const u = requireCap('ho.review', db);
        if (!['submitted_to_ho', 'resubmitted'].includes(p.status)) throw rule('This package is not waiting for review.');
        p.status = 'under_ho_review';
        logPkg(p, u.displayName, 'Head Office review started');
        break;
      }
      case 'request_correction': {
        const u = requireCap('ho.review', db);
        if (p.status !== 'under_ho_review') throw rule('Start the review before requesting a correction.');
        checkReason(fields, 'reason', action.reason, 'the correction', 1000);
        if (!action.categories.length) fields.categories = 'Choose at least one document that needs correction.';
        fail(fields);
        p.corrections.push({ id: evId(), reason: action.reason.trim(), categories: action.categories, requestedBy: u.displayName, requestedAt: nowIso(), resolvedAt: null, responseNote: null });
        action.categories.forEach((c) => { const it = p.items.find((i) => i.category === c)!; it.hoCheck = 'issue'; it.hoNote ??= action.reason.trim(); });
        p.status = 'correction_requested';
        logPkg(p, u.displayName, 'Correction requested', `${action.categories.map((c) => docCategoryMeta[c].label).join(', ')} — ${action.reason.trim()}`);
        break;
      }
      case 'verify': {
        const u = requireCap('ho.review', db);
        if (p.status !== 'under_ho_review') throw rule('Start the review before verifying.');
        const relevant = p.items.filter((i) => i.state === 'attached');
        const unchecked = relevant.filter((i) => i.hoCheck !== 'ok');
        if (unchecked.length) throw rule(`Mark every attached document as checked first: ${unchecked.map((i) => docCategoryMeta[i.category].label).join(', ')}.`);
        p.status = 'verified';
        logPkg(p, u.displayName, 'Documents verified by Head Office', 'ERP milestones are tracked separately.');
        break;
      }
    }
    db.idempotency[opts.idempotencyKey] = p.id;
    save(db);
    return viewOf(db, p);
  },

  async hoCheckItem(id, category, check, note, opts) {
    const u = requireCap('ho.review');
    await writeGate();
    const db = load();
    const p = findPkg(db, id);
    checkVersion(p.version, opts);
    if (p.status !== 'under_ho_review') throw rule('Start the review to check documents.');
    const item = p.items.find((i) => i.category === category)!;
    if (item.state !== 'attached') throw rule('Only attached documents can be checked.');
    if (check === 'issue') {
      const fields: Record<string, string> = {};
      checkReason(fields, 'note', note ?? '', 'the issue', 500);
      fail(fields);
    }
    item.hoCheck = check;
    item.hoNote = check === 'issue' ? note!.trim() : null;
    logPkg(p, u.displayName, check === 'ok' ? 'Document checked' : check === 'issue' ? 'Issue noted on document' : 'Document check cleared',
      `${docCategoryMeta[category].label}${check === 'issue' ? `: ${note!.trim()}` : ''}`);
    save(db);
    return viewOf(db, p);
  },

  async recordErpMilestone(id, input, opts) {
    const u = requireCap('erp.confirm');
    await writeGate();
    const db = load();
    const prior = idem<string>(db, opts.idempotencyKey);
    if (prior) return viewOf(db, findPkg(db, prior));
    const p = findPkg(db, id);
    checkVersion(p.version, opts);
    if (!HO_VISIBLE.includes(p.status)) throw rule('ERP milestones can be tracked once the package is with Head Office.');
    const idx = ERP_ORDER.indexOf(input.type);
    const m = p.erp.find((x) => x.type === input.type)!;
    const meta = erpMilestoneMeta[input.type];
    const fields: Record<string, string> = {};
    if (input.action === 'confirm') {
      if (m.status === 'confirmed') throw rule('This milestone is already confirmed. Reverse it first to change it.');
      // C-10 (confirmed): Plant Head approval before Voucher. Posting after voucher: prototype assumption (D-08).
      const prev = idx > 0 ? p.erp.find((x) => x.type === ERP_ORDER[idx - 1])! : null;
      if (prev && prev.status !== 'confirmed') throw rule(`Confirm “${erpMilestoneMeta[prev.type].short}” first.`);
      checkText(fields, 'dataManRef', input.dataManRef, meta.refLabel.toLowerCase(), input.type !== 'final_posting', 40);
      if (!input.verifiedInDataManByStaff) fields.verifiedInDataManByStaff = 'Confirm you checked this in DataMan.';
      if (input.erpOccurredAt && Date.parse(input.erpOccurredAt) > Date.now() + 5 * 60000) fields.erpOccurredAt = 'This time cannot be in the future.';
      if ((input.note ?? '').length > 500) fields.note = 'Note must be 500 characters or fewer.';
      fail(fields);
      Object.assign(m, {
        status: 'confirmed', dataManRef: input.dataManRef?.trim() || null, erpOccurredAt: input.erpOccurredAt || null,
        note: input.note?.trim() || null, confirmedBy: u.displayName, confirmedAt: nowIso(),
      });
      logPkg(p, u.displayName, `${meta.short} confirmed`, `${m.dataManRef ?? 'No reference'} — staff states it was checked in DataMan.${m.note ? ` ${m.note}` : ''}`, 'manual_staff_confirmation');
    } else {
      if (m.status !== 'confirmed') throw rule('Only a confirmed milestone can be reversed.');
      const next = p.erp.slice(idx + 1).find((x) => x.status === 'confirmed');
      if (next) throw rule(`Reverse “${erpMilestoneMeta[next.type].short}” first.`);
      checkReason(fields, 'note', input.note, 'reversing this milestone');
      fail(fields);
      const was = m.dataManRef;
      Object.assign(m, { status: 'pending', dataManRef: null, erpOccurredAt: null, note: null, confirmedBy: null, confirmedAt: null });
      logPkg(p, u.displayName, `${meta.short} reversed`, `Previously ${was ?? 'no reference'}. Reason: ${input.note!.trim()}`, 'manual_staff_confirmation');
    }
    db.idempotency[opts.idempotencyKey] = p.id;
    save(db);
    return viewOf(db, p);
  },

  async sendReminder(id, note, opts) {
    const u = requireCap('erp.confirm');
    await writeGate();
    const db = load();
    const prior = idem<string>(db, opts.idempotencyKey);
    if (prior) return viewOf(db, findPkg(db, prior));
    const p = findPkg(db, id);
    checkVersion(p.version, opts);
    if (p.erp[0]?.status === 'confirmed') throw rule('Plant Head approval is already confirmed for this package.');
    if (note.length > 300) fail({ note: 'Note must be 300 characters or fewer.' });
    p.reminders.push({ id: evId(), recipient: 'Plant Head', note: note.trim(), sentBy: u.displayName, sentAt: nowIso() });
    logPkg(p, u.displayName, 'Approval reminder logged', `In-app reminder only; no message was sent.${note.trim() ? ` Note: ${note.trim()}` : ''}`);
    db.idempotency[opts.idempotencyKey] = p.id;
    save(db);
    return viewOf(db, p);
  },

  /** Accounting workflow (upgrade 2026-11-03): HO → Accountant → Head Accountant → Bill Posted.
   * Same rules as the server: capability + stage checks, mandatory reasons, audit via history. */
  async accountingAction(id, action: AccountingAction, opts) {
    await writeGate();
    const db = load();
    const prior = idem<string>(db, opts.idempotencyKey);
    if (prior) return viewOf(db, findPkg(db, prior));
    const p = findPkg(db, id);
    checkVersion(p.version, opts);
    const isHead = can(currentUser(db), 'accounting.approve');
    const acc = p.accounting;
    const fields: Record<string, string> = {};
    switch (action.kind) {
      case 'start_accounting': {
        const u = requireCap('accounting.review', db);
        if (p.status !== 'verified') throw rule(ACCOUNTING_VISIBLE.slice(1).includes(p.status) ? 'Accounting has already started on this package.' : 'Only a Head-Office-verified package can move to Accounts.');
        p.status = 'with_accounting';
        p.accounting = { stage: 'with_accountant', accountingRef: null, accountantNote: null, headAccountantNote: null,
          startedBy: u.displayName, startedAt: nowIso(), submittedBy: null, submittedAt: null, approvedBy: null, approvedAt: null, postedBy: null, postedAt: null, corrections: [] };
        logPkg(p, u.displayName, 'Sent to Accounts', 'Documents verified by Head Office. Accounting review started.');
        break;
      }
      case 'submit_to_head_accountant': {
        const u = requireCap('accounting.review', db);
        if (p.status !== 'with_accounting') throw rule('Only a package with Accounts can be sent to the Head Accountant.');
        if (!action.confirmComplete) fields.confirmComplete = 'Confirm the accounting entries are complete.';
        if ((action.accountantNote ?? '').length > 1000) fields.accountantNote = 'Note must be 1000 characters or fewer.';
        fail(fields);
        p.status = 'with_head_accountant';
        acc!.stage = 'with_head_accountant';
        if (action.accountantNote?.trim()) acc!.accountantNote = action.accountantNote.trim();
        acc!.submittedBy = u.displayName;
        acc!.submittedAt = nowIso();
        logPkg(p, u.displayName, 'Sent to Head Accountant', action.accountantNote?.trim() ? `Accountant handed over. Note: ${action.accountantNote.trim()}` : 'Accountant confirmed the accounting entries are complete.');
        break;
      }
      case 'return_to_accountant': {
        const u = requireCap('accounting.approve', db);
        if (p.status !== 'with_head_accountant') throw rule('Only a package with the Head Accountant can be returned.');
        checkReason(fields, 'reason', action.reason, 'returning it');
        fail(fields);
        p.status = 'with_accounting';
        acc!.stage = 'with_accountant';
        logPkg(p, u.displayName, 'Returned to Accountant', action.reason.trim());
        break;
      }
      case 'approve_accounting': {
        const u = requireCap('accounting.approve', db);
        if (p.status !== 'with_head_accountant') throw rule('The Accountant must send the package to the Head Accountant first.');
        if ((action.headAccountantNote ?? '').length > 1000) fields.headAccountantNote = 'Note must be 1000 characters or fewer.';
        fail(fields);
        p.status = 'accounting_approved';
        acc!.stage = 'approved';
        if (action.headAccountantNote?.trim()) acc!.headAccountantNote = action.headAccountantNote.trim();
        acc!.approvedBy = u.displayName;
        acc!.approvedAt = nowIso();
        logPkg(p, u.displayName, 'Approved by Head Accountant', action.headAccountantNote?.trim() ? `Head Accountant approved. Note: ${action.headAccountantNote.trim()}` : 'Head Accountant approved the accounting.');
        break;
      }
      case 'post_bill': {
        const u = requireCap('accounting.post', db);
        if (p.status === 'bill_posted') throw rule('This bill is already posted. Posting it twice is not allowed.');
        if (p.status !== 'accounting_approved') throw rule('The Head Accountant must approve the package before the bill can be posted.');
        checkText(fields, 'billRef', action.billRef, 'bill reference', true, 40);
        if ((action.note ?? '').length > 500) fields.note = 'Note must be 500 characters or fewer.';
        fail(fields);
        p.status = 'bill_posted';
        acc!.stage = 'posted';
        acc!.accountingRef = action.billRef.trim();
        acc!.postedBy = u.displayName;
        acc!.postedAt = nowIso();
        logPkg(p, u.displayName, 'Bill posted', `Bill ${action.billRef.trim()} posted. Internal accounting status — DataMan milestones are confirmed separately.`);
        p.visitIds.forEach((vid) => logVisit(db, vid, { actor: u.displayName, action: `Bill ${action.billRef.trim()} posted (package ${p.packageRef}). Internal accounting status; not an ERP confirmation.`, source: 'app' }));
        break;
      }
      case 'correct_accounting': {
        const u = requireCap('accounting.review', db);
        if (!acc) throw rule('Start accounting on this package first.');
        if (p.status === 'bill_posted') throw rule('The bill is posted. No further accounting changes.');
        if (p.status !== 'with_accounting' && !isHead) throw rule('The package is with the Head Accountant. Only the Head Accountant can change it now.');
        if (action.field === 'headAccountantNote' && !isHead) throw rule('Only the Head Accountant can change the Head Accountant note.');
        checkReason(fields, 'reason', action.reason, 'this correction', 500);
        fail(fields);
        const current = action.field === 'accountingRef' ? acc.accountingRef : action.field === 'accountantNote' ? acc.accountantNote : acc.headAccountantNote;
        const next = action.value.trim();
        if (action.field === 'accountingRef') checkText(fields, 'value', next, 'accounting reference', true, 40);
        else if (next.length > 1000) fields.value = 'Value must be 1000 characters or fewer.';
        fail(fields);
        if (current === next) throw rule('The new value is the same as the current one. Nothing to correct.');
        if (action.field === 'accountingRef') acc.accountingRef = next;
        else if (action.field === 'accountantNote') acc.accountantNote = next;
        else acc.headAccountantNote = next;
        acc.corrections.push({ id: evId(), field: action.field, oldValue: current, newValue: next, reason: action.reason.trim(), correctedBy: u.displayName, correctedAt: nowIso() });
        logPkg(p, u.displayName, 'Accounting correction recorded',
          `${action.field === 'accountingRef' ? 'Accounting reference' : action.field === 'accountantNote' ? 'Accountant note' : 'Head Accountant note'}: ${current ? `“${current}”` : '—'} → “${next}”. Reason: ${action.reason.trim()}`);
        break;
      }
    }
    db.idempotency[opts.idempotencyKey] = p.id;
    save(db);
    return viewOf(db, p);
  },

  fileContentUrl(fileId) {
    return fileBlobs.get(fileId) ?? null;
  },
};

function queueItem(db: MockDb, v: ReceivingVisit): QcQueueItem {
  const insp = db.inspections.find((i) => i.visitId === v.id);
  const lastReturn = insp?.reviews.filter((r) => r.outcome === 'returned').at(-1);
  return { visit: v, latestRevision: insp?.revisions.at(-1)?.revision ?? null, lastReturnReason: v.qcStatus === 'returned' ? lastReturn?.reason ?? null : null };
}
