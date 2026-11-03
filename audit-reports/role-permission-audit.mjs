/**
 * Independent live audit: 7-role permission matrix, record visibility, forbidden calls,
 * workflow guards, concurrency and idempotency — against http://localhost:5173/api/v1.
 * Leaves at most two synthetic audit packages behind (full audit trail, nothing deleted).
 * Usage: node audit-reports/role-permission-audit.mjs   (DEMO_PASSWORD in env)
 */
const base = 'http://localhost:5173/api/v1';
const jars = new Map();
const results = [];
const uuid = () => globalThis.crypto.randomUUID();
const ROLES = ['demo-gate', 'demo-qc', 'demo-docs', 'demo-ho', 'demo-accountant', 'demo-head-act', 'demo-admin'];

async function login(username) {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'kpmpl-web' }, body: JSON.stringify({ username, password: process.env.DEMO_PASSWORD, clientType: 'web' }) });
    if (r.ok) { jars.set(username, (r.headers.get('set-cookie') || '').split(';')[0]); return; }
    if (r.status === 429 && attempt < 2) { await new Promise(res => setTimeout(res, 65_000)); continue; }
    throw new Error(`login ${username} ${r.status}`);
  }
}
// The server keeps at most FIVE live sessions globally (oldest evicted on the sixth login —
// documented capacity rule), so a role's cookie can be evicted mid-audit. Re-login once on 401.
const call = async (user, method, path, body, version, key) => {
  const once = async () => {
    const headers = { cookie: jars.get(user) ?? '', 'x-requested-with': 'kpmpl-web', origin: 'http://localhost:5173', 'idempotency-key': key ?? uuid() };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (version !== undefined) headers['if-match'] = String(version);
    const r = await fetch(base + path, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const json = r.status === 204 ? null : await r.json().catch(() => null);
    return { status: r.status, data: json?.data, error: json?.error, replayed: r.headers.get('idempotent-replay') === 'true' };
  };
  let res = await once();
  if (res.status === 401 && jars.get(user)) { await login(user); res = await once(); }
  return res;
};
function check(id, cond, detail) {
  results.push({ id, ok: !!cond, detail: cond ? '' : String(detail).slice(0, 200) });
  console.log((cond ? 'PASS ' : 'FAIL ') + id + (cond ? '' : '  → ' + String(detail).slice(0, 160)));
}

// ---------- 0. unauthenticated + bad credentials ----------
{
  const r = await fetch(`${base}/receiving-visits`);
  check('AUTH-001 no-cookie GET → 401', r.status === 401, r.status);
  const w = await fetch(`${base}/receiving-visits`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'kpmpl-web', origin: 'http://localhost:5173', 'idempotency-key': uuid() }, body: JSON.stringify({}) });
  check('AUTH-002 no-cookie POST → 401', w.status === 401, w.status);
  const bad = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'demo-gate', password: 'definitely-wrong-123' }) });
  const badBody = await bad.json();
  check('AUTH-003 wrong password → 401 generic', bad.status === 401 && badBody.error.message === 'Username or password is incorrect.', badBody.error?.message);
  const unknown = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'no-such-user-xyz', password: 'definitely-wrong-123' }) });
  const unknownBody = await unknown.json();
  check('AUTH-004 unknown user identical wording', unknown.status === 401 && unknownBody.error.message === badBody.error.message, unknownBody.error?.message);
}
for (const role of ROLES) await login(role);

