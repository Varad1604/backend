# Environments

## Preview (Cloudflare / Freebuff Sites)
- `kpmpl-api` Worker (portfolio): serves `apps/api` build on a per-isolate framework cache.
- `kpmpl-web-prod` Worker + `kpmpl-web` (dev) + nginx (prod-like): serves the built frontend.
- D1 `DB` (SQLite, `PUBLIC`-only schema; private tables use `private_` role policy).
- R2 `FILES` for uploaded documents.
- Realtime: isolated env.REALTIME Durable Object on `integration/phase-3-security` branch.

## Production publishing
- Both preview and production are published explicitly with sites_set_published.
- Do NOT deploy to Cloudflare through OpenNext directly; sites_deploy is the only path.

## Local open
- docker compose up -d --wait (postgres 55432 host, redis 6379, minio 9000/9001, clamav 3310, api 3000).
- API binds PORT=3000 by default; DB at postgresql://kpmpl:change-me@127.0.0.2:55432/kpmpl?schema=public.
- WEB_ORIGIN must contain http://localhost:5173 and http://localhost:8080 for CSR/CSRF probes to pass.
