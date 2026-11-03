import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { ConfigError, parseConfig } from './src/configSchema';

// `--mode singlefile` produces one self-contained index.html used only for the
// private review preview (always mock + demo). Normal `npm run build` produces a standard dist/.
export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const { config, problems } = parseConfig(env);
  // Fail the build (and the dev server) on an invalid env, before any bundle is produced.
  if (problems.length) throw new ConfigError(problems);
  if (mode === 'singlefile' && config.apiMode !== 'mock') {
    throw new ConfigError(['The single-file preview is mock-only. Unset VITE_API_MODE for build:preview.']);
  }
  if (command === 'build') {
     
    console.log(`[kpmpl] build config: API_MODE=${config.apiMode} APP_MODE=${config.appMode} API_BASE_URL=${config.apiBaseUrl}`);
  }

  // Dev proxy: the browser talks to the Vite origin only, so the backend's session cookie
  // (__Host-kpmpl_sid, SameSite=Lax) is first-party and CORS is not involved in development.
  const proxyTarget = env.VITE_PROXY_TARGET || 'http://localhost:3000';

  return {
    plugins: [react(), tailwindcss(), ...(mode === 'singlefile' ? [viteSingleFile()] : [])],
    server: {
      port: 5173,
      host: true,
      proxy: {
        '/api': { target: proxyTarget, changeOrigin: false, secure: false, xfwd: true },
      },
      // Watch only what HMR needs. On the integration compose stack the repo is a
      // Windows bind mount; letting the watcher scan build output and Playwright
      // results exhausts inotify/memory (ENOMEM) and kills the dev server.
      watch: {
        ignored: ['**/dist/**', '**/node_modules/**', '**/test-results/**', '**/playwright-report/**', '**/coverage/**'],
      },
    },
    preview: {
      port: 4173,
      proxy: { '/api': { target: proxyTarget, changeOrigin: false, secure: false, xfwd: true } },
    },
    // The review host cannot load ES modules, so the single-file preview is a classic IIFE script.
    build:
      mode === 'singlefile'
        ? {
            modulePreload: false,
            // Fonts (IBM Plex, latin woff2) must be base64-inlined: the host blocks external requests.
            assetsInlineLimit: 100_000_000,
            rollupOptions: { output: { format: 'iife' as const, inlineDynamicImports: true } },
          }
        : { sourcemap: false },
  };
});