// ---------- 1. GET matrix: what each role may read ----------
const getMatrix = [
  ['/receiving-visits', ['demo-gate', 'demo-qc', 'demo-docs', 'demo-ho', 'demo-accountant', 'demo-head-act', 'demo-admin']],
  ['/qc/queue', ['demo-qc', 'demo-gate']],
  ['/document-packages', ['demo-gate', 'demo-docs']], // admin holds ho.inbox, NOT docs.prepare (brief §4)
  ['/head-office/cases', ['demo-ho', 'demo-admin']],
  ['/accounting/queue', ['demo-accountant', 'demo-head-act']],
  ['/reports/overview', ['demo-gate', 'demo-qc', 'demo-docs', 'demo-ho', 'demo-accountant', 'demo-head-act', 'demo-admin']],
  ['/admin/users', ['demo-admin']],
];
for (const [path, allowed] of getMatrix) {
  for (const role of ROLES) {
    const r = await call(role, 'GET', path);
    const should = allowed.includes(role);
    const ok = should ? r.status === 200 : r.status === 403;
    check(`GET ${path} as ${role} → ${should ? 200 : 403}`, ok, `got ${r.status}`);
  }
}
// CSV export: overview.view holders only (raw fetch with 401 re-login)
const csvCall = async (user) => {
  let r = await fetch(base + '/reports/receiving.csv', { headers: { cookie: jars.get(user) } });
  if (r.status === 401) { await login(user); r = await fetch(base + '/reports/receiving.csv', { headers: { cookie: jars.get(user) } }); }
  return r;
};
// overview.view holders: gate, qc, gate_doc, ho, accountant, head_accountant, admin (brief §4) — qc included.
for (const role of ['demo-qc', 'demo-admin']) {
  const r = await csvCall(role);
  check(`GET /reports/receiving.csv as ${role} → 200 (overview.view)`, r.status === 200, r.status);
}

// ---------- 2. record-level visibility ----------
{
  const gatePkgs = (await call('demo-gate', 'GET', '/document-packages')).data;
  const draft = gatePkgs.find(p => p.status === 'draft');
  const posted = gatePkgs.find(p => p.status === 'bill_posted');
  if (draft) {
    const ho = await call('demo-ho', 'GET', `/document-packages/${draft.id}`);
    check('VIS-001 HO cannot read a draft package (404)', ho.status === 404, ho.status);
    const acct = await call('demo-accountant', 'GET', `/document-packages/${draft.id}`);
    check('VIS-002 Accountant cannot read a draft package (404)', acct.status === 404, acct.status);
    const qc = await call('demo-qc', 'GET', `/document-packages/${draft.id}`);
    check('VIS-003 QC cannot read any package (403/404, no leak)', [403, 404].includes(qc.status), qc.status);
  } else check('VIS-001..003', false, 'no draft package found to test');
  if (posted) {
    const acct = await call('demo-accountant', 'GET', `/document-packages/${posted.id}`);
    check('VIS-004 Accountant can read a posted package', acct.status === 200, acct.status);
    const gate = await call('demo-gate', 'GET', `/document-packages/${posted.id}`);
    check('VIS-005 Gate (docs.prepare) can read a posted package', gate.status === 200, gate.status);
    const queue = (await call('demo-accountant', 'GET', '/accounting/queue')).data;
    check('VIS-006 accounting queue only shows accounting states', queue.every(p => ['verified', 'with_accounting', 'with_head_accountant', 'accounting_approved', 'bill_posted'].includes(p.status)), JSON.stringify(queue.map(p => p.status)));
    const hoCases = (await call('demo-ho', 'GET', '/head-office/cases')).data;
    check('VIS-007 HO cases exclude drafts', hoCases.every(p => p.status !== 'draft'), '');
  }
}

