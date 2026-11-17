import { test, expect } from '@playwright/test';
import { RolePool } from './lib/helpers';

/**
 * Phase 06 — DataMan ERP gate-entry screens against the REAL local stack
 * (Vite dev server + `@kpmpl/api` on :3000 + Postgres/Redis/MinIO).
 *
 * The local API deliberately has no ERP credentials, so the ERP adapter reports the
 * data source as unavailable. That is the scenario these tests pin down:
 *  - HO can find the screen from Home and sees an explicit outage, never "no records";
 *  - a role without `erp.read` has no entry point and the ROUTE still refuses it
 *    (hiding a link is not access control — the backend @Requires('erp.read') is the
 *    real gate; the API-level 401/403/503 probes are in the Phase 06 evidence log);
 *  - an expired session lands on the login screen.
 *
 * No ERP record content is asserted here: with the ERP unreachable there is no ERP data,
 * and a mocked fixture would prove nothing about the integration.
 */
let roles: RolePool;

test.beforeAll(({ browser }) => {
  roles = new RolePool(browser);
});
test.afterAll(async () => {
  await roles.release();
});

test('HO reaches ERP gate entries from Home and the page reports the ERP outage', async () => {
  const page = await roles.page('ho');

  await page.goto('/#/home');
  const card = page.getByRole('link', { name: /DataMan gate entries/i });
  await expect(card).toBeVisible();
  await card.click();

  await expect(page).toHaveURL(/#\/erp\/gate-entries/);
  await expect(page.getByRole('heading', { name: 'ERP Gate Entries' })).toBeVisible();

  // Outage branch: an explicit alert, NOT an empty result set.
  await expect(page.getByRole('alert').filter({ hasText: 'ERP unavailable' })).toBeVisible();
  await expect(page.getByText(/temporarily unavailable/i)).toBeVisible();
  await expect(page.getByRole('table')).toHaveCount(0);
  await expect(page.getByText(/No gate entries/i)).toHaveCount(0);
});

test('ERP gate-entry detail reports the ERP outage instead of a missing record', async () => {
  const page = await roles.page('ho');

  await page.goto('/#/erp/gate-entries/GI-2026-0001');

  await expect(page.getByRole('alert').filter({ hasText: 'ERP unavailable' })).toBeVisible();
  // A 404 "not in ERP" message would be a lie while the ERP is unreachable.
  await expect(page.getByText(/not found in ERP/i)).toHaveCount(0);
});

test('a role without erp.read has no ERP entry point and cannot open the route by URL', async () => {
  const page = await roles.page('gate');

  await page.goto('/#/home');
  await expect(page.getByRole('link', { name: /DataMan gate entries/i })).toHaveCount(0);

  await page.goto('/#/erp/gate-entries');
  // RequireCap redirects to the landing page instead of rendering ERP content.
  await expect(page.getByRole('heading', { name: 'ERP Gate Entries' })).toHaveCount(0);
  await expect(page).toHaveURL(/#\/home/);
});

test('an expired web session returns to the login screen', async () => {
  const context = await roles.context('ho');
  const page = await context.newPage();

  await page.goto('/#/home');
  await expect(page.getByRole('link', { name: /DataMan gate entries/i })).toBeVisible();

  // Dropping the session cookie is what an expired/evicted session looks like to the app.
  await context.clearCookies();
  await page.goto('/#/erp/gate-entries');

  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'ERP Gate Entries' })).toHaveCount(0);
});
