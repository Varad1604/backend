# Test Results Log

Actual commands + actual outcomes. Never claim a pass without the output logged here.

## Milestone 0 — baseline state checks (2026-11-03)
- `docker ps` → 6 containers up & healthy (web, api, postgres, redis, minio, clamav).
- `curl http://localhost:3000/api/v1/healthz` → `{"status":"ok"}`
- `curl http://localhost:5173` → 200; `curl http://localhost:5173/api/v1/healthz` → `{"status":"ok"}` (proxy OK).
- `git init` + baseline commit (261 files, `.env*` excluded — verified via `git ls-files`).

(more appended per milestone)

## Backend accounting milestone (2026-11-03, ~22:10 local)
Commands run from `backend/` with host-corrected env
(`DATABASE_URL`→127.0.0.1, `REDIS_URL`=redis://127.0.0.1:6379, `S3_ENDPOINT`→127.0.0.1, `CLAMAV_HOST`=127.0.0.1, `REQUIRE_LIVE_DEPENDENCIES=true`):

- `npx tsc -p tsconfig.json --noEmit` (apps/api) → exit 0.
- `npx eslint apps/api/src apps/api/test` → 0 problems.
- `npx nest build` → success.
- `npx vitest run` (apps/api, live deps) → **13 files / 60 tests passed, 0 failed, 0 skipped.**
  Includes the new `test/accounting.e2e-spec.ts` (full HO→Accountant→Head Accountant→Bill Posted
  workflow: RBAC denials, state machine, duplicate-posting guard, corrections with before/after +
  reason, audit/history wording, HO ERP retention after handoff, PDF access, idempotent replay).
- Note: e2e specs create an ISOLATED temporary schema per run (`ac_<uuid>`, `p3_<uuid>`, …) and
  DROP it afterwards — no shared data touched.

## Frontend accounting milestone (2026-11-03, ~22:35 local)
Run in `frontend/kpmpl-frontend/`:
- `npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p tsconfig.node.json` → exit 0.
- `npx eslint src` → 0 errors (13 pre-existing react-refresh warnings, same class as before).
- `npx vitest run` → **82 tests passed** (incl. new `src/api/mock/accounting.test.ts`: the full
  accounting workflow against the mock adapter — capability denials, state machine, reasons,
  duplicate-posting guard, audit wording; plus updated contract/role snapshot tests).
- `npm run build` (typecheck + vite build, `.env.production.local` = `VITE_API_MODE=http`,
  `VITE_API_BASE_URL=/api/v1`) → success; `dist/` refreshed (nginx bind-mounts it on :5173).
- Contract snapshot `src/api/contract/openapi.yaml` → 1.2.0: new roles, new package states,
  AccountingInfo/AccountingAction schemas, /accounting/queue + /document-packages/{id}/accounting.
