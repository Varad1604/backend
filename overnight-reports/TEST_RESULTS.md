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

## Deployment + live-deployment verification (2026-11-03, ~22:45 local)
- `docker compose build migrate api` → both images rebuilt with the new code.
- `docker compose up -d migrate` → migration `20261103190000_accounting_roles_workflow` applied
  (additive only; no existing data touched) + idempotent demo seed: "7 users … 5 visits, 3 packages".
- `docker compose up -d api` (NO -v anywhere) → API healthy: /healthz ok; /readyz database=up, redis=up, storage=up (direct :3000 and via nginx :5173).
- All 7 demo accounts log in through the nginx proxy with the correct roles
  (demo-accountant → [accountant], demo-head-act → [head_accountant], plus the five original roles).
- `node overnight-reports/api-walk-accounting.mjs` (through nginx :5173, fresh package) →
  **ALL 26 CHECKS PASSED**: visit→package→PDF scan→verify→RBAC denials (403s)→accounting chain
  (with_accounting → with_head_accountant → accounting_approved → bill_posted)→corrections with
  before/after+reason→duplicate posting 422→history wording→HO ERP retention→PDF download→timeline.

## Browser E2E + Playwright (2026-11-03, ~23:00–23:15 local)
Interactive browser verification (ZCode in-app browser, headless-safe, http://localhost:5173 — the production-like nginx build):
- Login page renders; real logins for demo-accountant, demo-head-act, demo-ho, demo-admin (password read from backend .env at runtime, never printed or stored in reports).
- Accountant dashboard: role-specific job cards with live counts ("New from Head Office — 1 waiting").
- Accounting Queue: 5 stage tabs with counts; package rows with status/ref/stage.
- Full UI workflow on the user's own DEMO-PKG-0003 (their real test data, untouched by the seed):
  Start accounting → correct accountingRef (value + reason; correction row with was/now/reason/by/when) →
  Send to Head Accountant → (as Head Accountant) Approve with note → Post bill (billRef as typed) →
  status "Bill posted", terminal state, note distinguishing internal posting from DataMan milestones.
- HO: "With Accounts" inbox tab lists posted packages; package view shows the read-only accounting
  panel and RETAINS active DataMan milestone confirm buttons (internal ≠ external verified in UI).
- Admin: Users & Access shows all 7 accounts and the full 7-role × 18-capability matrix.
- Responsive: 375 px viewport — tabs scroll horizontally, tables scroll, header compacts (4 screenshots captured).
- Duplicate posting via UI: post button absent in terminal state (state machine guard verified in
  the API walk: second post → 422 DOMAIN_RULE).

Playwright suite (`npx playwright test --project=dev`, E2E_BASE_URL=http://localhost:5174, Vite dev
server in demo mode + proxy to the live API):
- **34 passed / 0 failed / 1 skipped** (the skipped item is conditional in the suite).
- One genuine test bug found and fixed on the way (`e2e/lib/helpers.ts`): the decision-success
  assertion expected "Accept with deduction" while the app renders the outcome label
  "Accepted with deduction" (decisionOutcomeLabel). The DB confirmed the decision itself had
  succeeded; only the assertion text was wrong.
- A transient login rate-limit (5/min per IP+username) affected one setup run after several
  consecutive full runs — resolved by the suite's own cooldown; noted as an operational characteristic.
- `WEB_ORIGIN` in backend/.env extended to include http://localhost:5174 for the E2E dev server
  (local demo config only; :5173 remains the primary origin).

## Final regression (2026-11-03, ~22:53 local)
- Backend `npx vitest run` (live deps): **60/60 passed**.
- Frontend `npx vitest run`: **82/82 passed**.
- Frontend `npm run build` (http mode): success; dist re-served by nginx on :5173 (verified 200).
