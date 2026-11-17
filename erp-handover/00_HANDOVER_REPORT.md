# KPMPL DataMan ERP Weight-Mapping Correction — Handover & Sign-off

Date: 2026-11-17 · Session: KPMPL DataMan ERP Weight-Mapping Correction Sign-off
Takeover from: Freebuff (uncommitted workspace work dated 2026-11-16 18:43 → 2026-11-17 18:55)
Scope: complete, independently verify, and sign off the read-only DataMan ERP weight-mapping
correction across backend, frontend, tests and local runtime — preserving all valid prior work.

---

## 1. What was inherited (verified, preserved as-is)

Freebuff's uncommitted work implements the read-only ERP feature end to end and was
**preserved without rework**:

- **Backend**: `backend/apps/api/src/modules/erp-sql-server/` — NestJS module with a
  read-only mssql adapter (bounded pool, top-level pool/timeout config for mssql@12,
  TDS 7.4, TLS always on), a controller with two endpoints (`GET /erp/gate-entries`,
  `GET /erp/gate-entries/:docId`) that map **verified DataMan columns only**
  (`Weightment.Actual_GWeight` / `Tare_Weight` / `Net_Weight`, Decimal(12,3) kg),
  stringified verbatim and never recomputed; fail-closed local-test certificate
  exception (`NODE_ENV=development` + exact host + exact `true` opt-in, loudly refused
  otherwise); 3 spec files (service/pool config, controller contract incl. SQL
  parameter binding + "never an invented unit", parameter descriptor resolution).
- **RBAC**: `erp.read` capability added to the `ho` role in backend `policy.ts` + seeded
  role matrix; `erp.final_posting` stays Head-Accountant-only (`policy.spec.ts` pins it).
- **Contract**: `/erp/gate-entries` + `/erp/gate-entries/{docId}` added to both OpenAPI
  copies; ERP_UNAVAILABLE error code; frontend `contract.test.ts` pins 42 paths + ERP
  fixtures validate as `ErpGateEntry/ErpWeighment/ErpGrn` with kg-only weights.
- **Frontend**: `features/erp/` (list + detail pages, outage ≠ empty-list rules,
  kg-only display, fieldsAvailable discipline), routes `/erp/gate-entries[/ :docId]`
  behind `RequireCap erp.read`, `erp.read` in `ho` grants, home card, httpAdapter +
  mock adapter ERP reads with parity tests, domain types, Playwright spec.
- **Infra**: `mssql@12.7.14` + `@nestjs/config` deps, docker-compose housekeeping
  (postgres host port 55432→5432, matching the running stack), `.env.example` ERP block.

## 2. Defects found during takeover and fixed

