# TEST EVIDENCE — DataMan ERP weight-mapping correction (2026-11-17)

All numbers below are from commands actually executed in this session. Nothing is
inherited from prior runs. Demo/fixture passwords never appear in this file.

## 1. Backend

```
cd backend/apps/api
pnpm typecheck            # EXIT=0
pnpm build                # EXIT=0  (nest build → dist/)
set -a; . <(tr -d '\r' < ../../.env); set +a
export DATABASE_URL=…127.0.0.1:5432/kpmpl REDIS_URL=redis://127.0.0.1:6379 \
       S3_ENDPOINT=http://127.0.0.1:9000 CLAMAV_HOST=127.0.0.1 REQUIRE_LIVE_DEPENDENCIES=true
pnpm vitest run
# Test Files  18 passed (18)
#      Tests  106 passed (106)
# Duration  91.72s
```
Includes the three ERP spec files (service/pool, controller contract, parameter binding)
and `security.e2e-spec.ts` item 7 — the full endpoint × role matrix, now covering
`/erp/gate-entries` and `/erp/gate-entries/:docId` (allowed roles reach the 503 adapter;
every other role is refused before any ERP call).

## 2. Frontend

```
cd frontend/kpmpl-frontend
npm run ci                # typecheck ×2 PASS; eslint 0 errors (2 pre-existing warnings);
                          # vitest 9 files / 118 tests passed; vite build PASS
```

## 3. Playwright e2e (dev project: Vite 5173 + API 3000 + real stack)

```
npx playwright test --project=dev e2e/erp-gate-entries.spec.ts   # 5 passed
npx playwright test --project=dev                                # 39 passed (2.1m)
```
Before the takeover fixes the same suite was 33 passed / 3 failed (stale pre-ERP
assertions) with journeys 8–10 skipped (`USERS` lacked the accounting demo users).

## 4. Live checks — default posture (no ERP credentials)

```
node tmp/erp-fixture/checks-default.mjs      # RESULT: 15 passed, 0 failed  (run twice)
```
Key lines: 401 unauthenticated; 403 gate/admin; 503 ho with envelope
`{code: ERP_UNAVAILABLE, meta.retryable: true, requestId}`; detail 503 (not a fake 404);
`/receiving-visits` still 200.

API boot log (default posture):
```
ErpSqlServerService: Missing required ERP environment variables: ERP_HOST, ERP_DB, ERP_USER, ERP_PASSWORD
ErpSqlServerService: ERP configuration incomplete — no connection attempt made; /erp/* will return 503 ERP_UNAVAILABLE.
```

## 5. Live checks — real ERP data (local SQL Server fixture)

Fixture (loopback-only, fully TLS-validated; throwaway local CA trusted via
NODE_EXTRA_CA_CERTS; trustServerCertificate stayed false; db_datareader-only login,
INSERT denied at the DB — asserted by setup):

```
bash tmp/erp-fixture/setup.sh
# read-only login: INSERT correctly DENIED at the database
# FIXTURE_READY container=kpmpl-erp-fixture host=127.0.0.1:14330 db=KAYGAONNew24 tls=localCA
node tmp/erp-fixture/checks-fixture.mjs      # RESULT: 31 passed, 0 failed
bash tmp/erp-fixture/teardown.sh             # restores the default posture
node tmp/erp-fixture/checks-default.mjs      # RESULT: 15 passed, 0 failed  (again)
```

API log during the fixture phase (full certificate validation, guarded exception refused):
```
ErpSqlServerService: ERP_LOCAL_TEST_ALLOW_UNTRUSTED_CERT="false" is not exactly "true" — ignored; certificate validation stays enforced.
ErpSqlServerService: Connection pool initialized and health check passed.
ErpSqlServerService: Pool configured — max: 20, … encrypt: true, trustServerCertificate: false, tdsVersion: 7_4
```

Highlights of the 31 assertions: kg-only weights ("tons" appears nowhere); the
never-recomputed proof (ERP net 7050.5 returned verbatim where gross−tare would be 7000);
null-vs-zero semantics (missing weighment → nulls; nulls inside a row → nulls;
`fieldsAvailable` exact); fan-out collapse; detail aggregation (2 weighments with slip
numbers ordered by Weigh_Date; 2 GRNs ordered by GRN_Date APPROVED→REJECTED); pagination
(limit 3 → totalPages 3); exact docId/vType filters (vType=PCHLG → 3 gate entries, GIN
excluded); 404 NOT_FOUND for an unknown DocId while reachable; 401/403 RBAC; no cascade.

## 6. Docker image build blocker (environmental, documented)

```
docker compose build migrate api          # failed: pnpm install --frozen-lockfile → EAI_AGAIN registry.npmjs.org
docker buildx build --network=host …      # failed: same (corepack fetch of pnpm 10.15.0)
docker buildx create --driver docker-container … && docker buildx build …  # failed: same
docker run --rm node:24-alpine getent hosts registry.npmjs.org            # DNS_OK (same window)
```
4/4 build attempts failed while plain containers resolved DNS in the same minutes — an
intermittent BuildKit DNS flake on this machine. The committed Dockerfile is unchanged;
`pnpm typecheck`+`pnpm build` on the host prove the compile path (EXIT=0 both). When the
network cooperates: `cd backend && docker compose build migrate api && docker compose up -d migrate api`.

## 7. Runtime state at handoff

- Containers healthy: kpmpl-postgres-1 (5432), kpmpl-redis-1, kpmpl-minio-1, kpmpl-clamav-1,
  kpmpl-local-web (nginx :5173, durable nginx-local.conf, `--add-host api:host-gateway`).
- API: host-run `node dist/main.js` on :3000, default 503 posture.
- `backend/.env`: no ERP_* keys (verified 0 matches after teardown).
- Screenshots: `erp-handover/screenshots/` (real-data list, 1004 detail, default outage).
