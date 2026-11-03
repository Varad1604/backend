import { test, expect } from '@playwright/test';
import { USERS } from '../lib/env';

/**
 * Setup project: signs every demo user in through the REAL login form and verifies
 * the session cookie contract (brief §3) plus reload persistence, one user at a
 * time (parallel logins here raced each other into transient 401s). The journeys
 * themselves log in per context via helpers.loginContext (API request or this
 * run's cached session).
 */
test('login form works for every demo user (__Host- cookie contract)', async ({ page, context }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  for (const user of Object.values(USERS)) {
    await page.goto('/#/login');
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    // Demo chrome is present in APP_MODE=demo on both web origins.
    await expect(page.getByText('DEMO · sample data')).toBeVisible();

    await page.getByRole('textbox', { name: 'Username' }).fill(user.username);
    await page.getByRole('textbox', { name: 'Password' }).fill(user.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();

    // The signed-in identity shows in the header account menu.
    await expect(page.getByRole('button', { name: user.displayName })).toBeVisible();

    // Cookie contract: __Host-kpmpl_sid must be HttpOnly, Secure, SameSite=Lax, host-only.
    const cookie = (await context.cookies()).find((c) => c.name === '__Host-kpmpl_sid');
    expect(cookie, `session cookie set for ${user.username}`).toBeTruthy();
    expect(cookie!.httpOnly).toBe(true);
    expect(cookie!.secure).toBe(true);
    expect(cookie!.sameSite).toBe('Lax');
    expect(cookie!.domain).toBe('localhost'); // no Domain attribute → host-only

    // Reload persistence: the server session cookie alone restores the user.
    await page.reload();
    await expect(page.getByRole('button', { name: user.displayName })).toBeVisible();
    // Nothing sensitive lingers in JS storage (session lives in the cookie only).
    expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);

    // Sign out ends the session cleanly before the next user signs in.
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  }

  expect(errors, 'no page errors').toEqual([]);
});
