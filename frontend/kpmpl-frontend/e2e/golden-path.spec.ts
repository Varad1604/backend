import { test, expect } from '@playwright/test';
import { RolePool, loginViaUi, uniqueRef, uniqueVehicle, pdfBytes, fillNewTruck, decideQc } from './lib/helpers';

/**
 * The golden path (brief §12.13 style): one fresh truck flows gate entry → QC →
 * review → tare/exit/GRN → document package → Head Office → ERP milestones.
 * Every journey asserts reload persistence — state lives server-side in the
 * session cookie, so a reload must restore exactly where the user was.
 * Journeys covered here: 1 gate entry, 2 QC, 3 QC review, 4 tare/exit/GRN,
 * 5 package, 6 send to HO, 7 HO review + PDF viewer, 8 ERP milestones.
 */
test.describe.configure({ mode: 'serial' });

// Shared across the serial chain: the visit created by journey 1.
const gateRef = uniqueRef('DEMO-GATE');
const vehicleNo = uniqueVehicle();
const grnRef = uniqueRef('DEMO-GRN');
const invoiceRef = uniqueRef('DEMO-INV');
const supplier = 'Demo Supplier A';
const gross = '24500.500';
const tare = '6100.000';

let packageRef = '';
let packageId = '';
// One live session at a time: the backend keeps a global five-session limit and
// evicts the oldest session on every further login.
let roles: RolePool;

test.beforeAll(({ browser }) => {
  roles = new RolePool(browser);
});
test.afterAll(async () => {
  await roles.release();
});

test('journey 1 — gate entry: new receiving saved, survives reload, lands in QC queue', async ({ browser }) => {
  // The gate user logs in through the real form (the other roles use API login).
  const gateContext = await browser.newContext();
  roles.adopt(gateContext);
  const page = await gateContext.newPage();
  await loginViaUi(page, 'gate');

  // Role home: large job cards.
  await page.locator('#main').getByRole('link', { name: /New truck/ }).click();
  await expect(page.getByRole('heading', { name: 'New Receiving' })).toBeVisible();
  await fillNewTruck(page, { ref: gateRef, vehicle: vehicleNo, supplier, gross });
  await expect(page.getByText('Domestic Waste Paper')).toBeVisible();
  await page.getByRole('button', { name: 'Save and send to QC' }).click();

  // Saved confirmation is explicit, not a toast that disappears.
  await expect(page.getByRole('heading', { name: 'Saved and sent to QC' })).toBeVisible();
  await expect(page.getByText(gateRef).first()).toBeVisible();

  // Reload persistence: back on the register, the entry is there with QC pending.
  await page.reload();
  await page.goto('/#/receiving');
  await page.getByLabel('Search by Gate Entry No., vehicle or supplier').fill(gateRef);
  const row = page.getByRole('link', { name: gateRef });
  await expect(row).toBeVisible();
  await row.click();
  await expect(page.getByRole('heading', { name: gateRef })).toBeVisible();
  await expect(page.getByText('QC pending').first()).toBeVisible();
  await expect(page.getByText(vehicleNo).first()).toBeVisible();
});

test('journey 1 duplicate — returns to Gate Entry No. with an actionable existing-entry link', async () => {
  const page = await roles.page('gate');
  await page.goto('/#/receiving/new');
  await fillNewTruck(page, { ref: gateRef, vehicle: uniqueVehicle(), supplier, gross });
  await page.getByRole('button', { name: 'Save and send to QC' }).click();

  const duplicateAlert = page.getByRole('alert').filter({ hasText: 'Possible duplicate' }).first();
  await expect(duplicateAlert).toBeVisible();
  await expect(page.getByLabel('Gate Entry No.')).toBeVisible();
  await expect(duplicateAlert).toContainText(`A receiving visit with Gate Entry Number ${gateRef} already exists`);
  await expect(duplicateAlert.getByRole('link', { name: 'Open the existing entry' })).toHaveAttribute('href', /#?\/receiving\//);
});

test('journey 2 — QC: draft persists across reload, submit reaches Gate', async () => {
  const page = await roles.page('qc');
  await page.goto('/#/qc');
  await expect(page.getByRole('heading', { name: 'QC Queue' })).toBeVisible();
  await page.getByRole('tab', { name: 'Pending' }).click();
  await page.getByRole('link', { name: `Take sample ${gateRef}` }).or(page.getByRole('link', { name: gateRef }).first()).first().click();
  await expect(page.getByRole('heading', { name: gateRef })).toBeVisible();

  await page.getByLabel('Moisture (%)').fill('11.25');
  await page.getByLabel('Impurity (%)').fill('1.50');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByLabel('Remarks').fill('E2E: first sample, dry weather.');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText('Draft saved')).toBeVisible();

  // A draft must survive a reload (R-07: drafts are overwritten until submitted).
  await page.reload();
  await expect(page.getByLabel('Moisture (%)')).toHaveValue('11.25');
  await expect(page.getByLabel('Impurity (%)')).toHaveValue('1.50');

  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Submit to Gate' }).click();
  await expect(page.getByText('Readings submitted to Gate')).toBeVisible();

  // Submitted readings are locked and wait for the QC operator's decision, also after a reload.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'QC decision' })).toBeVisible();
});

