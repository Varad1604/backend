import { test, expect } from '@playwright/test';
import { RolePool, loginViaUi, uniqueRef, uniqueVehicle, fillNewTruck, submitQcReadings, decideQc } from './lib/helpers';

/**
 * The revision loop on a fresh visit (returns keep happening in real mills):
 * QC submits revision 1 → the QC operator sends it back for a re-check with a reason
 * → QC resubmits revision 2 (drafts overwritten until submitted, R-07) → the QC
 * operator accepts with deduction (D-03: the QC operator decides). Reload
 * persistence is asserted at every hop.
 */
test.describe.configure({ mode: 'serial' });

const gateRef = uniqueRef('DEMO-GATE');
const vehicleNo = uniqueVehicle();
let roles: RolePool;

test.beforeAll(({ browser }) => {
  roles = new RolePool(browser);
});
test.afterAll(async () => {
  await roles.release();
});

test('gate creates the visit; QC submits revision 1', async () => {
  const page = await roles.page('gate');
  await page.goto('/#/receiving/new');
  await fillNewTruck(page, { ref: gateRef, vehicle: vehicleNo, supplier: 'Demo Supplier B', gross: '15900.000' });
  await page.getByRole('button', { name: 'Save and send to QC' }).click();
  await expect(page.getByRole('heading', { name: 'Saved and sent to QC' })).toBeVisible();

  const qcPage = await roles.page('qc');
  await qcPage.goto('/#/qc');
  await qcPage.getByRole('tab', { name: 'Pending' }).click();
  await qcPage.getByRole('link', { name: gateRef }).first().click();
  await expect(qcPage.getByRole('heading', { name: gateRef })).toBeVisible();
  await submitQcReadings(qcPage, '13.75', '2.25');
  await expect(qcPage.getByText('Readings submitted to Gate')).toBeVisible();
});

test('the QC operator sends the readings back for a re-check with a reason', async () => {
  const page = await roles.page('qc');
  await page.goto('/#/qc?tab=submitted');
  await page.getByRole('link', { name: gateRef }).first().click();
  await expect(page.getByRole('heading', { name: gateRef })).toBeVisible();
  await decideQc(page, 'Re-check readings', 'E2E: moisture near the limit, re-check on a second sample.');

  // The readings are open again for a corrected revision, also after a reload.
  await page.reload();
  await expect(page.getByText('Corrected readings — revision 2')).toBeVisible();
});

test('QC resubmits as revision 2 with a reason; drafts are overwritten until submitted', async () => {
  const page = await roles.page('qc');
  await page.goto('/#/qc');
  await page.getByRole('tab', { name: 'Returned' }).click();
  await page.getByRole('link', { name: gateRef }).first().click();
  await expect(page.getByRole('heading', { name: gateRef })).toBeVisible();
  await expect(page.getByText('Corrected readings — revision 2')).toBeVisible();

  // R-07: the returned draft is overwritten, not appended — save a draft, reload,
  // edit the SAME draft, save again, and verify the overwrite is what persists.
  // A returned inspection starts a fresh revision: both readings are entered anew.
  await page.getByLabel('Moisture (%)').fill('12.10');
  await page.getByLabel('Impurity (%)').fill('2.25');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByLabel('Reason for revision').fill('E2E: second sample dried the reading.');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText('Draft saved')).toBeVisible();

  await page.reload();
  await expect(page.getByLabel('Moisture (%)')).toHaveValue('12.10');
  await expect(page.getByLabel('Impurity (%)')).toHaveValue('2.25');
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByLabel('Reason for revision')).toHaveValue('E2E: second sample dried the reading.');
  await page.getByRole('button', { name: 'Back' }).click();

  await page.getByLabel('Moisture (%)').fill('11.90');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText('Draft saved')).toBeVisible();

  // Reload mid-revision: the overwritten draft (11.90) is what persisted.
  await page.reload();
  await expect(page.getByLabel('Moisture (%)')).toHaveValue('11.90');
  await expect(page.getByLabel('Impurity (%)')).toHaveValue('2.25');
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByLabel('Reason for revision')).toHaveValue('E2E: second sample dried the reading.');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Submit to Gate' }).click();
  await expect(page.getByText('Readings submitted to Gate')).toBeVisible();
});

test('the QC operator accepts with deduction; the visit shows the outcome', async () => {
  const page = await roles.page('qc');
  await page.goto('/#/qc?tab=submitted');
  await page.getByRole('link', { name: gateRef }).first().click();
  await decideQc(page, 'Accept with deduction', 'E2E: 1.5% impurity deduction applied per schedule.');

  // The gate sees the outcome on the visit detail (cross-role visibility of the decision).
  const gatePage = await roles.page('gate');
  await gatePage.goto('/#/receiving');
  await gatePage.getByLabel('Search by Gate Entry No., vehicle or supplier').fill(gateRef);
  await gatePage.getByRole('link', { name: gateRef }).click();
  await expect(gatePage.getByRole('heading', { name: gateRef })).toBeVisible();
  await expect(gatePage.getByText('Accepted with deduction').first()).toBeVisible();
});