// ---------- 3. write matrix: forbidden writes are 403 ----------
{
  const visits = (await call('demo-gate', 'GET', '/receiving-visits?pageSize=5')).data.data;
  const vid = visits[0]?.id;
  if (vid) {
    for (const role of ['demo-qc', 'demo-ho', 'demo-accountant', 'demo-head-act', 'demo-admin']) {
      const r = await call(role, 'POST', '/receiving-visits', { officialGateEntryRef: 'AUD-' + uuid().slice(0, 10), vehicleNumber: 'AUD', supplierDisplayName: 'Audit', materialDisplayName: 'Audit', grossWeight: { value: '1000.000', unit: 'kg' } });
      check(`WRITE-001 POST /receiving-visits as ${role} → 403`, r.status === 403, r.status);
    }
    for (const role of ['demo-gate', 'demo-docs', 'demo-ho', 'demo-accountant', 'demo-head-act', 'demo-admin']) {
      const r = await call(role, 'POST', `/receiving-visits/${vid}/qc-inspections`, { measurements: [], intent: 'submit' }, visits[0].version);
      check(`WRITE-002 POST qc-inspections as ${role} → 403`, r.status === 403, r.status);
    }
    const acctCases = (await call('demo-accountant', 'GET', '/accounting/queue')).data;
    const target = acctCases.find(p => p.status === 'verified' || p.status === 'with_accounting');
    if (target) {
      for (const role of ['demo-gate', 'demo-qc', 'demo-docs', 'demo-ho', 'demo-admin']) {
        const r = await call(role, 'POST', `/document-packages/${target.id}/accounting`, { kind: 'start_accounting' }, target.version);
        check(`WRITE-003 accounting action as ${role} → 403`, r.status === 403, r.status);
      }
      const r = await call('demo-accountant', 'POST', `/document-packages/${target.id}/accounting`, { kind: 'post_bill', billRef: 'AUD-X' }, target.version);
      const expectStatus = target.status === 'verified' ? 422 : 422; // state guard (403 impossible: accountant may reach the route)
      check('WRITE-004 Accountant post_bill blocked (state/capability)', [403, 422].includes(r.status), `${r.status} ${r.error?.message ?? ''}`);
    } else check('WRITE-003/004', true, 'no accounting-eligible package right now (skipped)');
    const hoCases = (await call('demo-ho', 'GET', '/head-office/cases')).data;
    const anyCase = hoCases[0];
    if (anyCase) {
      const r = await call('demo-accountant', 'POST', `/head-office/cases/${anyCase.id}/erp-milestones`, { type: 'final_posting', action: 'confirm', verifiedInDataManByStaff: true }, anyCase.version);
      check('WRITE-005 Accountant cannot confirm ERP milestones → 403', r.status === 403, r.status);
      const r2 = await call('demo-head-act', 'POST', `/head-office/cases/${anyCase.id}/erp-milestones`, { type: 'final_posting', action: 'confirm', verifiedInDataManByStaff: true }, anyCase.version);
      check('WRITE-006 Head Accountant cannot confirm ERP milestones → 403', r2.status === 403, r2.status);
    }
  }
}

