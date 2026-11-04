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
  | 'erp.confirm'             // record staff-confirmed DataMan milestones and reminders (HO)
  | 'erp.plant_head_approval' // Document Authority: confirm Plant Head GRN approval
  | 'erp.purchase_voucher'    // Head Office: confirm purchase voucher
  | 'erp.final_posting'       // Head Accountant: confirm final posting (after approve)
  | 'accounting.inbox'        // view the accounting queue and packages in accounting states
  | 'accounting.review'  // Accountant: start accounting, hand over, correct with reason
  | 'accounting.approve' // Head Accountant: approve or return to the Accountant
  | 'accounting.post'    // Head Accountant: post the bill (final internal state)
  | 'admin.users';

const grants: Record<RoleCode, Capability[]> = {
  gate: ['receiving.view', 'receiving.create', 'receiving.edit', 'gate.followup', 'qc.queue.view'],
  // Document Authority has the same operational powers as Gate plus document preparation and
  // submission. It is intentionally separate from the plain Gate operator (the Gate operator
  // must not see Documents).
  gate_doc_authority: ['receiving.view', 'receiving.create', 'receiving.edit', 'gate.followup', 'qc.queue.view', 'overview.view', 'docs.prepare', 'docs.submit', 'erp.plant_head_approval'],
  gate_doc: ['receiving.view', 'overview.view', 'docs.prepare', 'docs.submit', 'erp.plant_head_approval'],
  qc: ['receiving.view', 'qc.queue.view', 'qc.measure', 'qc.decide', 'overview.view'],
  ho: ['receiving.view', 'overview.view', 'ho.inbox', 'ho.review', 'erp.confirm', 'erp.purchase_voucher'],
  accountant: ['receiving.view', 'overview.view', 'accounting.inbox', 'accounting.review'],
  head_accountant: ['receiving.view', 'overview.view', 'accounting.inbox', 'accounting.review', 'accounting.approve', 'accounting.post', 'erp.final_posting'],
  admin: ['receiving.view', 'overview.view', 'ho.inbox', 'admin.users'],
};

export const ALL_ROLES: RoleCode[] = ['gate', 'gate_doc', 'gate_doc_authority', 'qc', 'ho', 'accountant', 'head_accountant', 'admin'];

export function capsFor(role: RoleCode): Capability[] {
  return grants[role];
}

export function can(user: User | null, cap: Capability): boolean {
  return !!user && user.active !== false && user.roles.some((r) => grants[r]?.includes(cap));
}

export const roleLabel: Record<RoleCode, string> = {
  gate: 'Gate Operator',
  gate_doc: 'डॉक्युमेंट अथॉरिटी',
  gate_doc_authority: 'डॉक्युमेंट अथॉरिटी',
  qc: 'क्यूसी ऑपरेटर',
  ho: 'हेड ऑफिस अकाउंट्स',
  accountant: 'अकाउंटंट',
  head_accountant: 'हेड अकाउंटंट',
  admin: 'सिस्टम अडमिन',
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
  'erp.confirm': 'रecord staff-confirmed DataMan milestones and reminders (HO)',
  'erp.plant_head_approval': 'Plant Head GRN अनुमोदन पुष्टी करा (DataMan)',
  'erp.purchase_voucher': 'खरेदी वाउचर पुष्टी करा (DataMan)',
  'erp.final_posting': 'अंतिम पोस्टिंग पुष्टी करा (DataMan, मंज़ूरीनंतर)',
  'accounting.inbox': 'अकाउंटिंग क्यू आणि पॅकेजेस पाहा',
  'accounting.review': 'Start accounting and hand over to the Head Accountant',
  'accounting.approve': 'Approve accounting or return it to the Accountant',
  'accounting.post': 'Post the bill (final accounting state)',
  'admin.users': 'Administer users and roles',
};

/** Every role lands on its Home screen (role job cards). Old role pages stay reachable. */
export function landingPath(_user: User): string {
  return '/home';
}
