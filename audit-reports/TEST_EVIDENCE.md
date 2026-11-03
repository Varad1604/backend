# KPMPL Audit — Test Evidence

Actual commands and actual outcomes from the 2026-11-03/04 audit cycle. Environment: Windows,
Git Bash, Docker Desktop. Where an env prefix is shown it is the host-side test environment
(`backend/.env` values with Docker-internal hosts remapped to 127.0.0.1, `REQUIRE_LIVE_DEPENDENCIES=true`).

## A. Initial independent audit (before fixes, git `b67df5c`)

| # | Command (where) | Outcome |
|---|---|---|
| A1 | `docker ps --format …` | 6/6 containers up/healthy |
| A2 | `curl http://localhost:5173/api/v1/healthz` + `/readyz` | ok / database+redis+storage up |
| A3 | served asset hash vs `frontend/kpmpl-frontend/dist/assets` | identical → served build == latest build |
| A4 | `psql -c "SELECT … FROM \"_prisma_migrations\""` | 13/13 applied |
| A5 | `psql -c "UPDATE \"AuditEvent\" …"` (rolled back) | blocked: `AuditEvent is append-only` (trigger, errcode 55000) |
| A6 | backend `npx tsc -p tsconfig.json --noEmit` (backend/apps/api) | pass |
| A7 | backend `npx vitest run` (live deps) | **60/60 passed** (13 files) |
| A8 | frontend `npx tsc --noEmit` ×2 | pass |
| A9 | frontend `npx eslint src` | 0 errors / 13 warnings (pre-existing) |
| A10 | frontend `npx vitest run` | **82/82 passed** |
| A11 | frontend `npm run build` | success (hash `index-CxmyRXVJ.js`) |
| A12 | `node audit-reports/role-permission-audit.mjs` (via nginx :5173) | 109/110 — the single "fail" was the audit script's own stale probe (reused unsafe ref hit DUPLICATE_CANDIDATE, itself evidence for KPMPL-001); expectations for S-1/S-2/S-3 corrected to the documented contract during the run |
| A13 | browser screenshots (login, accountant home/queue/package, dialog, gate, HO overview/inbox, admin users, QC queue; 1440/1024/768/390) | 9+ files in `audit-reports/screenshots/` |
| A14 | `curl -D` API + SPA headers | API: Helmet set present; SPA: none → KPMPL-003 |

## B. Fixes (KPMPL-001…003) and immediate verification

| # | Command (where) | Outcome |
|---|---|---|
| B1 | backend suite after charset fix + regression test | first run 60/61 — the new test's example ref collided with a search assertion; fixture renamed |
| B2 | backend `npx vitest run` (live deps) | **61/61 passed** (incl. "rejects characters outside the brief §3 safe charset… (KPMPL-001)") |
| B3 | frontend `tsc` ×2 + `vitest run` + `npm run build` (after types/page/mock/yaml changes; first typecheck caught the missing mock counter — fixed) | **82/82 passed**, build `index-Cfego8Ws.js` |
| B4 | served hash vs dist after rebuild | identical → nginx serving the fixed build |
| B5 | `docker compose build api && docker compose up -d api` (no -v) | image rebuilt, container restarted, `/readyz` green |
| B6 | `nginx -t` + `nginx -s reload` (kpmpl-local-web) | config valid, reloaded |
| B7 | `curl -D` SPA after hardening | `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Cache-Control: no-cache` present; API proxy 200 |

## C. Full re-audit (after fixes)

| # | Command (where) | Outcome |
|---|---|---|
| C1 | `node audit-reports/role-permission-audit.mjs` | **113/113 passed** — includes VAL-001 unsafe ref → 422 (fixed), VAL-001b control char → 422, and OVER-001…003 (new overview counters expose and count the accounting chain) |
| C2 | backend `npx vitest run` (live deps) | **61/61 passed** |
| C3 | frontend `npx vitest run` | **82/82 passed** |
| C4 | `E2E_BASE_URL=http://localhost:5174 npx playwright test --project=dev` (dev server + proxy to the live API) | **34 passed / 0 failed** (1 conditional skip for the prod-like-only header check) |
| C5 | browser re-audit screenshots (accounting queue at 1440/1024/768/390, gate follow-up at 390, overview with new counters) | `rea-*.png`, `overview-ho-fixed-1440.png` in `audit-reports/screenshots/` |
| C6 | readiness after redeploy | `/healthz` ok; `/readyz` database/redis/storage up |

## D. Audit scripts kept as evidence
- `audit-reports/role-permission-audit.mjs` — 113 live checks (auth, 7-role GET matrix, CSV, record visibility, forbidden writes, full workflow incl. the accounting chain, concurrency, duplicate posting, idempotent replay, stale version, validation, overview counters).
- `overnight-reports/api-walk-accounting.mjs` — the earlier 26-check deployment walk (still passing logic; superseded by the audit script for this cycle).
