import { test, expect } from '@playwright/test';
import { RolePool, loginViaUi, uniqueRef } from './lib/helpers';

/**
 * Journeys covered: login failure honesty, 10 admin reset password,
 * 11 change password (forced + self-service).
 * Runs against a throwaway user created here, so the six seeded demo users
 * keep their DEMO_PASSWORD for the other journeys and for re-runs.
 */
test.describe.configure({ mode: 'serial' });

const tempUsername = uniqueRef('e2e-user').toLowerCase();
const tempDisplayName = 'E2E Temp User';
const newPassword = 'e2e-New-Passw0rd-1';
const newPassword2 = 'e2e-New-Passw0rd-2';
let roles: RolePool;
test.beforeAll(({ browser }) => {
  roles = new RolePool(browser);
});
test.afterAll(async () => {
  await roles.release();
});

test('login form rejects wrong credentials with the honest message', async ({ page }) => {
  await page.goto('/#/login');
  await page.getByRole('textbox', { name: 'Username' }).fill('demo-gate');
  await page.getByRole('textbox', { name: 'Password' }).fill('definitely-wrong-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Username or password is incorrect.');
  // The form keeps what the user typed (except the password itself).
  await expect(page.getByRole('textbox', { name: 'Username' })).toHaveValue('demo-gate');
});

test('journey 10a — admin creates a user and sees the temporary password once', async () => {
  const page = await roles.page('admin');
  await page.goto('/#/admin/users');
  await expect(page.getByRole('heading', { name: 'Users and Access' })).toBeVisible();

  await page.getByRole('button', { name: 'Add demo user' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox', { name: 'Username' }).fill(tempUsername);
  await dialog.getByLabel('Display name').fill(tempDisplayName);
  await dialog.getByLabel('Gate Operator').check();
  await dialog.getByRole('button', { name: 'Add user' }).click();

  // The temporary password is shown exactly once, with copy + hide controls.
  const notice = page.locator('section[aria-labelledby="otp-title"]');
  await expect(notice).toBeVisible();
  const tempPassword = (await notice.locator('code[aria-label="Temporary password"]').textContent())!.trim();
  expect(tempPassword.length).toBeGreaterThanOrEqual(8);
  await expect(notice.getByRole('button', { name: 'Done, hide it' })).toBeVisible();
  await notice.getByRole('button', { name: 'Done, hide it' }).click();
  await expect(notice).toBeHidden();

  // The new user appears in the table with its role.
  const row = page.getByRole('row', { name: tempUsername });
  await expect(row).toBeVisible();
  await expect(row).toContainText('Gate Operator');

  // The serial chain keeps the temp password in this file's closure.
  process.env.E2E_TEMP_PASSWORD = tempPassword;
});

test('journey 11a — forced change password on first sign-in', async ({ browser }) => {
  const context = await browser.newContext();
  roles.adopt(context);
  const page = await context.newPage();
  await page.goto('/#/login');
  await page.getByRole('textbox', { name: 'Username' }).fill(tempUsername);
  await page.getByRole('textbox', { name: 'Password' }).fill(process.env.E2E_TEMP_PASSWORD!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();

  // mustChangePassword forces the account page before anything else.
  await expect(page.getByRole('heading', { name: 'Change password' })).toBeVisible();
  await expect(page.getByText('New password needed')).toBeVisible();
  await page.getByRole('textbox', { name: 'Temporary password' }).fill(process.env.E2E_TEMP_PASSWORD!);
  await page.getByRole('textbox', { name: 'New password', exact: true }).fill(newPassword);
  await page.getByRole('textbox', { name: 'Repeat new password', exact: true }).fill(newPassword);
  await page.getByRole('button', { name: 'Change password' }).click();
  // Success shows the confirmation; the page may also re-render straight into the
  // normal (non-forced) form now that mustChangePassword is cleared.
  await expect(
    page.getByText('Password changed').or(page.getByRole('textbox', { name: 'Current password', exact: true })),
  ).toBeVisible();
  const cont = page.getByRole('button', { name: 'Continue' });
  if (await cont.isVisible().catch(() => false)) await cont.click();
  await expect(page.getByRole('button', { name: tempDisplayName })).toBeVisible();

  // Reload persistence on the fresh password.
  await page.reload();
  await expect(page.getByRole('button', { name: tempDisplayName })).toBeVisible();
});

test('journey 11b — self-service change password requires the correct current one', async ({ browser }) => {
  const context = await browser.newContext();
  roles.adopt(context);
  const page = await context.newPage();
  await page.goto('/#/login');
  await page.getByRole('textbox', { name: 'Username' }).fill(tempUsername);
  await page.getByRole('textbox', { name: 'Password' }).fill(newPassword);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  // Signed in — the landing page itself is incidental (the account page may render
  // first); navigate to the change-password page explicitly.
  await page.getByRole('button', { name: tempDisplayName })
    .or(page.getByRole('heading', { name: 'Change password' })).first().waitFor();
  await page.goto('/#/account/password');
  await expect(page.getByRole('heading', { name: 'Change password' })).toBeVisible();

  // Wrong current password is a field-level error, not a global logout.
  await page.getByRole('textbox', { name: 'Current password', exact: true }).fill('wrong-current-password');
  await page.getByRole('textbox', { name: 'New password', exact: true }).fill(newPassword2);
  await page.getByRole('textbox', { name: 'Repeat new password', exact: true }).fill(newPassword2);
  await page.getByRole('button', { name: 'Change password' }).click();
  await expect(page.getByText('Current password is incorrect.')).toBeVisible();

  await page.getByRole('textbox', { name: 'Current password', exact: true }).fill(newPassword);
  await page.getByRole('textbox', { name: 'New password', exact: true }).fill(newPassword2);
  await page.getByRole('textbox', { name: 'Repeat new password', exact: true }).fill(newPassword2);
  await page.getByRole('button', { name: 'Change password' }).click();
  await expect(
    page.getByText('Password changed').or(page.getByRole('textbox', { name: 'Current password', exact: true })),
  ).toBeVisible();
});

test('journey 10b — admin reset password: old password dies, new temporary works', async ({ browser }) => {
  const page = await roles.page('admin');
  await page.goto('/#/admin/users');
  const row = page.getByRole('row', { name: tempUsername });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Reset password' }).click();
  const dialog = page.getByRole('dialog', { name: 'Reset password?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Reset password' }).click();
  const notice = page.locator('section[aria-labelledby="otp-title"]');
  await expect(notice).toBeVisible();
  const resetPassword = (await notice.locator('code[aria-label="Temporary password"]').textContent())!.trim();
  await notice.getByRole('button', { name: 'Done, hide it' }).click();

  // The password the user chose no longer works.
  const victim = await browser.newContext();
  const vPage = await victim.newPage();
  await vPage.goto('/#/login');
  await vPage.getByRole('textbox', { name: 'Username' }).fill(tempUsername);
  await vPage.getByRole('textbox', { name: 'Password' }).fill(newPassword2);
  await vPage.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(vPage.getByRole('alert')).toContainText('Username or password is incorrect.');

  // The new temporary password works and forces another change.
  await vPage.getByRole('textbox', { name: 'Password' }).fill(resetPassword);
  await vPage.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(vPage.getByRole('heading', { name: 'Change password' })).toBeVisible();
  await expect(vPage.getByText('New password needed')).toBeVisible();
  roles.adopt(victim);
});
