/**
 * Shared E2E helpers: per-role browser contexts (login through the context's own
 * request or a cached session cookie so the __Host-kpmpl_sid cookie is always a
 * real session), UI login, unique demo references and a minimal PDF fixture.
 */
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { USERS, type RoleCode } from './env';

/** Login via the API (cookie lands in the context jar from the real Set-Cookie). */
export async function loginContext(browser: Browser, role: RoleCode): Promise<BrowserContext> {
  const user = USERS[role];
  const context = await browser.newContext();

  // The backend allows 5 logins/min per IP+username (brief §3); a wait-and-retry
  // keeps an infrastructure rule from failing a journey.
  let response: Awaited<ReturnType<BrowserContext['request']['post']>> | null = null;
  for (let attempt = 0; attempt < 16; attempt++) {
    response = await context.request.post('/api/v1/auth/login', {
      data: { username: user.username, password: user.password },
      timeout: 30_000,
    });
    if (response.ok() || response.status() !== 429) break;
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  expect(response!.ok(), `login as ${user.username}`).toBeTruthy();
  return context;
}

/**
 * The backend keeps a GLOBAL five-session limit and evicts the oldest live
 * session on every further login (brief §3, `session_evicted`). Spec files must
 * therefore hold as few sessions as possible: take one role at a time and log
 * each one out before taking the next.
 */
export class RolePool {
  private active: BrowserContext | null = null;
  constructor(private readonly browser: Browser) {}

  /** Log the previous role out and open a page signed in as the new one. */
  async page(role: RoleCode): Promise<Page> {
    await this.release();
    return (await this.context(role)).newPage();
  }

  /** Log the previous role out and return a fresh context for the new one. */
  async context(role: RoleCode): Promise<BrowserContext> {
    await this.release();
    this.active = await loginContext(this.browser, role);
    return this.active;
  }

  /** Hand an externally created (e.g. UI login) context over to the pool. */
  adopt(context: BrowserContext): void {
    this.active = context;
  }

  async release(): Promise<void> {
    if (!this.active) return;
    const context = this.active;
    this.active = null;
    // Cookie-authenticated writes need Origin proof (brief §3 CSRF): without it the
    // server refuses the logout and the session stays live, where the backend's
    // global five-session limit would eventually evict sessions still in use.
    await context.request.post('/api/v1/auth/logout', {
      headers: { Origin: process.env.E2E_BASE_URL ?? 'http://localhost:5173', 'X-Requested-With': 'kpmpl-web' },
    }).catch(() => {});
    await context.close();
  }
}

/** Sign in through the real login form (used where the form itself is under test). */
export async function loginViaUi(page: Page, role: RoleCode): Promise<void> {
  const user = USERS[role];
  await page.goto('/#/login');
  await page.getByRole('textbox', { name: 'Username' }).fill(user.username);
  await page.getByRole('textbox', { name: 'Password' }).fill(user.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('button', { name: user.displayName })).toBeVisible();
}

/**
 * R-01 caps officialGateEntryRef at 40 chars; keep every generated reference
 * clearly below that and unique per run so repeated runs never collide.
 */
export function uniqueRef(prefix: string): string {
  const tail = `${Date.now().toString(36)}${Math.floor(Math.random() * 1_000_000).toString(36)}`;
  return `${prefix}-${tail}`.slice(0, 40);
}

export function uniqueVehicle(): string {
  return `DEMO-MH-${Math.floor(Math.random() * 90 + 10)}-${uniqueRef('E2E').slice(-10)}`.replace(/[^A-Z0-9-]/gi, '').slice(0, 20);
}

/** Look up a visit's id by its gate entry reference (useful to deep-link by URL). */
export async function getVisitId(context: BrowserContext, visitRef: string): Promise<string> {
  const response = await context.request.get(`/api/v1/receiving-visits?search=${encodeURIComponent(visitRef)}`);
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as { data: { data: Array<{ id: string; officialGateEntryRef: string }> } };
  const visit = body.data.data.find((v) => v.officialGateEntryRef === visitRef);
  expect(visit, `visit ${visitRef} exists`).toBeTruthy();
  return visit!.id;
}

/** A tiny valid PDF (one blank page) — enough for the upload input and the viewer. */
export function pdfBytes(): Buffer {
  const pdf = [
    '%PDF-1.4',
    '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj',
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj',
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj',
    'trailer<</Root 1 0 R/Size 4>>',
    '%%EOF',
  ].join('\n');
  return Buffer.from(pdf, 'latin1');
}

/**
 * New truck stepper (v0.7 UI): Truck → Load → Weight → Check and confirm.
 * Leaves the page on the confirm step; the caller presses "Save and send to QC".
 */
export async function fillNewTruck(page: Page, t: { ref: string; vehicle: string; supplier: string; gross: string }): Promise<void> {
  await page.getByLabel('Gate Entry No.').fill(t.ref);
  await page.getByLabel('Vehicle No.').fill(t.vehicle);
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByLabel('Supplier').fill(t.supplier);
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByLabel('Loaded truck weight (kg)').fill(t.gross);
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByRole('heading', { name: 'Check and confirm' })).toBeVisible();
}

/** QC readings stepper: Readings → Remarks → Check and confirm. */
export async function submitQcReadings(page: Page, moisture: string, impurity: string, opts: { remarks?: string; revisionReason?: string } = {}): Promise<void> {
  await page.getByLabel('Moisture (%)').fill(moisture);
  await page.getByLabel('Impurity (%)').fill(impurity);
  await page.getByRole('button', { name: 'Next' }).click();
  if (opts.remarks) await page.getByLabel('Remarks').fill(opts.remarks);
  if (opts.revisionReason) await page.getByLabel('Reason for revision').fill(opts.revisionReason);
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Submit to Gate' }).click();
}

/** QC decision stepper: choose → reason → confirm. */
export async function decideQc(page: Page, label: string, reason: string): Promise<void> {
  await page.getByRole('button', { name: new RegExp(`^${label}`) }).first().click();
  await page.getByLabel(label === 'Accept' ? 'Remarks' : 'Reason').fill(reason);
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: `Save decision: ${label}` }).click();
  // The success panel renders the outcome label from decisionOutcomeLabel (QcReadings.tsx).
  const savedLabel = label === 'Re-check readings' ? 'Returned for correction'
    : label === 'Accept' ? 'Accepted'
    : label === 'Accept with deduction' ? 'Accepted with deduction'
    : label;
  await expect(page.getByText(`Decision saved: ${savedLabel}`)).toBeVisible();
}