test('journey 3 — QC decision: the QC operator accepts, decision visible to all', async () => {
  const page = await roles.page('qc');
  await page.goto('/#/qc');
  await expect(page.getByRole('heading', { name: 'QC Queue' })).toBeVisible();
  await page.getByRole('tab', { name: 'Awaiting decision' }).click();
  await page.getByRole('link', { name: new RegExp(`Decide ${gateRef}`) }).or(page.getByRole('link', { name: gateRef }).first()).first().click();
  await expect(page.getByRole('heading', { name: gateRef })).toBeVisible();

  await decideQc(page, 'Accept', 'E2E: readings plausible.');

  // Reload keeps the decision; the screen shows it as recorded and locked.
  await page.reload();
  await expect(page.getByText('QC decision recorded')).toBeVisible();
});

test('journey 4 — tare, physical exit and GRN with reload persistence', async () => {
  const page = await roles.page('gate');
  await page.goto('/#/gate/follow-up');
  await page.getByRole('tab', { name: 'Weigh empty truck' }).click();
  // The card opens the empty-weight stepper directly (?do=tare).
  await page.getByRole('link', { name: gateRef }).first().click();
  await expect(page.getByRole('heading', { name: gateRef })).toBeVisible();

  // Job 1 — empty weight (tare): enter, Next, confirm.
  await page.getByLabel('Empty truck weight (kg)').fill(tare);
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Save empty weight' }).click();
  await expect(page.getByText('Empty weight saved')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Back to this truck' }).click();
  // Durable evidence: the weighment history records the tare (net = gross - tare).
  // The API has slow episodes when both workers are hammering it — wait patiently.
  await expect(page.getByText('6100.000').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('18,400.500').first()).toBeVisible({ timeout: 30_000 });

  // Reload: tare is durable, exit and GRN still pending.
  await page.reload();
  await expect(page.getByText('6100.000').first()).toBeVisible({ timeout: 30_000 });

  // Job 2 — let truck out (prereqs are met: QC submitted + tare recorded)
  await page.getByRole('button', { name: 'Let truck out' }).first().click();
  await page.getByLabel('Mill exit checks for this truck are done.').check();
  await page.getByRole('button', { name: 'Next' }).click();
  // Domain rule: physicalExitAt must be within [createdAt - 1min, now + 5min].
  const exitAt = new Date(Date.now() - 10_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  await page.getByLabel('Exit time (IST)').fill(`${exitAt.getFullYear()}-${pad(exitAt.getMonth() + 1)}-${pad(exitAt.getDate())}T${pad(exitAt.getHours())}:${pad(exitAt.getMinutes())}`);
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Record exit' }).click();
  await expect(page.getByText('Truck has left the mill')).toBeVisible({ timeout: 30_000 });

  // Job 3 — GRN reference from DataMan
  await page.getByRole('button', { name: 'Enter GRN No.' }).click();
  await page.getByLabel('GRN No.').fill(grnRef);
  await page.getByLabel('I checked this GRN in DataMan myself.').check();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Save GRN' }).click();
  await expect(page.getByText(grnRef).first()).toBeVisible({ timeout: 30_000 });

  await page.reload();
  await expect(page.getByText('GRN recorded').first()).toBeVisible({ timeout: 30_000 });
});

test('journey 5 — document package: build checklist, attach PDFs, mark ready', async () => {
  const page = await roles.page('gate_doc');
  await page.goto('/#/documents/new');
  await expect(page.getByRole('heading', { name: 'New document package' })).toBeVisible();
  await page.getByLabel(`Select ${gateRef}`).check();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByLabel('Invoice No.').fill(invoiceRef);
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Create package' }).click();
  await page.getByRole('link', { name: 'Attach documents' }).click();

  await page.waitForURL(/\/documents\/[0-9a-f-]{36}/);
  packageId = page.url().match(/documents\/([0-9a-f-]{36})/)![1]!;
  // The heading holds a generic placeholder until the package data lands.
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^DEMO-PKG-/, { timeout: 20_000 });
  packageRef = (await page.getByRole('heading', { level: 1 }).textContent()) ?? '';
  await expect(page.getByText(`Invoice ${invoiceRef}`)).toBeVisible();

  // Attach the fixture PDF to every checklist category so nothing is "open".
  const inputs = page.locator('input[type="file"][accept="application/pdf,.pdf"]');
  const count = await inputs.count();
  expect(count, 'six document categories').toBe(6);
  for (let i = 0; i < count; i++) {
    await inputs.nth(i).setInputFiles({ name: `e2e-doc-${i}.pdf`, mimeType: 'application/pdf', buffer: pdfBytes() });
    await expect(page.getByText('e2e-doc-' + i + '.pdf').first()).toBeVisible();
  }

  await page.getByRole('button', { name: 'Mark ready for authority check' }).click();
  await expect(page.getByText('Marked ready. The document authority can now check and send it.')).toBeVisible();

  await page.reload();
  await expect(page.getByText('e2e-doc-5.pdf').first()).toBeVisible();
});

test('journey 6 — document authority sends the package to Head Office', async () => {
  const page = await roles.page('gate_doc');
  // Deep-link straight to the package journey 5 created (the packages list under
  // load is racy); the authority acts on exactly this package.
  await page.goto(`/#/documents/${packageId}`);
  await expect(page.getByRole('heading', { name: packageRef })).toBeVisible();

  await page.getByRole('button', { name: 'Check & send to Head Office' }).click();
  const dialog = page.getByRole('dialog', { name: 'Send to Head Office?' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('I checked this packet and it contains the applicable documents.').check();
  await dialog.getByRole('button', { name: 'Send to Head Office' }).click();
  await expect(page.getByText('Sent to Head Office').first()).toBeVisible();

  await page.reload();
  await expect(page.getByText('Sent to Head Office').first()).toBeVisible();
});

test('journey 7 — HO review: start, check each document, verify, open the private PDF', async () => {
  const page = await roles.page('ho');
  await page.goto(`/#/head-office/${packageId}`);
  await expect(page.getByRole('heading', { name: packageRef })).toBeVisible();

  await page.getByRole('button', { name: 'Start review' }).click();
  await expect(page.getByText('Review started. Check each document, then verify or ask for a correction.')).toBeVisible();

  // Click "Mark checked" one row at a time and wait for the save to land: each
  // PATCH bumps the package version (If-Match), so a click fired before the
  // previous response would be rejected with VERSION_CONFLICT.
  const checked = page.getByRole('button', { name: 'Mark checked' });
  let guard = 0;
  while (await checked.count()) {
    const before = await checked.count();
    await checked.first().click();
    await expect(checked).toHaveCount(before - 1, { timeout: 20_000 });
    if (++guard > 12) throw new Error('Document checks did not settle.');
  }
  expect(guard, 'six categories to check').toBe(6);

  // Private PDF viewer: same-origin iframe with the session cookie, never a public URL.
  await page.getByRole('button', { name: 'e2e-doc-0.pdf' }).click();
  const viewer = page.getByRole('dialog', { name: 'e2e-doc-0.pdf' });
  await expect(viewer).toBeVisible();
  await expect(viewer.locator('iframe[title="e2e-doc-0.pdf"]')).toBeVisible();
  await expect(viewer.getByRole('link', { name: 'Open in new tab' })).toBeVisible();
  await viewer.getByRole('button', { name: 'Close' }).click();

  await page.getByRole('button', { name: 'Verify documents' }).click();
  const verifyDialog = page.getByRole('dialog', { name: 'Verify this package?' });
  await expect(verifyDialog).toBeVisible();
  await verifyDialog.getByRole('button', { name: 'Verify documents' }).click();
  await expect(page.getByText('Documents verified. Update the DataMan milestones below as they happen.')).toBeVisible();

  await page.reload();
  await expect(page.getByText('Documents verified').first()).toBeVisible();
});

test('journey 8 — ERP milestones: confirm plant head approval, voucher, posting', async () => {
  const refs = [grnRef, uniqueRef('DEMO-VCH'), uniqueRef('DEMO-POST')];
  const fieldLabels = ['Approved GRN No.', 'Voucher No.', 'Posting Ref.'];
  const steps = [
    { role: 'gate_doc' as const, path: `/#/documents/${packageId}` },
    { role: 'ho' as const, path: `/#/head-office/${packageId}` },
    { role: 'head_accountant' as const, path: `/#/accounting/${packageId}` },
  ];
  for (let i = 0; i < 3; i++) {
    const page = await roles.page(steps[i]!.role);
    await page.goto(steps[i]!.path);
    await expect(page.getByRole('heading', { name: packageRef })).toBeVisible();
    await page.getByRole('button', { name: 'Confirm', exact: true }).first().click();
    const dialog = page.getByRole('dialog', { name: new RegExp(`Confirm:`) });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel(fieldLabels[i]).fill(refs[i]);
    // Milestone times must not predate the package either.
    const when = new Date(Date.now() - 10_000);
    const pad = (n: number) => String(n).padStart(2, '0');
    await dialog.getByLabel('When it happened in DataMan (IST)').fill(`${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}T${pad(when.getHours())}:${pad(when.getMinutes())}`);
    await dialog.getByLabel('I checked this in DataMan myself.').check();
    await dialog.getByRole('button', { name: 'Confirm milestone' }).click();
    // The dialog closes once the milestone is recorded; the row flips to Confirmed.
    await expect(page.getByRole('heading', { name: 'Confirm:' })).toBeHidden({ timeout: 20_000 });
    await page.waitForTimeout(300); // let the row state settle before the next confirm
  }

  // All three milestones confirmed — reload keeps the ERP state, and the milestones
  // overview lists the package.
  const page = await roles.page('ho');
  await page.goto(`/#/head-office/${packageId}`);
  await page.reload();
  await expect(page.getByText('Confirmed').first()).toBeVisible();
  await page.goto('/#/erp-milestones');
  await expect(page.getByRole('link', { name: packageRef }).or(page.getByText(packageRef)).first()).toBeVisible();
});
