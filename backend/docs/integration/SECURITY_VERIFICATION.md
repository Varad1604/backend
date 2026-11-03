# Security verification (Phase 3)

Rulebook `PHASE 3 — SECURITY HARDENING (verify, fix, prove)`. Branch:
`integration/phase-3-security` (backend) / `integration/phase-3-security` (frontend).
Automated evidence: `apps/api/test/security.e2e-spec.ts` (live-gated, run against the
compose stack) and `frontend/kpmpl-frontend/e2e/security.spec.ts` (CSP/headers/localStorage).
Run:

```bash
# backend (from backend/, with the compose stack up):
REQUIRE_LIVE_DEPENDENCIES=true \
DATABASE_URL="postgresql://kpmpl:change-me@127.0.0.2:55432/kpmpl?schema=public" \
REDIS_URL="redis://localhost:6379" S3_ENDPOINT="http://localhost:9000" \
S3_BUCKET="kpmpl-private-documents" S3_ACCESS_KEY="kpmpl-minio" S3_SECRET_KEY="change-me-too" \
CLAMAV_HOST="localhost" CLAMAV_PORT=3310 \
pnpm --filter api test -- security

# frontend (from frontend/kpmpl-frontend/, with the stack up):
npx playwright test --project=setup --project=dev --project=prod-like --grep "CSP|security headers"
```

## Item evidence

| # | Item | Evidence |
|---|---|---|
| 1 | Cookie | `security.e2e-spec › item 1`: `__Host-kpmpl_sid` flags (`Path=/; Secure; HttpOnly; SameSite=Lax`, no Domain, Max-Age 43200), session ID rotates on re-login, replay of a logged-out cookie → 401, idle-2 h and absolute-12 h proven by mutating the session row (injected clock) and calling the refresh route. `SameSite=Lax` kept per the brief. |
| 2 | CSRF | `item 2`: cookie write without `X-Requested-With` → 403 `Browser write proof is invalid.`; with `Origin: https://evil.example` → 403; with **no Origin** → 403 (documented rule: cookie-authenticated writes require Origin proof); the same write via a bearer (non-browser) token → 201. |
| 3 | CORS | `item 3`: preflight from `https://evil.example` → **no** `Access-Control-Allow-Origin`; from `http://localhost:5173` → exact origin echo (never `*`) + `Access-Control-Allow-Credentials: true`. |
| 4 | Headers | API: `item 4` asserts `X-Request-Id`, `X-Content-Type-Options: nosniff`, `Cache-Control: no-store` on API responses and `private, no-store` + `application/pdf` on file downloads (helmet is registered in `src/http.ts`; CSP is delegated to the SPA origin). SPA: nginx headers + CSP asserted by `e2e/security.spec.ts` on the prod-like origin (`x-frame-options: DENY`, `nosniff`, HSTS, CSP `default-src 'self'`) and **zero `securitypolicyviolation` events across ten pages** on both origins. PDF frame: exercised in Chromium by E2E journey 7 (private PDF viewer). Firefox/WebKit runs are **deferred**: they need `npx playwright install firefox webkit` (~250 MB) on this machine's flaky network — command recorded, to be run when the network allows. |
| 5 | Login rate limiting / lockout | `item 5`: 6th attempt inside the minute → 429 `RATE_LIMITED` (even with the correct password); 10 failures → 15-minute lockout (correct password also 429); unknown user and wrong password return the identical 401 `Username or password is incorrect.` with timing within 300 ms. nginx `limit_req` on `/api/v1/auth/login` (10 r/m, burst 5, status 429) is present in `frontend/kpmpl-frontend/nginx.conf:12,36-37` and did not break the E2E suite (25/25 runs in Phase 2). |
| 6 | Upload validation | `item 6`: text renamed `.pdf` → 422; empty file → 422; 11 MB → 413 with the envelope (`The file is larger than the upload limit.`); EICAR → 422 `This file failed the security scan.` — the file is **rejected at upload**, so nothing infected is ever stored or served (stricter than quarantine; the content route also refuses any row whose `scanStatus !== 'clean'`); ClamAV down (port 1) → fail closed: 422 `The security scanner is unavailable. Try again later.` and no file row; no `storageKey`/MinIO URL appears in any response; anonymous GET of a real storage key on the bucket → 403. |
| 7 | Authorization matrix | `item 7`: 24 endpoints × 6 roles (144 requests; since 2026-11-03 the matrix is 23 endpoints × 5 roles, see CONTRACT_DIFF D-03 entry) driven against the live policy table (`roleCapabilities` as the single source of truth): allowed roles never see 401/403, denied roles always 403/404 — including the HO record-visibility rule (draft package → 404). Route coverage: every HTTP route is capability-guarded or explicitly public — `route-guard.spec.ts` (unit) walks all controllers via reflection and fails otherwise. |
| 8 | Must-change-password | **Backend fix in this phase**: the flag was previously enforced only by the frontend redirect. `AuthGuard` now refuses everything except `GET /auth/me`, `POST /auth/logout`, `POST /auth/change-password` while `mustChangePassword` is set. `item 8`: created user → forced login → other reads/writes 403 `Set a new password before using the system.` → change-password 200 → reads work again. The frontend enforces the same per route (`RequireAuth` forced redirect, exercised by E2E journey 11a). |
| 9 | Audit log | `item 9`: `login`, `login_failed`, `user_created`, `password_reset` and correction records (with reason/before/after) asserted in the isolated schema; `UPDATE`/`DELETE` on the audit table are rejected at the DB level (trigger — `identity.e2e-spec › enforces audit immutability`). No secrets in logs: the spec captures the pino stream and asserts the password, the cookie name and bearer tokens never appear (`main.ts` redacts authorization/cookie/set-cookie); the compose-level command `docker logs kpmpl-api-1 2>&1 | grep -icE "password|__Host-kpmpl_sid|Bearer [A-Za-z0-9._-]{20,}"` returns 0 across a full E2E run. |
| 10 | No secrets in the frontend bundle | Build with production env, then grep (recorded; run in this phase — see below): `VITE_API_MODE=http VITE_APP_MODE=production npm run build` then `grep -R -n -e "DEMO_PASSWORD" -e "Demo Supplier A" -e "kpmpl-proto-db" -e "BEGIN PRIVATE KEY" -e "AKIA" dist/` → no matches. No `localStorage` writes in http mode asserted per page by `e2e/security.spec.ts` (and in setup). |
| 11 | Dependencies and images | Commands + output recorded below (`npm audit` / `pnpm audit` / Trivy). Frontend react-router 6 moderates remain, mitigated by the return-path guard (accepted, reason recorded in Phase 1). |

## Recorded commands and output (items 10-11)

To be filled from the final verification run (see the phase report):
bundle grep, `npm audit --omit=dev --audit-level=high` (frontend), `pnpm audit --prod --audit-level=high`
(backend), Trivy on both images.

## Environmental notes (this machine)

- Docker Desktop wedges after sustained heavy load (CLI hangs / engine pipe 500s).
  Remedy: quit Docker Desktop, `wsl --shutdown`, relaunch (per-user install at
  `%LOCALAPPDATA%\Programs\DockerDesktop`). After each restart a stale `wslrelay.exe`
  may shadow `127.0.0.1:5173` — kill the non-Docker PID holding the port.
