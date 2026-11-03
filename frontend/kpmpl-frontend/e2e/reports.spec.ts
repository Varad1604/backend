import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { RolePool } from './lib/helpers';

/**
 * Journey 9 — CSV download from the operations overview (brief §10: the report
 * endpoint streams text/csv; the browser saves it with the server filename).
 */
let roles: RolePool;
test.beforeAll(({ browser }) => {
  roles = new RolePool(browser);
});
test.afterAll(async () => {
  await roles.release();
});

test('Export CSV downloads the receiving register with seeded rows', async () => {
  const page = await roles.page('admin');
  await page.goto('/#/overview');
  await expect(page.getByRole('heading', { name: 'Operations Overview' })).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(/^receiving\.csv$/);
  const csv = readFileSync(await download.path(), 'utf8');
  expect(csv).toContain('DEMO-GATE-0001');
  expect(csv).toContain('Demo Supplier A');
});
