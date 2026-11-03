import { test, expect, type Request } from '@playwright/test';
import { RolePool, uniqueRef, uniqueVehicle, getVisitId, fillNewTruck } from './lib/helpers';

/**
 * Journeys 12 and 14 — the writes are the dangerous part of this system:
 *  - 14: a dropped connection mid-save must let the user retry with the SAME
 *    Idempotency-Key, so the backend creates exactly one visit (brief §3);
 *  - 12: two concurrent editors on one visit must surface VERSION_CONFLICT
 *    (If-Match) with an honest "Reload latest" recovery path.
 */
test.describe.configure({ mode: 'serial' });

let roles: RolePool;
test.beforeAll(({ browser }) => {
  roles = new RolePool(browser);
});
test.afterAll(async () => {
  await roles.release();
});

test('journey 14 — network failure: retry reuses the same Idempotency-Key, no double entry', async () => {
  const gateRef = uniqueRef('DEMO-GATE');
  const page = await roles.page('gate');
  await page.goto('/#/receiving/new');

  await fillNewTruck(page, { ref: gateRef, vehicle: uniqueVehicle(), supplier: 'Demo Supplier C', gross: '12800.000' });

  const seenKeys: string[] = [];
  const capturePost = (request: Request) => {
    if (request.method() === 'POST' && request.url().includes('/receiving-visits')) {
      seenKeys.push((request.headers()['idempotency-key'] ?? '').toLowerCase());
    }
  };
  page.on('request', capturePost);

  // Drop the connection for the first POST.
  await page.route('**/api/v1/receiving-visits', async (route) => {
    if (route.request().method() === 'POST') return route.abort('connectionrefused');
    return route.fallback();
  });
  await page.getByRole('button', { name: 'Save and send to QC' }).click();
  await expect(page.getByText('Nothing was saved. Press Save and send to QC again to retry.')).toBeVisible();
  expect(seenKeys.length).toBe(1);
  expect(seenKeys[0], 'Idempotency-Key present on the first attempt').not.toBe('');

  // The user retries; the useWrite hook reuses the cached key.
  await page.unroute('**/api/v1/receiving-visits');
  await page.getByRole('button', { name: 'Save and send to QC' }).click();
  await expect(page.getByRole('heading', { name: 'Saved and sent to QC' })).toBeVisible();

  expect(seenKeys.length).toBe(2);
  expect(seenKeys[1], 'retry reuses the SAME Idempotency-Key').toBe(seenKeys[0]);

  // Exactly one visit was created server-side.
  await page.goto('/#/receiving');
  await page.getByLabel('Search by Gate Entry No., vehicle or supplier').fill(gateRef);
  await expect(page.getByRole('link', { name: gateRef })).toHaveCount(1);
});

test('journey 12 — concurrency: second editor gets VERSION_CONFLICT and recovers', async () => {
  const ref = uniqueRef('DEMO-GATE');
  const originalVehicle = uniqueVehicle();
  // A fresh on-premises visit to edit.
  const gateContext = await roles.context('gate');
  const setup = await gateContext.newPage();
  await setup.goto('/#/receiving/new');
  await expect(setup.getByRole('heading', { name: 'New Receiving' })).toBeVisible();
  await fillNewTruck(setup, { ref, vehicle: originalVehicle, supplier: 'Demo Supplier A', gross: '13100.000' });
  await setup.getByRole('button', { name: 'Save and send to QC' }).click();
  await expect(setup.getByRole('heading', { name: 'Saved and sent to QC' })).toBeVisible();

  const visitId = await getVisitId(gateContext, ref);
  const openCorrectPage = async (page: import('@playwright/test').Page) => {
    await page.goto(`/#/receiving/${visitId}/correct`);
    await expect(page.getByRole('heading', { name: 'Correct Gate details' })).toBeVisible();
    // The form populates asynchronously — wait until the visit data has landed
    // before editing, or the populate pass wipes the typed values.
    await expect(page.getByLabel('Vehicle No.')).toHaveValue(originalVehicle);
  };

  const pageA = await gateContext.newPage();
  const pageB = await gateContext.newPage();
  await openCorrectPage(pageA);
  await openCorrectPage(pageB);

  // Editor A saves first: vehicle corrected.
  const correctedVehicle = uniqueVehicle();
  await pageA.getByLabel('Vehicle No.').fill(correctedVehicle);
  await pageA.getByLabel('Reason for correction').fill('E2E: dispatcher typo on the vehicle number.');
  await pageA.getByRole('button', { name: 'Save correction' }).click();
  await expect(pageA.getByText('Gate details corrected. The earlier values are kept in the history.')).toBeVisible();

  // Editor B still holds the old version: the server rejects with 409.
  const challanRef = uniqueRef('DEMO-CH');
  await pageB.getByLabel('Challan No.').fill(challanRef);
  await pageB.getByLabel('Reason for correction').fill('E2E: adding the challan number.');
  await pageB.getByRole('button', { name: 'Save correction' }).click();
  await expect(pageB.getByText('Updated by someone else')).toBeVisible();
  await pageB.getByRole('button', { name: 'Reload latest' }).click();

  // After reloading the latest version (form repopulates asynchronously) the same
  // change saves cleanly.
  await expect(pageB.getByLabel('Vehicle No.')).toHaveValue(correctedVehicle);
  // The reload restored the visit's own values — re-apply the challan edit.
  await pageB.getByLabel('Challan No.').fill(challanRef);
  await pageB.getByLabel('Reason for correction').fill('E2E: adding the challan number after reload.');
  await pageB.getByRole('button', { name: 'Save correction' }).click();
  await expect(pageB.getByText('Gate details corrected. The earlier values are kept in the history.')).toBeVisible();

  await pageA.close();
  await pageB.close();
  await setup.close();
});
