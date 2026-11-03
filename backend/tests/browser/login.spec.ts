import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
const accounts = JSON.parse(readFileSync('.demo-credentials.json', 'utf8')) as { employeeCode: string; fullName: string; password: string }[];
test('Gate user signs in, restores a rotated session after reload, and signs out', async ({ page, context }) => {
  const gate = accounts.find(account => account.employeeCode === 'DEMO-GATE')!;
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByLabel('Demo disclosure')).toContainText('Synthetic data');
  await page.getByLabel('Employee code').fill(gate.employeeCode);
  await page.getByLabel('Password').fill(gate.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: gate.fullName })).toBeVisible();
  expect((await context.cookies()).find(cookie => cookie.name === 'kpmpl_refresh')?.httpOnly).toBe(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: gate.fullName })).toBeVisible();
  // A second tab exercises shared cookies and cross-tab refresh serialization.
  const second = await context.newPage(); await second.goto('/');
  await expect(second.getByRole('heading', { name: gate.fullName })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await second.reload();
  await expect(second.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
});
test('narrow screen and failed login preserve an honest form state', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 }); await page.goto('/');
  await page.getByLabel('Employee code').fill('DEMO-GATE');
  await page.getByLabel('Password').fill('DEMO-deliberately-wrong');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Invalid credentials');
  await expect(page.getByLabel('Employee code')).toHaveValue('DEMO-GATE');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
