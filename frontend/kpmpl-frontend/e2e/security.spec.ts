import { test, expect } from '@playwright/test';
import { loginContext } from './lib/helpers';

/**
 * Rulebook Phase 3 items 4 and 10, browser side:
 *  - 4: the nginx CSP produces no console `securitypolicyviolation` events across
 *       the main pages, and the production origin sends the security headers;
 *  - 10: nothing is written to localStorage in http mode (the session is cookie-only).
 * The header assertions run on the prod-like origin (nginx); the Vite dev server
 * deliberately ships none of them.
 */
test.describe('SPA security headers and CSP', () => {
  let context: Awaited<ReturnType<typeof loginContext>>;
  test.beforeAll(async ({ browser }) => {
    context = await loginContext(browser, 'admin');
    // Collect CSP violations from every page this suite opens (rulebook item 4).
    await context.addInitScript(() => {
      const store = window as unknown as { __cspViolations: { directive: string; blocked: string }[] };
      store.__cspViolations = [];
      document.addEventListener('securitypolicyviolation', (event) => {
        store.__cspViolations.push({ directive: event.violatedDirective, blocked: event.blockedURL });
      });
    });
  });
  test.afterAll(async () => {
    await context?.close();
  });

  const pages = ['/#/overview', '/#/gate', '/#/receiving', '/#/qc', '/#/documents', '/#/head-office', '/#/erp-milestones', '/#/admin/users', '/#/account/password'];

  for (const path of pages) {
    test(`no CSP violations on ${path}`, async () => {
      const page = await context.newPage();
      await page.goto(path);
      await page.waitForTimeout(1_500); // let async data + any late violations land
      const violations = await page.evaluate(() => (window as unknown as { __cspViolations: unknown[] }).__cspViolations);
      expect(violations, JSON.stringify(violations)).toEqual([]);
      // Item 10: the http-mode session lives in the cookie only.
      expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
      await page.close();
    });
  }

  test('production origin sends the security headers (nginx)', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'prod-like', 'the Vite dev server ships no security headers');
    const response = await page.goto('/#/overview');
    expect(response).toBeTruthy();
    const headers = response!.headers();
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['strict-transport-security']).toMatch(/max-age=\d+/);
    expect(headers['content-security-policy']).toMatch(/default-src 'self'/);
  });
});
