import { defineConfig } from 'vitest/config';

// Unit tests run in Node (fetch, FormData, File, Blob, AbortController are built in).
// They do not load vite.config.ts, so env validation and the dev proxy do not apply here.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    restoreMocks: true,
    clearMocks: true,
  },
});
