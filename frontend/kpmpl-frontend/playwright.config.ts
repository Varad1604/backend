import { defineConfig, devices } from '@playwright/test';

/**
 * KPMPL gate-to-bill E2E suite (Phase 2). Runs the 14 journeys against the
 * integration compose stack (backend/docs/integration/LOCAL.md):
 *  - project "dev"       → http://localhost:5173 (Vite dev, demo chrome)
 *  - project "prod-like" → http://localhost:8080 (nginx image; start compose with
 *    `--profile prod-like`), selected explicitly: `npx playwright test --project=prod-like`.
 *
 * `npx playwright test` runs BOTH projects; the setup project logs the five demo
 * users in through the real login form once per run. Retries stay OFF: the exit
 * criterion for this phase is a flake rate of 0 over three consecutive runs, and
 * a retry would hide flakes instead of surfacing them.
 */
const DEV_BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
const PROD_BASE_URL = process.env.E2E_BASE_URL_PROD ?? 'http://localhost:8080';

export default defineConfig({
  testDir: './e2e',
  // One browser context per role is created by each spec's beforeAll (login happens
  // through the context's request so the __Host- session cookie is set by a real
  // response, never re-injected from serialized state).
  fullyParallel: false,
  workers: process.env.CI ? 1 : 2,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    // Top-level default so the setup project has an origin; dev/prod-like override it.
    baseURL: DEV_BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 20_000,
    // The Vite dev server transforms modules on demand; the first page load after a
    // fresh container boot pays that cost over a Windows bind mount.
    navigationTimeout: 45_000,
  },
  projects: [
    {
      name: 'setup',
      testMatch: /setup\/.*\.setup\.ts/,
    },
    {
      name: 'dev',
      baseURL: DEV_BASE_URL,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'prod-like',
      baseURL: PROD_BASE_URL,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
