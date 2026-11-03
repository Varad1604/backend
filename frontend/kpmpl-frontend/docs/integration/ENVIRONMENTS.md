# Environments (frontend)

## Backend API
- `apps/api` builds → portfolio Worker on the per-isolate framework cache.
- DB: D1 `DB` (SQLite `PUBLIC`-only; private tables via `private_` role policy).
- R2 `FILES` for uploaded documents.

## Frontend
- Dev: `vite` on http://localhost:5173 (or Vite's `--host` profile).
- Prod-like: `nginx` served on http://localhost:8080, same CSP/headers as production.
- E2E: Playwright 14+ with setup/dev/prod-like projects; `E2E_BASE_URL` controls the origin.

## Publish
- Frontend: build output (`dist/`) + `playwright.config.ts` through the Sites deployer.
- No separate static host; the Worker serves env.ASSETS.
