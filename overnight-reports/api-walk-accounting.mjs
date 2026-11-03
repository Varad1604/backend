/**
 * Live-deployment API walk: HO → Accountant → Head Accountant → Bill Posted through the
 * nginx proxy on :5173 (the same path the browser uses). Creates its own fresh package so
 * the seeded demo fixture stays untouched. No credentials are printed.
 * Usage: node overnight-reports/api-walk-accounting.mjs   (DEMO_PASSWORD must be in env)
 */
const base = 'http://localhost:5173/api/v1';
const jars = new Map();
const uuid = () => globalThis.crypto.randomUUID();

async function login(username) {
  const r = await fetch(`${base}/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'kpmpl-web' },
    body: JSON.stringify({ username, password: process.env.DEMO_PASSWORD, clientType: 'web' }),
  });
  if (!r.ok) throw new Error(`login ${username} → ${r.status}`);
  jars.set(username, (r.headers.get('set-cookie') || '').split(';')[0]);
}
const call = async (user, method, path, body, version) => {
  const headers = { cookie: jars.get(user), 'x-requested-with': 'kpmpl-web', origin: 'http://localhost:5173', 'idempotency-key': uuid() };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (version !== undefined) headers['if-match'] = String(version);
  const r = await fetch(base + path, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const json = r.status === 204 ? null : await r.json().catch(() => null);
  return { status: r.status, data: json?.data, error: json?.error };
};
const expect = (cond, label, detail) => { if (!cond) throw new Error('FAILED: ' + label + (detail ? ' — ' + JSON.stringify(detail).slice(0, 300) : '')); console.log('ok  -', label); };

await login('demo-gate'); await login('demo-docs'); await login('demo-ho'); await login('demo-accountant'); await login('demo-head-act');

// Gate + HO bring a fresh package to verified.
const ref = 'WALK-' + uuid().slice(0, 12);
let r = await call('demo-gate', 'POST', '/receiving-visits', { officialGateEntryRef: ref, vehicleNumber: 'WALK-TRUCK-1', supplierDisplayName: 'Demo Supplier A', materialDisplayName: 'Domestic Waste Paper', grossWeight: { value: '12000.000', unit: 'kg' } });
expect(r.status === 201, `visit created (${ref})`, r.error ?? r.status);
const visitId = r.data.id;
r = await call('demo-gate', 'POST', '/document-packages', { visitIds: [visitId], invoiceRef: 'WALK-INV-1' });
expect(r.status === 201, 'package created');
let pkg = r.data;
const pdf = new Blob(['%PDF-1.4\n% walk fixture\n%%EOF'], { type: 'application/pdf' });
{
  const form = new FormData();
  form.append('category', 'supplier_invoice');
  form.append('file', pdf, 'WALK-INV.pdf');
  const up = await fetch(`${base}/document-packages/${pkg.id}/files`, { method: 'POST', headers: { cookie: jars.get('demo-gate'), 'x-requested-with': 'kpmpl-web', origin: 'http://localhost:5173', 'idempotency-key': uuid(), 'if-match': String(pkg.version) }, body: form });
  expect(up.status === 201, 'PDF attached and scanned clean', up.status === 201 ? null : await up.json().catch(() => up.status));
  pkg = (await up.json()).data;
}
for (const category of ['factory_grn', 'weighbridge_slip', 'qc_slip', 'supporting_bill', 'eway_bill']) {
  r = await call('demo-gate', 'PUT', `/document-packages/${pkg.id}/items/${category}/applicability`, { notApplicableReason: 'Walk: not applicable.' }, pkg.version);
  expect(r.status === 200, `row marked N/A: ${category}`);
  pkg = r.data;
}
r = await call('demo-gate', 'POST', `/document-packages/${pkg.id}/actions`, { kind: 'mark_ready' }, pkg.version); pkg = r.data;
expect(r.status === 200, 'marked ready');
r = await call('demo-docs', 'POST', `/document-packages/${pkg.id}/actions`, { kind: 'submit_to_ho', confirmComplete: true }, pkg.version); pkg = r.data;
expect(r.status === 200, 'sent to HO');
r = await call('demo-ho', 'POST', `/document-packages/${pkg.id}/actions`, { kind: 'start_review' }, pkg.version); pkg = r.data;
r = await call('demo-ho', 'POST', '/head-office/reviews', { packageId: pkg.id, category: 'supplier_invoice', check: 'ok' }, pkg.version); pkg = r.data;
r = await call('demo-ho', 'POST', `/document-packages/${pkg.id}/actions`, { kind: 'verify' }, pkg.version); pkg = r.data;
expect(r.status === 200 && pkg.status === 'verified', 'HO verified the documents');

// RBAC: gate/docs cannot touch accounting; accountant cannot post.
r = await call('demo-gate', 'POST', `/document-packages/${pkg.id}/accounting`, { kind: 'start_accounting' }, pkg.version);
expect(r.status === 403, 'gate denied on accounting endpoint (403)');
r = await call('demo-accountant', 'POST', `/document-packages/${pkg.id}/accounting`, { kind: 'post_bill', billRef: 'EARLY' }, pkg.version);
expect(r.status === 403, 'accountant denied on post_bill (403)');

// Accountant: start → correct → hand over.
r = await call('demo-accountant', 'POST', `/document-packages/${pkg.id}/accounting`, { kind: 'start_accounting' }, pkg.version); pkg = r.data;
expect(r.status === 200 && pkg.status === 'with_accounting', 'accounting started (with_accounting)');
r = await call('demo-accountant', 'POST', `/document-packages/${pkg.id}/accounting`, { kind: 'correct_accounting', field: 'accountingRef', value: 'WALK-BILL-0001', reason: 'Walk: initial reference as typed' }, pkg.version); pkg = r.data;
expect(r.status === 200 && pkg.accounting.accountingRef === 'WALK-BILL-0001', 'accountingRef corrected with reason');
expect(pkg.accounting.corrections.length === 1 && pkg.accounting.corrections[0].oldValue === null, 'correction keeps before/after');
r = await call('demo-accountant', 'POST', `/document-packages/${pkg.id}/accounting`, { kind: 'submit_to_head_accountant', confirmComplete: true }, pkg.version); pkg = r.data;
expect(r.status === 200 && pkg.status === 'with_head_accountant', 'handed to Head Accountant');
r = await call('demo-accountant', 'POST', `/document-packages/${pkg.id}/accounting`, { kind: 'approve_accounting' }, pkg.version);
expect(r.status === 403, 'accountant cannot approve (403)');

// Head Accountant: return → resubmit → approve → post → duplicate refused.
r = await call('demo-head-act', 'POST', `/document-packages/${pkg.id}/accounting`, { kind: 'return_to_accountant', reason: 'Walk: recheck freight line' }, pkg.version); pkg = r.data;
expect(r.status === 200 && pkg.status === 'with_accounting', 'returned to Accountant with reason');
r = await call('demo-accountant', 'POST', `/document-packages/${pkg.id}/accounting`, { kind: 'submit_to_head_accountant', confirmComplete: true }, pkg.version); pkg = r.data;
r = await call('demo-head-act', 'POST', `/document-packages/${pkg.id}/accounting`, { kind: 'approve_accounting' }, pkg.version); pkg = r.data;
expect(r.status === 200 && pkg.status === 'accounting_approved', 'approved (accounting_approved)');
r = await call('demo-head-act', 'POST', `/document-packages/${pkg.id}/accounting`, { kind: 'post_bill', billRef: 'WALK-POST-0001', note: 'Walk posting' }, pkg.version); pkg = r.data;
expect(r.status === 200 && pkg.status === 'bill_posted', 'bill posted (bill_posted)');
r = await call('demo-head-act', 'POST', `/document-packages/${pkg.id}/accounting`, { kind: 'post_bill', billRef: 'WALK-POST-0002' }, pkg.version);
expect(r.status === 422 && r.error.code === 'DOMAIN_RULE', 'duplicate posting refused (422 DOMAIN_RULE)');
r = await call('demo-head-act', 'POST', `/document-packages/${pkg.id}/accounting`, { kind: 'correct_accounting', field: 'accountingRef', value: 'X', reason: 'late' }, pkg.version);
expect(r.status === 422, 'no corrections after posting (422)');

// Audit trail wording, HO retention, PDF access, visit timeline.
const words = ['Sent to Accounts', 'Sent to Head Accountant', 'Returned to Accountant', 'Approved by Head Accountant', 'Bill posted', 'Accounting correction recorded'];
expect(words.every((w) => pkg.history.some((h) => h.action === w)), 'history shows every accounting step');
r = await call('demo-ho', 'GET', '/head-office/cases');
expect(r.data.some((x) => x.id === pkg.id), 'HO still sees the posted package');
r = await call('demo-ho', 'POST', `/head-office/cases/${pkg.id}/erp-milestones`, { type: 'plant_head_grn_approval', action: 'confirm', dataManRef: 'WALK-GRN-1', verifiedInDataManByStaff: true }, pkg.version);
expect(r.status === 200 && r.data.erp[0].status === 'confirmed', 'HO confirms DataMan milestones after posting (internal ≠ external)');
const fileId = pkg.items.flatMap((i) => i.files)[0].id;
const pdfRes = await fetch(`${base}/document-files/${fileId}/content`, { headers: { cookie: jars.get('demo-accountant') } });
expect(pdfRes.status === 200 && (pdfRes.headers.get('content-type') || '').includes('application/pdf'), 'accountant can download the PDF');
r = await call('demo-accountant', 'GET', `/receiving-visits/${visitId}/timeline`);
expect(r.data.some((e) => e.action === 'bill_posted'), 'visit timeline records bill_posted');

console.log('\nALL WALK CHECKS PASSED');
