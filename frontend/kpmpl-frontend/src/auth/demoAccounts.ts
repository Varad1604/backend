import type { RoleCode } from '../domain/types';

/**
 * Synthetic demo account usernames (brief §9 seed: demo-gate, demo-qc, demo-docs,
 * demo-ho, demo-admin). Used by the login page's demo picker only when
 * APP_MODE=demo. Holds no secrets: the server's demo password comes from its own env.
 */
export const DEMO_ACCOUNTS: readonly { username: string; displayName: string; role: RoleCode }[] = [
  { username: 'demo-gate', displayName: 'Demo Gate User', role: 'gate' },
  { username: 'demo-qc', displayName: 'Demo QC User', role: 'qc' },
  { username: 'demo-docs', displayName: 'Demo Document Authority', role: 'gate_doc' },
  { username: 'demo-ho', displayName: 'Demo HO User', role: 'ho' },
  { username: 'demo-accountant', displayName: 'Demo Accountant', role: 'accountant' },
  { username: 'demo-headacc', displayName: 'Demo Head Accountant', role: 'head_accountant' },
  { username: 'demo-admin', displayName: 'Demo Admin', role: 'admin' },
];

/** Password of every seeded account in the in-browser MOCK adapter only. Never valid on a server. */
export const MOCK_DEMO_PASSWORD = 'demo';
