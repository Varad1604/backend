import { test, expect } from '@playwright/test';
import { RolePool } from './lib/helpers';

/**
 * Journey 13 — cross-role visibility on the seeded fixture DEMO-GATE-0001
 * (submitted QC, exited, GRN recorded) and its package DEMO-PKG-0001.
 * Read-only: every role sees what the capability matrix says it may see,
 * and is refused what it may not. Roles are taken one at a time (RolePool):
 * the backend keeps a global five-session limit.
 */
let roles: RolePool;
test.beforeAll(({ browser }) => {
  roles = new RolePool(browser);
});
test.afterAll(async () => {
  await roles.release();
});

test('gate sees the full journey of DEMO-GATE-0001 including QC readings', async () => {
  const page = await roles.page('gate');
  await page.goto('/#/receiving');
  await page.getByLabel('Search by Gate Entry No., vehicle or supplier').fill('DEMO-GATE-0001');
  await page.getByRole('link', { name: 'DEMO-GATE-0001' }).click();
  await expect(page.getByRole('heading', { name: 'DEMO-GATE-0001' })).toBeVisible();
  await expect(page.getByText('Exited').first()).toBeVisible();
  await expect(page.getByText('GRN recorded').first()).toBeVisible();
  await expect(page.getByText('Accepted').first().or(page.getByText('QC submitted').first())).toBeVisible();
  await expect(page.getByRole('heading', { name: 'QC readings' })).toBeVisible();
  await expect(page.getByText('9.20').first()).toBeVisible(); // seeded moisture
  await expect(page.getByText('9500.000').first()).toBeVisible(); // net = 15000 - 5500 (display only)
  // Gate may correct details while on premises; 0001 has exited, so it is locked.
  expect(await page.getByRole('button', { name: 'Correct details' }).count()).toBe(0);
});

test('QC operator sees the submitted readings but no admin pages', async () => {
  const context = await roles.context('qc');
  const page = await context.newPage();
  await page.goto('/#/receiving');
  await page.getByLabel('Search by Gate Entry No., vehicle or supplier').fill('DEMO-GATE-0001');
  await page.getByRole('link', { name: 'DEMO-GATE-0001' }).click();
  await expect(page.getByRole('heading', { name: 'DEMO-GATE-0001' })).toBeVisible();
  await expect(page.getByText('9.20')).toBeVisible();

  const forbidden = await context.newPage();
  await forbidden.goto('/#/admin/users');
  // RequireCap redirects unauthorised roles to the landing page (no ERP/admin content);
  // real access control is the backend capability matrix.
  await expect(forbidden).toHaveURL(/#\/home/);
  await expect(forbidden.getByRole('heading', { name: 'Users' })).toHaveCount(0);
});

test('HO sees the seeded package with its documents; QC cannot', async () => {
  const page = await roles.page('ho');
  await page.goto('/#/head-office');
  await expect(page.getByRole('heading', { name: 'Head Office Inbox' })).toBeVisible();
  await page.getByRole('tab', { name: 'Under review' }).click();
  const row = page.getByRole('link', { name: 'DEMO-PKG-0001' }).first();
  await expect(row).toBeVisible();
  await row.click();
  await expect(page.getByRole('heading', { name: 'DEMO-PKG-0001' })).toBeVisible();
  await expect(page.getByText('DEMO-INV-0101.pdf').first()).toBeVisible();

  const qcPage = await roles.page('qc');
  await qcPage.goto('/#/documents');
  await expect(qcPage).toHaveURL(/#\/home/);
  await expect(qcPage.getByRole('heading', { name: 'Document Packages' })).toHaveCount(0);
});

test('admin sees the operations overview with live counters', async () => {
  const page = await roles.page('admin');
  await page.goto('/#/overview');
  await expect(page.getByRole('heading', { name: 'Operations Overview' })).toBeVisible();
  await expect(page.getByText('Trucks on premises').first()).toBeVisible();
  await expect(page.getByText('With Head Office').first()).toBeVisible();
});
