/**
 * UI visibility only. The BACKEND is authoritative (03 §1, KPM-NFR-003); the mock adapter
 * enforces the same table so permission-denied paths can be demonstrated.
 * Grants follow the candidate matrix in 03 §2 ("Y" rows, plus a few "R" view rows).
 * D-03 (decided 2026-11-03): the QC Operator records the readings and makes the final QC decision.
 */
import type { RoleCode, User } from '../domain/types';

export type Capability =
  | 'receiving.view'
  | 'receiving.create'
  | 'receiving.edit'
  | 'gate.followup'      // tare, physical exit, GRN reference
  | 'qc.queue.view'
  | 'qc.measure'
  | 'qc.decide'         // final QC decision (accept / accept with deduction / return / reject)
  | 'overview.view'
  | 'docs.prepare'       // build checklist, attach PDFs
  | 'docs.submit'        // authorise and send package to HO (Pathak/Kishore role)
  | 'ho.inbox'           // view HO inbox and PDFs
  | 'ho.review'          // verify documents / request corrections
  | 'erp.confirm'        // record staff-confirmed DataMan milestones and reminders
  | 'admin.users';

const grants: Record<RoleCode, Capability[]> = {
  gate: ['receiving.view', 'receiving.create', 'receiving.edit', 'gate.followup', 'qc.queue.view', 'overview.view', 'docs.prepare'],
  gate_doc: ['receiving.view', 'overview.view', 'docs.prepare', 'docs.submit'],
  qc: ['receiving.view', 'qc.queue.view', 'qc.measure', 'qc.decide', 'overview.view'],
  ho: ['receiving.view', 'overview.view', 'ho.inbox', 'ho.review', 'erp.confirm'],
  admin: ['receiving.view', 'overview.view', 'ho.inbox', 'admin.users'],
};

export const ALL_ROLES: RoleCode[] = ['gate', 'gate_doc', 'qc', 'ho', 'admin'];

export function capsFor(role: RoleCode): Capability[] {
  return grants[role];
}

export function can(user: User | null, cap: Capability): boolean {
  return !!user && user.active !== false && user.roles.some((r) => grants[r]?.includes(cap));
}

export const roleLabel: Record<RoleCode, string> = {
  gate: 'Gate Operator',
  gate_doc: 'Gate Document Authority',
  qc: 'QC Operator',
  ho: 'Head Office Accounts',
  admin: 'System Admin',
};

export const capabilityLabel: Record<Capability, string> = {
  'receiving.view': 'View receiving register',
  'receiving.create': 'Create receiving visit',
  'receiving.edit': 'Correct Gate details (with reason)',
  'gate.followup': 'Record tare, exit and GRN reference',
  'qc.queue.view': 'View QC queue',
  'qc.measure': 'Enter QC readings',
  'qc.decide': 'Record the final QC decision',
  'overview.view': 'View operations overview',
  'docs.prepare': 'Prepare document checklist',
  'docs.submit': 'Authorise and send package to HO',
  'ho.inbox': 'View Head Office inbox and PDFs',
  'ho.review': 'Verify documents / request corrections',
  'erp.confirm': 'Record DataMan milestones and reminders',
  'admin.users': 'Administer users and roles',
};

/** Every role lands on its Home screen (role job cards). Old role pages stay reachable. */
export function landingPath(_user: User): string {
  return '/home';
}
