/// <reference types="vite/client" />
interface ImportMetaEnv {
  /** mock (default) | http */
  readonly VITE_API_MODE?: string;
  /** Default "/api/v1" (same origin, via the dev proxy or nginx). */
  readonly VITE_API_BASE_URL?: string;
  /** demo | production. Default: demo for mock, production for http. */
  readonly VITE_APP_MODE?: string;
  /** Request timeout in ms (default 20000). */
  readonly VITE_API_TIMEOUT_MS?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
