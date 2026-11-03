/**
 * Pure runtime-config parser, shared by the app (src/config.ts) and the build
 * (vite.config.ts), so an invalid combination fails the build AND the page load.
 * No `import.meta` here: this file must also run in Node.
 */
export type ApiMode = 'mock' | 'http';
export type AppMode = 'demo' | 'production';

export interface RawEnv {
  VITE_API_MODE?: string;
  VITE_API_BASE_URL?: string;
  VITE_APP_MODE?: string;
  VITE_API_TIMEOUT_MS?: string;
}

export interface AppConfig {
  /** mock = synthetic in-browser adapter; http = real backend (brief §10). */
  apiMode: ApiMode;
  /** demo shows the demo strip, demo tools and demo account picker; production hides all of them. */
  appMode: AppMode;
  /** No trailing slash. Same-origin path ("/api/v1") or absolute https URL. */
  apiBaseUrl: string;
  /** Per-request timeout for JSON calls. Uploads get 6× this. */
  requestTimeoutMs: number;
  displayTimeZone: 'Asia/Kolkata';
}

export const DEFAULT_API_BASE_URL = '/api/v1';
export const DEFAULT_TIMEOUT_MS = 20_000;

export class ConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid frontend configuration:\n - ${problems.join('\n - ')}`);
    this.name = 'ConfigError';
  }
}

const blank = (v: string | undefined) => v === undefined || v.trim() === '';

/**
 * Parse and validate. Returns the config plus every problem found (empty = valid).
 * Defaults: API mode `mock`; app mode `demo` for mock and `production` for http.
 */
export function parseConfig(env: RawEnv): { config: AppConfig; problems: string[] } {
  const problems: string[] = [];

  const rawApi = blank(env.VITE_API_MODE) ? 'mock' : env.VITE_API_MODE!;
  if (rawApi !== 'mock' && rawApi !== 'http') problems.push(`VITE_API_MODE must be "mock" or "http" (got "${rawApi}").`);
  const apiMode: ApiMode = rawApi === 'http' ? 'http' : 'mock';

  const rawApp = blank(env.VITE_APP_MODE) ? (apiMode === 'http' ? 'production' : 'demo') : env.VITE_APP_MODE!.trim();
  if (rawApp !== 'demo' && rawApp !== 'production') problems.push(`VITE_APP_MODE must be "demo" or "production" (got "${rawApp}").`);
  const appMode: AppMode = rawApp === 'production' ? 'production' : 'demo';

  if (apiMode === 'mock' && appMode === 'production') {
    problems.push('VITE_APP_MODE=production requires VITE_API_MODE=http. The mock adapter keeps data in the browser and is for demos only.');
  }

  let apiBaseUrl = blank(env.VITE_API_BASE_URL) ? DEFAULT_API_BASE_URL : env.VITE_API_BASE_URL!.trim();
  apiBaseUrl = apiBaseUrl.replace(/\/+$/, '');
  if (!/^\//.test(apiBaseUrl) && !/^https?:\/\/[^\s/]+/.test(apiBaseUrl)) {
    problems.push(`VITE_API_BASE_URL must be a path starting with "/" or an http(s) URL (got "${apiBaseUrl}").`);
  }
  if (appMode === 'production' && /^http:\/\//.test(apiBaseUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(apiBaseUrl + '/')) {
    problems.push('VITE_API_BASE_URL must use https in production (session cookies are __Host- and Secure).');
  }

  let requestTimeoutMs = DEFAULT_TIMEOUT_MS;
  if (!blank(env.VITE_API_TIMEOUT_MS)) {
    const n = Number(env.VITE_API_TIMEOUT_MS);
    if (!Number.isInteger(n) || n < 1000 || n > 300_000) problems.push(`VITE_API_TIMEOUT_MS must be an integer between 1000 and 300000 (got "${env.VITE_API_TIMEOUT_MS}").`);
    else requestTimeoutMs = n;
  }

  return { config: { apiMode, appMode, apiBaseUrl, requestTimeoutMs, displayTimeZone: 'Asia/Kolkata' }, problems };
}
