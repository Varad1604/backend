import { describe, expect, it } from 'vitest';
import { parseConfig } from './configSchema';

describe('parseConfig', () => {
  it('defaults to mock + demo + /api/v1', () => {
    const { config, problems } = parseConfig({});
    expect(problems).toEqual([]);
    expect(config).toMatchObject({ apiMode: 'mock', appMode: 'demo', apiBaseUrl: '/api/v1', requestTimeoutMs: 20000 });
  });

  it('defaults app mode to production for http and strips a trailing slash', () => {
    const { config, problems } = parseConfig({ VITE_API_MODE: 'http', VITE_API_BASE_URL: '/api/v1/' });
    expect(problems).toEqual([]);
    expect(config.appMode).toBe('production');
    expect(config.apiBaseUrl).toBe('/api/v1');
  });

  it('allows http + demo (staging with the server demo seed)', () => {
    expect(parseConfig({ VITE_API_MODE: 'http', VITE_APP_MODE: 'demo' }).problems).toEqual([]);
  });

  it.each([
    [{ VITE_API_MODE: 'rest' }, /VITE_API_MODE/],
    [{ VITE_API_MODE: ' http' }, /VITE_API_MODE/],
    [{ VITE_APP_MODE: 'prod' }, /VITE_APP_MODE/],
    [{ VITE_APP_MODE: 'production' }, /requires VITE_API_MODE=http/],
    [{ VITE_API_BASE_URL: 'api/v1' }, /VITE_API_BASE_URL/],
    [{ VITE_API_MODE: 'http', VITE_API_BASE_URL: 'http://kpmpl.example.com/api/v1' }, /https in production/],
    [{ VITE_API_TIMEOUT_MS: '10' }, /VITE_API_TIMEOUT_MS/],
  ])('rejects %o', (env, re) => {
    const { problems } = parseConfig(env);
    expect(problems.join('\n')).toMatch(re);
  });

  it('accepts http://localhost in production for local integration', () => {
    expect(parseConfig({ VITE_API_MODE: 'http', VITE_API_BASE_URL: 'http://localhost:3000/api/v1' }).problems).toEqual([]);
  });
});
