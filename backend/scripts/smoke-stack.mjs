/* global process, fetch, AbortSignal, URL, console, setTimeout */
import assert from 'node:assert/strict';
const base = process.env.STACK_BASE_URL ?? 'http://127.0.0.1:18080';
const deadline = Date.now() + 60_000;
let lastError;
while (Date.now() < deadline) {
  try {
    const health = await fetch(base + '/api/v1/healthz', { signal: AbortSignal.timeout(3000) });
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: 'ok' });
    const ready = await fetch(base + '/api/v1/readyz', { signal: AbortSignal.timeout(3000) });
    assert.equal(ready.status, 200);
    assert.deepEqual(await ready.json(), { status: 'ok', checks: { database: 'up', redis: 'up' } });
    for (const route of ['/', '/receiving']) {
      const page = await fetch(base + route, { signal: AbortSignal.timeout(3000) });
      assert.equal(page.status, 200);
      assert.match(page.headers.get('content-type') ?? '', /text\/html/);
      const html = await page.text();
      assert.match(html, /<div id="root"><\/div>/);
      assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(page.headers.get('x-frame-options'), 'DENY');
      if (route === '/') {
        const assetPath = html.match(/src="([^"]+\.js)"/)?.[1];
        assert.ok(assetPath, 'Vite script asset must be present');
        const asset = await fetch(new URL(assetPath, base), { signal: AbortSignal.timeout(3000) });
        assert.equal(asset.status, 200);
        assert.match(asset.headers.get('content-type') ?? '', /javascript/);
      }
    }
    console.log('PASS: Caddy routes liveness, dependency readiness, SPA fallback and built assets.');
    process.exit(0);
  } catch (error) {
    lastError = error;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}
console.error('Stack smoke test failed:', lastError?.message);
process.exit(1);
