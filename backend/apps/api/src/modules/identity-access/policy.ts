// Brief §4: these 5 role codes and 14 capability strings are the whole API surface.
// Client decision 2026-11-03 (D-03): the QC operator (`qc`) records the readings and
// makes the final QC decision (`qc.decide`); no other role decides QC outcomes.
export const briefRoleCodes = ['gate', 'gate_doc', 'qc', 'ho', 'admin'] as const;
export type RoleCode = typeof briefRoleCodes[number];
// Historical rows (qc_operator, qc_manager, …) may still exist in the database; the API
// no longer accepts or assigns them (CONTRACT_DIFF #65, decision A).

export const briefCapabilities = [
  'receiving.view', 'receiving.create', 'receiving.edit', 'gate.followup',
  'qc.queue.view', 'qc.measure', 'qc.decide', 'overview.view',
  'docs.prepare', 'docs.submit', 'ho.inbox', 'ho.review', 'erp.confirm', 'admin.users',
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

// Brief §4 matrix, exactly.
const gate = ['receiving.view', 'receiving.create', 'receiving.edit', 'gate.followup', 'qc.queue.view', 'overview.view', 'docs.prepare'] as const;
const qcOperator = ['receiving.view', 'qc.queue.view', 'qc.measure', 'qc.decide', 'overview.view'] as const;
const docs = ['receiving.view', 'overview.view', 'docs.prepare', 'docs.submit'] as const;
const headOffice = ['receiving.view', 'overview.view', 'ho.inbox', 'ho.review', 'erp.confirm'] as const;
const administrator = ['receiving.view', 'overview.view', 'ho.inbox', 'admin.users'] as const;

export const roleCapabilities: Record<RoleCode, readonly Capability[]> = {
  gate: [...gate, 'receiving.read', 'weighment.record', 'movement.exit', 'grn.record'],
  gate_doc: docs,
  qc: [...qcOperator, 'receiving.read', 'qc.queue', 'qc.submit'],
  ho: headOffice,
  admin: [...administrator, 'identity.manage', 'audit.verify'],
};

export function permits(capabilities: readonly string[], capability: Capability): boolean {
  return capability === 'auth.self' || capability === 'platform.read' || capabilities.includes(capability);
}
