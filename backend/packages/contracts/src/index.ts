// @kpmpl/contracts - the only sanctioned way any client talks to the API.
// Types are GENERATED from openapi/openapi.yaml (contract-first, build prompt section 8).
// If a payload needs to change: change the yaml, regenerate, and both developers
// re-sign the snapshot (logged in 00_DOCUMENT_CONTROL.md).
import createFetchClient from 'openapi-fetch';
import type { paths } from './generated/schema';

export type { paths, components, operations } from './generated/schema';
export { default as createClient } from 'openapi-fetch';

/**
 * Create the typed API client used by web and (later) Android/iOS.
 * baseUrl defaults to the same-origin relative path served behind the reverse
 * proxy ('/api/v1'); override only for tests or tooling.
 */
export function createApiClient(baseUrl = '/api/v1') {
  return createFetchClient<paths>({ baseUrl });
}

export type ApiClient = ReturnType<typeof createApiClient>;
