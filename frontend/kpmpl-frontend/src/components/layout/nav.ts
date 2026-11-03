import type { Capability } from '../../auth/permissions';

export interface NavItem {
  to: string;
  label: string;
  /** Shown when the user has ANY of these capabilities. */
  caps: Capability[];
  end?: boolean;
}

/** One flat menu, in the order work moves through the mill. */
export const navItems: NavItem[] = [
  { to: '/gate', label: 'Gate', caps: ['receiving.create'], end: true },
  { to: '/receiving/new', label: 'New receiving', caps: ['receiving.create'] },
  { to: '/receiving', label: 'Register', caps: ['receiving.view'], end: true },
  { to: '/gate/follow-up', label: 'Tare, exit, GRN', caps: ['gate.followup'] },
  { to: '/qc', label: 'QC queue', caps: ['qc.measure'], end: true },
  { to: '/documents', label: 'Documents', caps: ['docs.prepare'] },
  { to: '/head-office', label: 'HO inbox', caps: ['ho.inbox'] },
  { to: '/erp-milestones', label: 'ERP milestones', caps: ['ho.inbox'] },
  { to: '/accounting', label: 'Accounting', caps: ['accounting.inbox'] },
  { to: '/overview', label: 'Overview', caps: ['overview.view'] },
  { to: '/admin/users', label: 'Users', caps: ['admin.users'] },
];
