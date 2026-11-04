// Brief §4: these role codes and capability strings are the whole API surface.
// Client decision 2026-11-03 (D-03): the QC operator (`qc`) records the readings and
// makes the final QC decision (`qc.decide`); no other role decides QC outcomes.
// Upgrade 2026-11-03 (user direction): `accountant` and `head_accountant` join the
// matrix and carry the HO → Accountant → Head Accountant → Bill Posted workflow
// (capabilities `accounting.*`). The matrix stays data-driven (D-07): roles and
export const briefRoleCodes = ['gate', 'gate_doc', 'gate_doc_authority', 'qc', 'ho', 'accountant', 'head_accountant', 'admin'] as const;
export type RoleCode = typeof briefRoleCodes[number];
// Historical rows (qc_operator, qc_manager, …) may still exist in the database; the API
// no longer accepts or assigns them (CONTRACT_DIFF #65, decision A).
export const briefCapabilities = [
  'receiving.view', 'receiving.create', 'receiving.edit', 'gate.followup',
  'qc.queue.view', 'qc.measure', 'qc.decide', 'overview.view',
  'docs.prepare', 'docs.submit', 'ho.inbox', 'ho.review', 'erp.confirm', 'erp.plant_head_approval', 'erp.purchase_voucher', 'erp.final_posting', 'admin.users',
  'accounting.inbox', 'accounting.review', 'accounting.approve', 'accounting.post',
] as const;
// Internal markers + transitional rows kept in the DB from earlier builds. `auth.self`
// and `platform.read` mean "any authenticated user" and are granted implicitly. The rows
// stay in the type so the guards can name them while the API surface moves to the brief set.
/* eslint-disable-next-line @typescript-eslint/no-unused-vars -- type-only value, kept next to the union it feeds */
const retainedCapabilityRows = [
  'auth.self', 'platform.read', 'identity.manage', 'audit.verify', 'receiving.read',
  'weighment.record', 'qc.queue', 'qc.submit', 'movement.exit', 'grn.record',
] as const;
export type Capability = typeof briefCapabilities[number] | typeof retainedCapabilityRows[number];

// Brief §4 matrix, exactly, extended with the two accounting roles (upgrade 2026-11-03).
const gate = ['receiving.view', 'receiving.create', 'receiving.edit', 'gate.followup', 'qc.queue.view'] as const;
const qcOperator = ['receiving.view', 'qc.queue.view', 'qc.measure', 'qc.decide', 'overview.view'] as const;
const docs = ['receiving.view', 'overview.view', 'docs.prepare', 'docs.submit'] as const;
const headOffice = ['receiving.view', 'overview.view', 'ho.inbox', 'ho.review', 'erp.confirm', 'erp.purchase_voucher', 'erp.plant_head_approval'] as const;
// Accountant: sees the accounting queue, works verified packages, hands over to the
// Head Accountant. Head Accountant: approves, posts the bill. Least privilege: neither
// holds ho.review or erp.confirm (HO keeps those), and corrections need a reason.
const accountant = ['receiving.view', 'overview.view', 'accounting.inbox', 'accounting.review'] as const;
const headAccountant = [...accountant, 'accounting.approve', 'accounting.post', 'erp.final_posting'] as const;
const administrator = ['receiving.view', 'overview.view', 'ho.inbox', 'admin.users'] as const;

// briefRoleCodes defined in line 7 as const string array
// RoleCode type derived from it on line 8

export const roleCapabilities: Record<RoleCode, readonly Capability[]> = {
  gate: [...gate, 'receiving.read', 'weighment.record', 'movement.exit', 'grn.record'],
  // Document Authority (Gate + Document prep + submit). Kept separate from the plain Gate
  // Operator so a Gate operator can never prepare or send a document package.
  gate_doc_authority: [...gate, 'docs.prepare', 'docs.submit', 'receiving.read', 'weighment.record', 'movement.exit', 'grn.record', 'erp.plant_head_approval'],
  gate_doc: [...docs, 'erp.plant_head_approval'],
  qc: [...qcOperator, 'receiving.read', 'qc.queue', 'qc.submit'],
  ho: headOffice,
  accountant,
  head_accountant: headAccountant,
  admin: [...administrator, 'identity.manage', 'audit.verify'],
};

export function permits(capabilities: readonly string[], capability: Capability): boolean {
  return capability === 'auth.self' || capability === 'platform.read' || capabilities.includes(capability);
}