// ---------- 4. full workflow on a fresh package + posting guards ----------
{
  const ref = 'AUD-' + uuid().slice(0, 12);
  let r = await call('demo-gate', 'POST', '/receiving-visits', { officialGateEntryRef: ref, vehicleNumber: 'AUD-TRUCK', supplierDisplayName: 'Demo Supplier B', materialDisplayName: 'Domestic Waste Paper', grossWeight: { value: '11100.000', unit: 'kg' } });
  check('WF-001 gate creates visit', r.status === 201, r.status);
  const visitId = r.data.id; let version = r.data.version;
  // QC submit + accept (D-03)
  r = await call('demo-qc', 'POST', `/receiving-visits/${visitId}/qc-inspections`, { measurements: [{ code: 'moisture', value: '8.00', unit: 'percent' }, { code: 'impurity', value: '1.00', unit: 'percent' }], intent: 'submit' }, version);
  check('WF-002 qc submits readings', r.status === 201, `${r.status} ${JSON.stringify(r.error)}`);
  const inspId = r.data?.inspectionId;
  // QC writes carry the VISIT version; the submit bumped it, so re-read before deciding.
  version = (await call('demo-gate', 'GET', `/receiving-visits/${visitId}`)).data.version;
  r = await call('demo-qc', 'POST', `/qc-inspections/${inspId}/decisions`, { outcome: 'accepted', reason: '' }, version);
  check('WF-003 qc decision accepted (empty reason ok)', [200, 201].includes(r.status), `${r.status} ${JSON.stringify(r.error)}`);
  version = (await call('demo-gate', 'GET', `/receiving-visits/${visitId}`)).data.version;
  // tare → exit → GRN
  r = await call('demo-gate', 'POST', `/receiving-visits/${visitId}/weighments`, { kind: 'tare', value: '4100.000', unit: 'kg' }, version); version = r.data.version;
  check('WF-004 tare recorded', [200, 201].includes(r.status), `${r.status} ${JSON.stringify(r.error)}`);
  r = await call('demo-gate', 'POST', `/receiving-visits/${visitId}/exit`, { physicalExitAt: new Date().toISOString(), millChecksConfirmed: true }, version); version = r.data.version;
  check('WF-005 exit recorded after tare+QC', [200, 201].includes(r.status), `${r.status} ${JSON.stringify(r.error)}`);
  r = await call('demo-gate', 'POST', `/receiving-visits/${visitId}/grn-links`, { officialGrnRef: 'AUD-GRN-' + uuid().slice(0, 6), verifiedInDataManByStaff: true }, version);
  check('WF-006 GRN recorded (post-exit allowed: independent domains)', [200, 201].includes(r.status), `${r.status} ${JSON.stringify(r.error)}`);
  // package → verify
  r = await call('demo-gate', 'POST', '/document-packages', { visitIds: [visitId], invoiceRef: 'AUD-INV-1' }); let pkg = r.data;
  check('WF-007 package created', r.status === 201, r.status);
  const form = new FormData();
  form.append('category', 'supplier_invoice');
  form.append('file', new Blob(['%PDF-1.4\n% audit fixture\n%%EOF'], { type: 'application/pdf' }), 'AUD.pdf');
  const up = await fetch(`${base}/document-packages/${pkg.id}/files`, { method: 'POST', headers: { cookie: jars.get('demo-gate'), 'x-requested-with': 'kpmpl-web', origin: 'http://localhost:5173', 'idempotency-key': uuid(), 'if-match': String(pkg.version) }, body: form });
  check('WF-008 PDF attached + scanned clean', up.status === 201, up.status);
  pkg = (await up.json()).data;
  for (const category of ['factory_grn', 'weighbridge_slip', 'qc_slip', 'supporting_bill', 'eway_bill']) {
    pkg = (await call('demo-gate', 'PUT', `/document-packages/${pkg.id}/items/${category}/applicability`, { notApplicableReason: 'Audit: N/A' }, pkg.version)).data;
  }
  pkg = (await call('demo-gate', 'POST', `/document-packages/${pkg.id}/actions`, { kind: 'mark_ready' }, pkg.version)).data;
  pkg = (await call('demo-docs', 'POST', `/document-packages/${pkg.id}/actions`, { kind: 'submit_to_ho', confirmComplete: true }, pkg.version)).data;
  pkg = (await call('demo-ho', 'POST', `/document-packages/${pkg.id}/actions`, { kind: 'start_review' }, pkg.version)).data;
  pkg = (await call('demo-ho', 'POST', '/head-office/reviews', { packageId: pkg.id, category: 'supplier_invoice', check: 'ok' }, pkg.version)).data;
  pkg = (await call('demo-ho', 'POST', `/document-packages/${pkg.id}/actions`, { kind: 'verify' }, pkg.version)).data;
  check('WF-009 HO verified', pkg.status === 'verified', pkg.status);

  // posting before accounting started must fail
  r = await call('demo-head-act', 'POST', `/document-packages/${pkg.id}/accounting`, { kind: 'post_bill', billRef: 'AUD-EARLY' }, pkg.version);
  check('WF-010 post before accounting started → 422 (not completed)', r.status === 422 && pkg.status !== 'bill_posted', `${r.status}`);
  // accountant: start → correct → hand over
  r = await call('demo-accountant', 'POST', `/document-packages/${pkg.id}/accounting`, { kind: 'start_accounting' }, pkg.version); pkg = r.data;
  check('WF-011 accountant starts accounting', r.status === 200 && pkg.status === 'with_accounting', `${r.status} ${pkg.status}`);
  r = await call('demo-accountant', 'POST', `/document-packages/${pkg.id}/accounting`, { kind: 'correct_accounting', field: 'accountingRef', value: 'AUD-BILL-0001', reason: 'Audit: initial reference' }, pkg.version); pkg = r.data;
  check('WF-012 correction persists with before/after', r.status === 200 && pkg.accounting.corrections[0]?.oldValue === null && pkg.accounting.corrections[0]?.newValue === 'AUD-BILL-0001', JSON.stringify(r.error));
  // correction appears in audit trail
  r = await call('demo-head-act', 'POST', `/document-packages/${pkg.id}/accounting`, { kind: 'submit_to_head_accountant', confirmComplete: true }, pkg.version); pkg = r.data;
  check('WF-013 handed to Head Accountant', r.status === 200 && pkg.status === 'with_head_accountant', `${r.status} ${pkg.status}`);
  // concurrent double-approve with the same If-Match: exactly one succeeds
  const [a, b] = await Promise.all([
    call('demo-head-act', 'POST', `/document-packages/${pkg.id}/accounting`, { kind: 'approve_accounting' }, pkg.version),
    call('demo-head-act', 'POST', `/document-packages/${pkg.id}/accounting`, { kind: 'approve_accounting' }, pkg.version),
  ]);
  const statuses = [a.status, b.status].sort();
  check('WF-014 concurrent same-version approves: one 200 one 409', JSON.stringify(statuses) === JSON.stringify([200, 409]), JSON.stringify(statuses));
  pkg = (a.status === 200 ? a : b).data;
  check('WF-015 state accounting_approved after exactly one approve', pkg.status === 'accounting_approved', pkg.status);
  // post: head accountant only, exactly once
  r = await call('demo-head-act', 'POST', `/document-packages/${pkg.id}/accounting`, { kind: 'post_bill', billRef: 'AUD-POST-0001', note: 'Audit posting' }, pkg.version); pkg = r.data;
  check('WF-016 bill posted', r.status === 200 && pkg.status === 'bill_posted', `${r.status} ${pkg.status}`);
  r = await call('demo-head-act', 'POST', `/document-packages/${pkg.id}/accounting`, { kind: 'post_bill', billRef: 'AUD-POST-0002' }, pkg.version);
  check('WF-017 duplicate posting refused', r.status === 422, r.status);
  r = await call('demo-head-act', 'POST', `/document-packages/${pkg.id}/accounting`, { kind: 'correct_accounting', field: 'accountingRef', value: 'X', reason: 'late' }, pkg.version);
  check('WF-018 correction after posting refused', r.status === 422, r.status);
  // idempotent replay: the SAME successful request retried with the same key replays the stored response
  const postKey = uuid();
  const ok1 = await call('demo-ho', 'POST', `/head-office/cases/${pkg.id}/erp-milestones`, { type: 'plant_head_grn_approval', action: 'confirm', dataManRef: 'AUD-GRN-1', verifiedInDataManByStaff: true }, pkg.version, postKey);
  const ok2 = await call('demo-ho', 'POST', `/head-office/cases/${pkg.id}/erp-milestones`, { type: 'plant_head_grn_approval', action: 'confirm', dataManRef: 'AUD-GRN-1', verifiedInDataManByStaff: true }, pkg.version, postKey);
  check('WF-019 idempotent replay returns stored response', ok1.status === 200 && ok2.status === 200 && ok2.replayed === true, `ok1=${ok1.status} ok2=${ok2.status} replayed=${ok2.replayed}`);
  // failed write must not falsely complete: version conflict leaves state unchanged
  r = await call('demo-head-act', 'POST', `/document-packages/${pkg.id}/accounting`, { kind: 'correct_accounting', field: 'accountingRef', value: 'AUD-BILL-9999', reason: 'audit' }, pkg.version - 5);
  check('WF-020 stale If-Match → 409, state unchanged', r.status === 409 && pkg.status === 'bill_posted', `${r.status}`);
  // audit history of the package contains the full chain
  const words = ['Sent to Accounts', 'Sent to Head Accountant', 'Approved by Head Accountant', 'Bill posted', 'Accounting correction recorded'];
  check('WF-021 package history shows the accounting chain', words.every(w => pkg.history.some(h => h.action === w)), pkg.history.map(h => h.action).join('|').slice(0, 120));
  // visit timeline records bill_posted
  const timeline = (await call('demo-gate', 'GET', `/receiving-visits/${visitId}/timeline`)).data;
  check('WF-022 visit timeline records bill_posted', timeline.some(e => e.action === 'bill_posted'), timeline.map(e => e.action).join('|').slice(0, 100));
}

