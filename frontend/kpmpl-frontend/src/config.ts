import { parseConfig, type AppConfig } from './configSchema';

/**
 * Runtime configuration from Vite env (build-time). Validated once; `main.tsx` refuses to
 * render the app and shows the problems if anything is invalid (fail loudly, never guess).
 * The build (vite.config.ts) runs the same validation and fails first.
 */
const parsed = parseConfig({
  VITE_API_MODE: import.meta.env.VITE_API_MODE,
  VITE_API_BASE_URL: import.meta.env.VITE_API_BASE_URL,
  VITE_APP_MODE: import.meta.env.VITE_APP_MODE,
  VITE_API_TIMEOUT_MS: import.meta.env.VITE_API_TIMEOUT_MS,
});

/** Problems found at startup; non-empty means the app must not run. */
export const configProblems: readonly string[] = parsed.problems;

export const config: AppConfig & {
  /** Demo strip, demo account picker and demo wording are shown (APP_MODE=demo). */
  readonly isDemo: boolean;
  /** Browser-only synthetic adapter is active (API_MODE=mock); enables Demo tools. */
  readonly isMock: boolean;
} = {
  ...parsed.config,
  isDemo: parsed.config.appMode === 'demo',
  isMock: parsed.config.apiMode === 'mock',
};