| # | Defect | Fix |
|---|---|---|
| D-1 | Frontend `ho` role was granted `erp.final_posting`, breaking parity with the backend matrix (backend `policy.spec.ts:53` asserts `ho` must NOT hold it) | Removed from `frontend/kpmpl-frontend/src/auth/permissions.ts` `ho` grants |
| D-2 | 4 eslint errors in `src/api/mock/erp.test.ts` (implicit-`any` catch) aborted the frontend CI chain before tests/build | Typed the catch as `unknown` and narrowed to `ApiError` |
| D-3 | e2e `USERS` map missing the accounting demo users (`accountant`, `head_accountant` — seeded since 2026-11-03); journey 8 died with `TypeError: reading 'username'` and journeys 8–10 never ran | Added both users to `e2e/lib/env.ts` |
| D-4 | Stale e2e assertions predating the v0.8.3+ guard/UI behavior (pre-existing drift, not a Freebuff regression): visibility.spec expected a "You do not have access" alert (guard now redirects to home); golden-path journey 5 expected an "Invoice <ref>" label the current UI does not render | Updated the 3 stale assertions to the shipped behavior (denial still enforced — the backend matrix covers it; the ERP spec documents the redirect convention) |
| D-5 | Environment: stale Freebuff processes occupied :3000 (API, build predating final sources) and :5173 (`VITE_APP_MODE=production` Vite on `::1`, which broke the Playwright setup's demo-chrome assertion) | Killed both; fresh API (current dist) + fresh Vite (demo mode) verified |

## 3. Verification (all evidence reproduced, not inherited)

### 3.1 Quality gates

| Gate | Command | Result |
|---|---|---|
| Backend typecheck | `pnpm typecheck` (tsc --noEmit) | EXIT=0 |
| Backend build | `pnpm build` (nest build) | EXIT=0 |
| Backend tests | `pnpm vitest run` (live deps: Postgres 5432, Redis, MinIO, ClamAV) | **18 files / 106 tests passed, 0 failed, 0 skipped** (91.7s) |
| Frontend typecheck | `npm run ci` → tsc ×2 | PASS |
| Frontend lint | `eslint .` | **0 errors** (2 pre-existing warnings) |
| Frontend tests | `npm run ci` → vitest | **9 files / 118 tests passed** |
| Frontend build | `npm run ci` → vite build | PASS (dist emitted) |
| e2e ERP spec | `npx playwright test --project=dev e2e/erp-gate-entries.spec.ts` | **5/5 passed** |
| e2e full suite | `npx playwright test --project=dev` | **39/39 passed** (2.1m) — was 33 passed + 3 stale failures + skipped journeys before the D-3/D-4 fixes |

### 3.2 Live runtime — default posture (no ERP credentials configured)

`node tmp/erp-fixture/checks-default.mjs` → **15/15 PASSED**, twice (before and after the
fixture phase):

- unauthenticated `/erp/*` → 401; `gate`/`admin` (no `erp.read`) → 403 (refused before any
  ERP call); `ho` → 503 with the standard envelope (`code: ERP_UNAVAILABLE`, human message,
  `meta.retryable: true`, `requestId` present) — never an empty 200, and the detail endpoint
  reports 503 (not a fake 404) while the ERP is unreachable;
- `GET /receiving-visits` stays 200 — KPMPL workflows do not cascade;
- API boot log confirms: `ERP configuration incomplete — no connection attempt made;
  /erp/* will return 503 ERP_UNAVAILABLE` (no unauthenticated login attempts at the ERP).

### 3.3 Live runtime — real ERP data (local SQL Server fixture, safely)

**Why a fixture**: the live DataMan (ERP_HOST 192.168.1.200) is on the mill LAN and must not
be contacted (AGENTS.md). A local SQL Server 2022 container (`kpmpl-erp-fixture`,
loopback-only `127.0.0.1:14330`) recreates the verified DataMan tables (`GateInOut`,
`Weightment`, `PChallan`, Decimal(12,3) kg) with rows designed to exercise every
weight-mapping rule. **TLS is fully validated**: a throwaway local CA + server cert
(SAN 127.0.0.1) is served by SQL Server (`network.tlscert`/`network.tlskey`) and trusted by
the API via `NODE_EXTRA_CA_CERTS`; `trustServerCertificate` stayed **false** end to end and
the guarded untrusted-cert exception was never used (its loud refusal path was even
exercised live: `ERP_LOCAL_TEST_ALLOW_UNTRUSTED_CERT="false" … ignored; certificate
validation stays enforced`). The ERP login `pravahax_readonly` is db_datareader-only —
**INSERT correctly DENIED at the database** (asserted by setup).

`node tmp/erp-fixture/checks-fixture.mjs` → **31/31 PASSED**, including:

- weights arrive as the driver's values, unit `kg`, and the word "tons" appears nowhere;
- **never-recomputed proof**: gate entry 1005 has gross 10000 / tare 3000 / net **7050.5** —
  the API returns 7050.5, not 7000 (a recomputed value);
- null-vs-zero semantics: entry 1003 (no weighment) → null weights + `hasWeighment:false`;
  entry 1006 (nulls *inside* a weighment row) → null fields, never zeros; `fieldsAvailable`
  lists exactly what ERP returned;
- aggregation: entry 1004 (2 weighments + 2 GRNs) collapses to one list row (first row per
  ORDER BY) and the detail returns both weighments (slip numbers, ordered by Weigh_Date)
  and both GRNs (ordered by GRN_Date, APPROVED → REJECTED);
- server-side pagination (limit 3 → totalPages 3, page 2 shifts without duplicates);
  exact `docId` filter; `vType=PCHLG` returns 3 gate entries (EXISTS-based — 1004's two
  PChallan rows count once; 1007 with `V_Type` GIN excluded);
- unknown DocId → 404 `NOT_FOUND` (distinguished from outage) while the ERP is reachable;
  RBAC (401/403) enforced against the real adapter; `/receiving-visits` unaffected.

Browser evidence (`erp-handover/screenshots/`): the real-data list page, the 1004 detail,
and the post-teardown outage alert — all on the served frontend.

### 3.4 Runtime state left behind

- Infra containers untouched and healthy: postgres (5432), redis, minio, clamav.
- **API runs on the host** (`node dist/main.js` on :3000, default 503 posture). Reason:
  `docker compose build` fails inside BuildKit on this machine with `EAI_AGAIN
  registry.npmjs.org` (4 attempts: default builder ×2, `--network=host` ×1,
  docker-container builder ×1 — plain `docker run` DNS verified OK in the same window,
  and `pnpm typecheck`+`pnpm build` pass on the host). This is an environmental blocker,
  documented with the reproducible command in TEST_EVIDENCE.md. The committed Dockerfile
  is unchanged; the host build proves the same compile path green.
- **Web**: `kpmpl-local-web` (nginx:alpine) recreated on :5173, bind-mounting the durable
  `nginx-local.conf` (no more %TEMP% copy to keep in sync) and the fresh dist (demo-mode
  build), with `--add-host api:host-gateway` so `/api/` proxies to the host API.
- Sessions survive API restarts (Redis-backed) — verified in the browser.

## 4. Acceptance criteria audit

| Criterion | Evidence |
|---|---|
| Read-only ERP access, verified columns only | Controller tests pin the SQL (`queries only verified DataMan columns`); fixture `pravahax_readonly` INSERT denied at the DB |
| Weight mapping: kg, verbatim, never recomputed | 31/31 fixture checks incl. the 7050.5 ≠ 7000 proof; unit pins (`"unit":"kg"`, no "tons") |
| Outage honesty (503 ≠ empty list ≠ fake 404) | 15/15 default-posture checks + Playwright outage spec + browser screenshot |
| RBAC `erp.read` end to end | Backend matrix e2e (106/106) + live 401/403 probes + route guards |
| Frontend parity (mock/live) | contract.test (42 paths, kg fixtures), mock ERP tests, httpAdapter tests |
| Existing workflows preserved | Backend 106/106, frontend 118/118, e2e 39/39, `/receiving-visits` 200 during both ERP postures |
| No live DataMan contact, no deploy, no destructive ops | Fixture is loopback-only; no compose down/-v; no migrations; no restarts of user services (two stale dev processes from the prior agent were replaced — documented) |

## 5. Known observations (out of scope, documented for the next cycle)

1. `backend/packages/contracts/openapi.yaml` still lacks the v0.8.5-era accounting routes
   (`/accounting/queue`, plant-head-approval, `record_amounts`, `IDEMPOTENCY_IN_PROGRESS`)
   that the frontend copy has — pre-existing drift from the v0.8.5 run (B-20 synced only the
   frontend copy). Both copies DO contain the new `/erp` paths.
2. tedious (mssql@12) delivers Decimal(12,3) as JS numbers, so the DTO strings carry the
   driver's formatting (`12500.5`, not `12500.500`). The contract "stringified verbatim,
   never recomputed" is met; formatting to fixed 3 decimals would be a product decision.
3. `backend/apps/api/src/config/env.ts` declares ERP_* zod vars that are not folded into the
   main schema (harmless — the service reads ConfigService/process.env directly; the file
   also lost its trailing newline). Cosmetic cleanup candidate.
4. `tmp/emit-dist.mjs` (Freebuff, 18:39) is an abandoned broken script (references
   `readdirSync` without importing it, copies `.ts` to dist); it is not used by anything and
   was left in place (tmp/ is untracked).
5. The `.env.production.local` dist used for the review host is a demo-mode build
   (`VITE_APP_MODE=demo` at build time); the CI-validated build output is production-mode.

## 6. Verdict

**Ready for controlled client UAT for the read-only DataMan ERP gate-entry screens** —
with the caveat that the live DataMan connection (certificate trust on 192.168.1.200)
still requires the production DBA confirmation the code already demands; until then
`/erp/*` degrades honestly with 503 ERP_UNAVAILABLE, which is the designed behavior.
