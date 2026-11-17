/**
 * Demo credentials and role metadata for the E2E suite.
 * DEMO_PASSWORD comes from the environment or is parsed out of backend/.env
 * (the integration compose stack reads the same value).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export type RoleCode = 'gate' | 'gate_doc' | 'gate_doc_authority' | 'qc' | 'ho' | 'accountant' | 'head_accountant' | 'admin';

export interface DemoUser {
  username: string;
  password: string;
  displayName: string;
  role: RoleCode;
}

function resolveDemoPassword(): string {
  if (process.env.DEMO_PASSWORD) return process.env.DEMO_PASSWORD;
  // e2e/lib/ → frontend repo → ../../backend/.env
  const backendEnv = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'backend', '.env');
  try {
    const line = readFileSync(backendEnv, 'utf8')
      .split(/\r?\n/)
      .find((l) => l.startsWith('DEMO_PASSWORD='));
    if (line) return line.slice('DEMO_PASSWORD='.length).trim();
  } catch {
    /* fall through */
  }
  throw new Error('DEMO_PASSWORD is not set and backend/.env does not provide it.');
}

export const DEMO_PASSWORD = resolveDemoPassword();

/** The seven seeded demo users (apps/api/src/seed.ts) — includes the accounting roles
 * added by the 2026-11-03 upgrade; journey 8 walks the accounting handoff. */
export const USERS: Record<RoleCode, DemoUser> = {
  gate: { username: 'demo-gate', password: DEMO_PASSWORD, displayName: 'Demo Gate User', role: 'gate' },
  qc: { username: 'demo-qc', password: DEMO_PASSWORD, displayName: 'Demo QC User', role: 'qc' },
  gate_doc: { username: 'demo-docs', password: DEMO_PASSWORD, displayName: 'Demo Document Authority', role: 'gate_doc' },
  ho: { username: 'demo-ho', password: DEMO_PASSWORD, displayName: 'Demo HO User', role: 'ho' },
  accountant: { username: 'demo-accountant', password: DEMO_PASSWORD, displayName: 'Demo Accountant', role: 'accountant' },
  head_accountant: { username: 'demo-headacc', password: DEMO_PASSWORD, displayName: 'Demo Head Accountant', role: 'head_accountant' },
  admin: { username: 'demo-admin', password: DEMO_PASSWORD, displayName: 'Demo Admin', role: 'admin' },
};