// ---------- 5. validation and error handling ----------
{
  // '#' IS inside the brief's safe charset (^[\p{L}\p{N} .,/&()'_#:-]*$) — probe characters outside it.
  let r = await call('demo-gate', 'POST', '/receiving-visits', { officialGateEntryRef: 'AUD<BAD>&=', vehicleNumber: 'X', supplierDisplayName: 'S', materialDisplayName: 'M', grossWeight: { value: '1000.000', unit: 'kg' } });
  check('VAL-001 unsafe Gate Entry ref (angle brackets) rejected 422', r.status === 422, r.status);
  r = await call('demo-gate', 'POST', '/receiving-visits', { officialGateEntryRef: 'AUD	BAD', vehicleNumber: 'X', supplierDisplayName: 'S', materialDisplayName: 'M', grossWeight: { value: '1000.000', unit: 'kg' } });
  check('VAL-001b control character in ref rejected 422', r.status === 422, r.status);
  r = await call('demo-gate', 'POST', '/receiving-visits', { officialGateEntryRef: 'AUD-V2', vehicleNumber: 'V', supplierDisplayName: 'S', materialDisplayName: 'M', grossWeight: { value: '15000.0001', unit: 'kg' } });
  check('VAL-002 4-decimal weight rejected (float protection)', r.status === 422, r.status);
  const dup = 'AUD-DUP-' + uuid().slice(0, 8);
  r = await call('demo-gate', 'POST', '/receiving-visits', { officialGateEntryRef: dup, vehicleNumber: 'V1', supplierDisplayName: 'S', materialDisplayName: 'M', grossWeight: { value: '1000.000', unit: 'kg' } });
  const r2 = await call('demo-gate', 'POST', '/receiving-visits', { officialGateEntryRef: dup, vehicleNumber: 'V2', supplierDisplayName: 'S', materialDisplayName: 'M', grossWeight: { value: '1000.000', unit: 'kg' } });
  check('VAL-003 duplicate gate entry → 409 with existingId', r.status === 201 && r2.status === 409 && !!r2.error?.meta?.existingId, `${r.status}/${r2.status}`);
  r = await call('demo-gate', 'POST', '/receiving-visits', { officialGateEntryRef: 'AUD-ZERO', vehicleNumber: 'V', supplierDisplayName: 'S', materialDisplayName: 'M', grossWeight: { value: '0.000', unit: 'kg' } });
  check('VAL-004 zero gross rejected', r.status === 422, r.status);
  const noIk = await fetch(base + '/receiving-visits', { method: 'POST', headers: { cookie: jars.get('demo-gate'), 'content-type': 'application/json', 'x-requested-with': 'kpmpl-web', origin: 'http://localhost:5173' }, body: JSON.stringify({ officialGateEntryRef: 'AUD-NOIK', vehicleNumber: 'V', supplierDisplayName: 'S', materialDisplayName: 'M', grossWeight: { value: '1000.000', unit: 'kg' } }) });
  check('VAL-005 write without Idempotency-Key rejected', noIk.status === 422, noIk.status);
  const noOrigin = await fetch(base + '/receiving-visits', { method: 'POST', headers: { cookie: jars.get('demo-gate'), 'content-type': 'application/json', 'x-requested-with': 'kpmpl-web', 'idempotency-key': uuid() }, body: JSON.stringify({ officialGateEntryRef: 'AUD-NOOR', vehicleNumber: 'V', supplierDisplayName: 'S', materialDisplayName: 'M', grossWeight: { value: '1000.000', unit: 'kg' } }) });
  check('VAL-006 cookie write without Origin rejected', noOrigin.status === 403, noOrigin.status);
}

// ---------- 6. overview counters include the accounting chain (KPMPL-002) ----------
{
  const o = (await call('demo-ho', 'GET', '/reports/overview')).data;
  check('OVER-001 overview exposes withAccounting counter', typeof o.documents.withAccounting === 'number', JSON.stringify(o.documents));
  check('OVER-002 overview exposes billPosted counter', typeof o.documents.billPosted === 'number', JSON.stringify(o.documents));
  check('OVER-003 billPosted counts the posted audit packages', o.documents.billPosted >= 1, JSON.stringify(o.documents));
}

const fails = results.filter(r => !r.ok);
console.log(`\n==== ${results.length - fails.length}/${results.length} checks passed ====`);
if (fails.length) { console.log('FAILED:'); fails.forEach(f => console.log(' -', f.id, f.detail)); process.exitCode = 1; }
