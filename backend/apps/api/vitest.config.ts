import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC provides emitDecoratorMetadata for DI under Vitest (Nest + Vitest recipe).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts', 'test/**/*.e2e-spec.ts'],
    setupFiles: ['./test/setup-env.ts'],
    fileParallelism: false,
  },
  plugins: [swc.vite({ module: { type: 'es6' } })],
});
