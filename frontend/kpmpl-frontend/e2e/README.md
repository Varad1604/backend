# KPMPL E2E suite (Phase 2)

Playwright journeys against the integration compose stack
(`backend/docs/integration/LOCAL.md`). The stack must be up first:

```bash
# from backend/ — includes the prod-like origin on 8080
docker compose -f docker-compose.yml -f docker-compose.integration.yml --profile prod-like up -d --build
```

## Run

```bash
npm run e2e          # setup + dev (5173) + prod-like (8080) projects
npm run e2e:ui       # UI mode; E2E_BASE_URL (default 5173) picks the origin
npx playwright test --project=dev            # only the dev origin
npx playwright test --project=prod-like      # only the production-like origin
```

Environment: `E2E_BASE_URL` (dev origin, default `http://localhost:5173`),
`E2E_BASE_URL_PROD` (default `http://localhost:8080`), `DEMO_PASSWORD`
(defaults to the value in `backend/.env`).

## Design notes

- **Login happens for real.** The setup project signs each of the five demo users in
  through the actual login form once and asserts the `__Host-kpmpl_sid` contract
  (HttpOnly, Secure, SameSite=Lax, host-only). Journey contexts then log in via the
  context's own request, so the cookie is always set by a real `Set-Cookie` response —
  never re-injected from serialized state.
- **One browser context per role** per spec file; journeys that chain state run in
  `serial` mode inside their file, and different files run in parallel on disjoint
  data (each chain creates its own fresh visit / throwaway user).
- **Re-run safe.** Golden-path, resubmission, concurrency and resilience journeys
  create fresh `DEMO-E2E-*` references per run; admin/auth journeys use a throwaway
  user. The seeded fixtures (`DEMO-GATE-0001…0004`) stay read-only, so the suite can
  run three consecutive times for the flake gate without reseeding.
- **Retries are off** (`retries: 0`) on purpose: the phase exit criterion is a flake
  rate of 0 over 3 consecutive runs, and a retry would hide flakes.

## The 14 journeys

| # | Journey | Spec |
|---|---|---|
| 1 | Gate entry (new receiving, reload persistence) | `golden-path.spec.ts` |
| 2 | QC draft → submit (R-07 overwrite) | `golden-path.spec.ts` |
| 3 | QC decision by the QC operator | `golden-path.spec.ts` |
| 4 | Tare → physical exit → GRN | `golden-path.spec.ts` |
| 5 | Document package + PDF uploads | `golden-path.spec.ts` |
| 6 | Send package to Head Office | `golden-path.spec.ts` |
| 7 | HO review + private PDF viewer | `golden-path.spec.ts` |
| 8 | ERP milestones (approval → voucher → posting) | `golden-path.spec.ts` |
| 9 | CSV download | `reports.spec.ts` |
| 10 | Admin reset password (temp password lifecycle) | `auth-admin.spec.ts` |
| 11 | Change password (forced + self-service) | `auth-admin.spec.ts` |
| 12 | Concurrency → VERSION_CONFLICT → recovery | `resilience.spec.ts` |
| 13 | Cross-role visibility + refusals | `visibility.spec.ts` |
| 14 | Network failure retry with the same Idempotency-Key | `resilience.spec.ts` |
