import type { ReceivingApi } from './ReceivingApi';
import { mockAdapter } from './mock/mockAdapter';
import { httpAdapter } from './http/httpAdapter';

/**
 * Single switch point between synthetic data and the real backend (VITE_API_MODE).
 * The comparison is on the raw env value so Vite inlines it and Rollup drops the unused
 * adapter: an http build contains no mock adapter or demo fixtures. Validation of the
 * value itself happens in configSchema.ts (build and startup).
 */
export const api: ReceivingApi = import.meta.env.VITE_API_MODE === 'http' ? httpAdapter : mockAdapter;
export { ApiError, describeError, toApiError } from './errors';
export type { ReceivingApi, CsvExport } from './ReceivingApi';
