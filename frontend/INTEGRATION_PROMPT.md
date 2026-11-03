# KPMPL Gate-to-Bill — Frontend ↔ Backend Integration Prompt

## How to use this prompt (for the human)

1. Put these three files in one empty folder your AI coding agent can read:
   - `kpmpl-frontend-v0.6.0.zip` (the frontend);
   - `backend.zip` (your backend);
   - `KPMPL_Backend_Build_Brief.md` (the contract the backend was built to).
2. Paste everything below the line into the agent as its task.
3. The agent **stops after Phase 0** with a contract audit (`CONTRACT_DIFF.md`) and changes nothing. Read it.
   - Settle every row marked `decision-needed`.
   - Then reply `continue to Phase 1`.
4. After each later phase the agent reports in a fixed format and waits for `continue`. Review each pull request before merging. The agent never pushes to `main`.
5. Before Phase 2, have Docker (with Compose v2) available on the machine.

---

## ROLE AND OBJECTIVE

You are a senior full-stack engineer and integration lead. Connect the **KPMPL Integrated Gate-to-Bill** web frontend (React 18 + TypeScript + Vite) to its backend (built from `KPMPL_Backend_Build_Brief.md`, "the brief").

The goal is that every role, on any device, works on the same live server data through the existing UI, securely, with automated proof.

You will:
1. audit the contract;
2. align it;
3. run both locally with end-to-end tests;
4. harden security;
5. prepare a production build and CI.

You do **not** host, deploy to any public environment, or contact external services.

Client: Kaygaon Paper Mills Pvt. Ltd. (KPMPL). Developer: PRAVAHAx Systems Engineering. **All data is synthetic** (`DEMO-` prefixes).

## INPUTS

| Input | What it is | Treat as |
|---|---|---|
| `kpmpl-frontend-v0.6.0.zip` | Frontend v0.6.0. The HTTP adapter is already aligned to brief §3/§5. Mock mode is the default. | Source of truth for UI behaviour and visual design |
| `backend.zip` | The backend (expected: NestJS + Fastify, Prisma, PostgreSQL 16, MinIO/S3, ClamAV; verify) | Source of truth for server behaviour once aligned |
| `KPMPL_Backend_Build_Brief.md` | The contract: §3 conventions, §4 roles, §5 endpoints, §6 data, §7 rules R-01…R-22, §8 security, §9 ops, §10 switch-over, §12 acceptance suite, §14 prohibitions | **Normative contract** |

Workspace layout to create (unzip, do not rename inner folders more than needed):

```
kpmpl/
  frontend/        ← kpmpl-frontend-v0.6.0.zip (folder kpmpl-frontend/ inside)
  backend/         ← backend.zip
  brief/KPMPL_Backend_Build_Brief.md
```

Initialise Git in each repo if it is not one already. Commit the untouched import as `chore: import v0.6.0 frontend` / `chore: import backend` on `main`. From then on, work only on branches.

### Frontend files you must read before anything else

- `README.md`: §5 endpoint table (37 rows), error mapping, session-expiry flow, §6 security notes, §7 open contract points.
- `src/api/ReceivingApi.ts`: the only UI↔data interface.
- `src/api/http/httpAdapter.ts`: every HTTP call: paths, methods, headers, bodies, envelope parsing, error mapping, timeout, retry policy.
- `src/api/http/httpAdapter.test.ts`: 48 unit tests that pin the adapter's behaviour.
- `src/domain/types.ts`: every request and response shape (field names are the contract).
- `src/api/mock/mockAdapter.ts`: approved user-facing error wording and the prototype rule defaults.
- `src/auth/permissions.ts`: role → capability matrix (must equal brief §4).
- `src/configSchema.ts`, `vite.config.ts`, `.env.*.example`, `Dockerfile`, `nginx.conf`, `nginx-proxy.conf`, `nginx-security-headers.conf`.

## THE CONTRACT IN ONE PAGE (quoted from the brief; verify against both repos)

- **Base URL:** `/api/v1`. The frontend default is `VITE_API_BASE_URL=/api/v1` (same origin via the Vite proxy or nginx).
- **Envelope:**
  - `200/201` → `{ "data": <payload> }`. Paged lists: `{ "data": { "data": [...], "page", "pageSize", "total" } }`.
  - `204` → no body (logout only).
  - Errors → `{ "error": { "code", "message", "fields", "requestId", "meta" } }`.
- **Error codes → HTTP:**

  | Code | HTTP |
  |---|---|
  | `UNAUTHENTICATED` | 401 |
  | `FORBIDDEN` | 403 |
  | `NOT_FOUND` | 404 (also "not visible to this role") |
  | `VALIDATION_FAILED` | 422 (`fields` keys = UI input names) |
  | `DUPLICATE_CANDIDATE` | 409 (`meta.existingId`) |
  | `VERSION_CONFLICT` | 409 (`meta.currentVersion`) |
  | `DOMAIN_RULE` | 422 |
  | `SERVER_ERROR` | 500 ("Something went wrong. Nothing was saved.") |

- **Headers:**
  - `Idempotency-Key: <uuid>` on every POST/PATCH/PUT/DELETE **except login and logout**.
    - Same key + same request → replay the stored response.
    - Same key + different body → 422 `VALIDATION_FAILED` "Idempotency key reused with different data".
    - Stored 24 h, written in the same transaction as the change.
  - `If-Match: <integer version>` on every write to an existing visit or package.
    - QC writes (`submitQc`, `decideQc`) send the **visit** version.
    - Package and Head Office writes send the **package** version.
  - `X-Requested-With: kpmpl-web` on every request (server rejects writes without it).
- **Session:**
  - Server-side sessions; cookie **`__Host-kpmpl_sid`**: `HttpOnly; Secure; SameSite=Lax; Path=/`, no `Domain`.
  - argon2id hashing.
  - 12 h absolute / 2 h idle timeout.
  - Rotate the session ID on login and on role change.
- **CSRF:** `SameSite=Lax`, plus an `Origin` check on state-changing requests, plus the `X-Requested-With` header. **CORS:** allowlist only, with credentials.
- **Rate limits:**
  - login: 5/min per IP+username;
  - lockout after 10 failures for 15 min;
  - general API: 300/min per session.
- **Limits:** JSON 100 KB; uploads 10 MB (`MAX_UPLOAD_MB`).
- **Data formats:**
  - Decimals are strings with fixed scale: `"15000.000"` (kg, `NUMERIC(12,3)`), percent `NUMERIC(5,2)`.
  - ERP refs are opaque strings (`"0008-HO"` round-trips byte for byte).
  - Times are ISO-8601 UTC (`2026-11-02T06:27:00.000Z`). "Today" means Asia/Kolkata.
- **Roles** (`gate`, `gate_doc`, `qc`, `ho`, `admin`) and **capabilities**: `receiving.view, receiving.create, receiving.edit, gate.followup, qc.queue.view, qc.measure, qc.decide, overview.view, docs.prepare, docs.submit, ho.inbox, ho.review, erp.confirm, admin.users`. The matrix is in brief §4. (Updated 2026-11-03, D-03: the QC operator holds `qc.decide` and makes the final QC decision.)
- **File content:**
  - `GET /api/v1/document-files/{fileId}/content`.
  - Response headers: `Content-Type: application/pdf`, `Content-Disposition: inline; filename="..."`, `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store`.
  - Access: `docs.prepare`, or `ho.inbox` when the package is HO_VISIBLE.
- **CSV:** `GET /api/v1/reports/receiving.csv?from=&to=`.
  - UTF-8 BOM, RFC 4180.
  - Prefix `= + - @` cells with `'`.
  - Columns = the frontend's current CSV columns (`RECEIVING_CSV_COLUMNS` in `mockAdapter.ts`).
- **Demo mode:**
  - Backend `APP_MODE=demo` seeds `demo-gate, demo-qc, demo-docs, demo-ho, demo-admin`, with password from env `DEMO_PASSWORD`.
  - The backend refuses to start with `APP_MODE=demo` and `NODE_ENV=production`.
  - Frontend: `VITE_APP_MODE=production` hides and compiles out all demo affordances.

## GOLDEN RULES

1. **Audit before you change.** Phase 0 changes no code. Stop after it.
2. **The brief is normative.** When a frontend call and a backend route disagree, fix the side that deviates from the brief. When the brief is silent or ambiguous:
   - prefer the existing frontend behaviour (the brief's own rule: the UI is already built against it);
   - mark the row `decision-needed` if either choice changes behaviour users can see.
3. **Every contract change is written down** in `backend/docs/CONTRACT_CHANGES.md` (the brief's file), in the same PR as the code, with a test.
4. **Server is the only authority.** Every route checks authentication and the capability. The UI's `permissions.ts` only hides navigation.
5. **Never invent business rules.** Undecided rules stay named, configurable policies labelled "pending KPMPL confirmation".
6. **No visual changes.** The v0.5 editorial design (paper/ink, IBM Plex, ruled, no cards, `SafeForm`, real `<label>` around file inputs) stays as is. Frontend edits stay inside `src/api/http/`, `src/domain/types.ts` and minimal wiring, unless a CONTRACT_DIFF row approves more.
7. **Tests prove every claim.** Run the commands; paste real output counts. Never weaken, skip or delete a test to go green.
8. **Small, reviewable PRs**, one per phase (split further if > ~600 changed lines). Conventional commits. Never push to `main`.

---

## PHASE 0 — AUDIT (change nothing, then STOP)

Branch: none needed (read-only). Output goes in `backend/docs/integration/` (create the folder; this is the only write allowed).

### 0.1 Unpack and inventory
- Unzip both and record the tree (depth 3), package managers, Node version, and frameworks with versions.
- Find the backend's route definitions, DTO/Zod schemas, guards/decorators, error filter, envelope interceptor, idempotency and versioning middleware, cookie/session config, CORS/CSRF/Helmet setup, upload handler, storage client, ClamAV client, CSV writer, seed script, `docker-compose.yml`, `.env.example`, OpenAPI generation.

### 0.2 Run what exists (no code edits)
- Frontend (`frontend/kpmpl-frontend`):
  ```bash
  npm ci && npm run typecheck && npm run lint && npm run test && npm run build && npm run build:preview
  ```
  Expected: typecheck clean, lint with 0 errors, 71 tests passing, both builds succeeding.
- Backend:
  - discover the scripts (`package.json`) and run install, lint, typecheck, unit tests and integration tests;
  - integration tests use Testcontainers, so Docker is required;
  - if a step cannot run, record the exact error and continue;
  - record the pass/fail/skip counts and coverage if reported.
- If the backend can start, start it with its `docker-compose.yml` and list the live routes (OpenAPI at `/api/v1/docs` or the framework's route dump). Otherwise derive the routes from code.

### 0.3 Produce `backend/docs/integration/CONTRACT_DIFF.md`

Compare **every** call in `frontend/.../src/api/http/httpAdapter.ts` (README §5 lists 37) against the backend routes. One row per check:

| # | Area | Frontend (file:line) | Backend (file:line) | Brief § | Status | Justification | Proposed change |
|---|---|---|---|---|---|---|---|

**Status** is one of: `match` · `frontend-fix` · `backend-fix` · `decision-needed`.

Check each of these and give each its own rows:
1. **Path and method** for all 37 adapter calls, including:
   - `GET /receiving-visits` repeated `qcStatus` params;
   - `DELETE /document-packages/{id}/files/{fileId}?category=`;
   - `PUT /document-packages/{id}/items/{category}/applicability`;
   - `POST /qc-inspections/{inspectionId}/decisions` (the frontend first `GET`s `/receiving-visits/{id}/qc-inspections` and reads `[0].inspectionId`);
   - `GET /head-office/cases` vs `GET /document-packages`.
2. **Request schemas:** every body field name, optionality and enum value vs `src/domain/types.ts`:
   - `CreateReceivingVisitInput`, `CorrectVisitInput` (+ `reason`), `RecordTareInput` (sent as `{kind:'tare',value,unit:'kg',correctionReason?}`), `RecordExitInput`, `RecordGrnInput`;
   - `QcSubmitInput` (`intent: 'draft'|'submit'`), `QcDecisionInput`;
   - `CreatePackageInput`, `UpdatePackageInput`, `PackageAction` (6 kinds), HO check `{packageId,category,check,note}`, `ErpMilestoneInput` (a reverse sends its reason in `note` and `verifiedInDataManByStaff:false`), reminder `{note}`;
   - `CreateUserInput`, `UpdateUserInput`, `ChangePasswordInput`.
   - Does the server strip or reject unknown fields? Does it fail on unknown enum values (brief §8)?
3. **Response schemas:**
   - `User` (+ `mustChangePassword` placement), `ReceivingVisit` (exact field list in brief §5.2), `Page<T>`;
   - `QcInspection` / `QcRevision` / `QcReviewNote` / `QcQueueItem`, `TimelineEvent` (`source: 'app'|'manual_staff_confirmation'`), `OverviewData`;
   - `DocumentPackageView` (6 `items` in fixed order, 3 `erp` in fixed order, resolved `visits`), `DocumentFile` (`id,name,sizeBytes,mimeType,uploadedAt,uploadedBy,synthetic`), `ErpMilestone.source` (frontend accepts `manual_staff_confirmation` and `staff_confirmed`);
   - `createUser` → `User & {temporaryPassword}`, `reset-password` → `{temporaryPassword}`, `change-password` → 204 or `{data}`.
4. **Envelope:**
   - `{data}` on every 2xx except logout's 204;
   - paged double `data`;
   - `{error:{code,message,fields,requestId,meta}}` on **every** non-2xx, including framework-generated 400/404/413/415/429 and errors thrown by guards and pipes.
5. **Error codes:**
   - each code and HTTP status vs brief §3;
   - `fields` keys equal the UI input names (e.g. `grossWeight`, `officialGateEntryRef`, `reason`, `visitIds`, `file`, `currentPassword`, `newPassword`);
   - `meta.existingId` and `meta.currentVersion` present;
   - which code a deactivated-user login returns (brief: 401; mock: 403; the UI handles both);
   - what 429 returns (no code in the brief table; the frontend maps 429 → `DOMAIN_RULE`).
6. **Headers:**
   - `Idempotency-Key` required where the brief says, **and accepted** on `PATCH /admin/users/{id}`, `POST /admin/users/{id}/reset-password` and `POST /auth/change-password` (the frontend sends it on all three);
   - replay and mismatch behaviour;
   - `If-Match` integer parsing (not a quoted ETag), and which version is compared for QC writes;
   - `X-Requested-With: kpmpl-web` enforcement on writes;
   - `X-Request-Id` echoed in responses.
7. **Cookie:**
   - name `__Host-kpmpl_sid`; flags `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, no `Domain`;
   - rotation on login;
   - logout clears it;
   - session revoked on deactivation and on admin password reset;
   - idle/absolute timeouts.
8. **CORS and CSRF:**
   - allowlist source (env var name);
   - credentials;
   - `Origin` check on writes, and how it behaves behind the Vite proxy (Origin `http://localhost:5173`) and behind nginx (same origin);
   - whether a missing `Origin` is rejected.
9. **Multipart:**
   - field names `category` and `file`; file size limit; `%PDF-` magic-byte check;
   - empty-file rejection;
   - ClamAV fail-closed behaviour;
   - response = updated `DocumentPackageView`;
   - what an infected file returns (`DOMAIN_RULE` "This file failed the security scan.").
10. **File content endpoint:**
    - path `GET /document-files/{fileId}/content`; the four response headers above; permission rules;
    - whether the response's CSP / `X-Frame-Options` lets the **same-origin** SPA frame it (Helmet defaults `SAMEORIGIN` / `frame-ancestors 'self'` are fine; `DENY` or `frame-ancestors 'none'` breaks the viewer).
11. **CSV:** path, auth (`overview.view`), BOM, columns and order vs `RECEIVING_CSV_COLUMNS`, formula-injection prefix, `Content-Disposition` filename, `from`/`to` format.
12. **Pagination:** `page` and `pageSize` defaults (50) and max (500); `total`; sort `createdAt DESC`. The frontend requests `pageSize=500` on several screens and `pageSize=1` to read counts.
13. **Date and decimal formats:**
    - decimal regexes `^\d{1,9}(\.\d{1,3})?$` (kg) and `^\d{1,3}(\.\d{1,2})?$` (percent); fixed-scale string output;
    - refs returned exactly as typed;
    - all times ISO UTC with `Z`; `physicalExitAt` / `erpOccurredAt` (sent by the UI as UTC ISO) stored separately from record time.
14. **Role names and capabilities:** role codes, the capability strings, and the matrix in `src/auth/permissions.ts` vs the backend seed and guards vs brief §4. HO visibility = `HO_VISIBLE` states.
15. **Demo and config:**
    - `APP_MODE`, `DEMO_PASSWORD`, `MAX_UPLOAD_MB` (`QC_REVIEW_ENABLED` retired 2026-11-03);
    - policy flags (`GATE_ENTRY_UNIQUE_SCOPE`, `EXIT_REQUIRES`, …) and `GET /config/policies` (the frontend does not call it yet);
    - health paths (`/healthz`, `/readyz`: root or under `/api/v1`?);
    - the backend's listen port (the frontend dev proxy defaults to `http://localhost:3000`).
16. **README §7 open points** of the frontend: one row each (9 items).
17. **Anything else** you find that breaks a UI flow (e.g. a missing endpoint, a renamed field, a different status enum).

End `CONTRACT_DIFF.md` with:
- a summary table of counts per status;
- the list of `decision-needed` items, each with a recommended option;
- a risk list (top 5).

### 0.4 STOP and report (format in REPORTING). Do not start Phase 1 until the human replies `continue to Phase 1`.

---

## PHASE 1 — ALIGN THE CONTRACT

Branches: `integration/phase-1-backend-contract` (backend) and `integration/phase-1-frontend-contract` (frontend).

1. Implement every `backend-fix` and `frontend-fix` row, plus the decisions the human made.
   - Fix the side that deviates from the brief.
   - Frontend changes go in `src/api/http/httpAdapter.ts` and `src/domain/types.ts` first. Touch UI files only if a row says so.
   - Keep the mock adapter in step with any interface change, so mock/demo mode still works.
2. Log every change in `backend/docs/CONTRACT_CHANGES.md`: date, row #, before → after, which side, why (brief §), and the test that covers it. Update the frontend README §5 and §7 when the frontend contract changes.
3. Tests with each change:
   - backend: an HTTP test (Supertest) per changed route asserting status, envelope, `code`, `fields` keys and headers;
   - frontend: extend `httpAdapter.test.ts` for any changed path, header or body.
4. Add a **contract test** that keeps the two sides from drifting. Pick one and justify the choice:
   - (a) generate the backend OpenAPI 3.1 document and validate the frontend's request and response fixtures against it in CI; or
   - (b) a shared Zod schema package used by both.
5. Re-run Phase 0.2 commands. Update `CONTRACT_DIFF.md` so every row is `match` or explicitly deferred with a reason.

Exit criteria:
- both test suites are green;
- no `backend-fix` or `frontend-fix` rows remain open;
- every row in `CONTRACT_CHANGES.md` has a test reference.

---

## PHASE 2 — LOCAL INTEGRATION AND END-TO-END TESTS

Branches: `integration/phase-2-compose` (backend) and `integration/phase-2-e2e` (frontend).

### 2.1 Compose stack
Add `backend/docker-compose.integration.yml` (an override of the backend's dev compose) with:
- `postgres:16` with a volume and healthcheck;
- `minio` with a private bucket created at start-up (public access blocked, versioning and SSE on, per brief §5.9);
- `clamav` (`clamav/clamav:stable`; use `clamav/clamav-debian` on arm64), with a healthcheck, and the backend waiting for it;
- the `api` (backend) with `APP_MODE=demo`, `NODE_ENV=development`, `DEMO_PASSWORD` from a local `.env` (not committed), the CORS/Origin allowlist containing `http://localhost:5173` and `http://localhost:8080`, `MAX_UPLOAD_MB=10`, and migrations run as a separate one-shot service (`prisma migrate deploy`) before `api` starts;
- `web` (Vite dev with proxy): `node:22-alpine`, mounting `../frontend/kpmpl-frontend`, running `npm ci && npm run dev -- --host 0.0.0.0`.
  - Env: `VITE_API_MODE=http`, `VITE_APP_MODE=demo`, `VITE_API_BASE_URL=/api/v1`, `VITE_PROXY_TARGET=http://api:<port>`.
  - Port `5173`.
- profile `prod-like`: `web-prod`, built from the frontend `Dockerfile` (`VITE_APP_MODE=production`), with `BACKEND_UPSTREAM=http://api:<port>` on port `8080`.
  - It exercises the real nginx config: SPA fallback, `/api` proxy, security headers.
  - Note: `__Host-` cookies need `Secure`. Chrome and Firefox accept them on `http://localhost`; Safari does not.

Document `make`- or npm-style one-liners in `backend/docs/integration/LOCAL.md`: up, seed, reset, logs, down.

### 2.2 Seed
The demo seed (brief §9) must load the 5 demo users plus the fixture visits and packages equivalent to `src/api/mock/fixtures.ts` (4 visits in different states, 2 packages). Use synthetic data only. The seed must be idempotent.

### 2.3 Manual smoke (record results)
1. Log in as each demo user through `http://localhost:5173`.
2. Confirm in DevTools:
   - the `__Host-kpmpl_sid` flags;
   - requests carry `X-Requested-With`;
   - writes carry `Idempotency-Key` and `If-Match`.
3. Reload any page: data and session survive.

### 2.4 Playwright E2E (frontend repo, `e2e/`, `@playwright/test`)
- Config:
  - `baseURL` from `E2E_BASE_URL` (default `http://localhost:5173`); a second project runs against `http://localhost:8080` (prod-like);
  - traces on failure; workers ≥ 2;
  - **one browser context per role** (the brief §12.13 requirement).
- Use role-based locators (labels and button names as rendered). Add `data-testid` only where no accessible name exists, and record it.
- Journeys (each one a test; assert UI state **and** reload the page to prove persistence):
  1. **Gate entry** (`demo-gate`):
     - empty-submit validation;
     - duplicate Gate Entry No. → "Possible duplicate";
     - create a visit with ref `0008-HO` and gross `15000.000`;
     - it appears in the Receiving Register and the QC queue.
  2. **QC** (`demo-qc`): save a draft → submit (moisture + impurity); "No automatic deduction configured" is shown.
  3. **QC decision** (`demo-qc`, D-03 decided 2026-11-03: the QC operator decides):
     - return for a re-check with a reason → QC resubmits with a revision reason → accept;
     - the outcome is a real decision (no demonstration label).
  4. **Tare / exit / GRN** (`demo-gate`):
     - tare `4000.000` (net shown);
     - exit (requires mill-checks confirmation);
     - GRN `00071-HO`;
     - the three status domains update independently.
  5. **Document package** (`demo-gate`):
     - link 2 trucks of one supplier;
     - attach a real PDF (`e2e/fixtures/DEMO-invoice.pdf`) through the real file `<input>`;
     - mark the other 5 rows not applicable with reasons;
     - mark ready.
  6. **Send to HO** (`demo-docs`): check and send (confirm completeness).
  7. **HO review** (`demo-ho`):
     - start the review;
     - open the PDF viewer (assert the iframe `src` is `/api/v1/document-files/{id}/content` and the response is 200 `application/pdf`);
     - mark checked;
     - request a correction → (gate replaces the file, docs resubmit with a note) → verify.
  8. **ERP milestones** (`demo-ho`):
     - confirm Plant Head approval → Voucher → Posting in order;
     - reverse Posting with a reason;
     - log a reminder: allowed only while approval is pending, so test it on a second package and show the reminder rejection after approval.
  9. **Overview CSV** (`demo-gate` or `demo-ho`):
     - download it;
     - assert the UTF-8 BOM, the exact header row = `RECEIVING_CSV_COLUMNS`, that `0008-HO` is present unchanged, and that a value starting with `=` is prefixed with `'`.
  10. **Admin reset password** (`demo-admin`):
      - reset `demo-qc` → a one-time temporary password is shown and the Copy button works;
      - the target's existing session (another context) gets 401 → its login page shows "Your session has ended";
      - the old password fails.
  11. **Change password** (`demo-qc`):
      - sign in with the temporary password → forced to Change password (navigation blocked);
      - a short password shows a field error;
      - change succeeds → land on the QC queue;
      - sign in again with the new one.
  12. **Concurrency** (two contexts, same role): both open the same visit, both save a change, and exactly one gets "Updated by someone else".
  13. **Cross-role visibility** (brief §12.5):
      - a visit created in context A is visible immediately in contexts B, C and D at the same `version`;
      - `demo-ho` cannot open a draft package (Not found);
      - `demo-qc` gets 403/404 on `GET /api/v1/document-files/{id}/content`.
  14. **Network failure:** abort one write with `page.route` → "Not saved" and the input is kept; a retry succeeds without a duplicate (same `Idempotency-Key` header observed).
- Scripts:
  - `npm run e2e` (headless) and `npm run e2e:ui`;
  - a `docker-compose` wait-for-ready helper.

Exit criteria:
- all journeys pass in both projects (5173 and 8080);
- the brief §12.13 run (all roles in parallel, then reload every tab) passes;
- flake rate 0 over 3 consecutive runs (paste the counts).

---

## PHASE 3 — SECURITY HARDENING (verify, fix, prove)

Branch: `integration/phase-3-security`. Each item gets a check: an automated test where possible, otherwise a recorded command and its output in `backend/docs/integration/SECURITY_VERIFICATION.md`.

1. **Cookie:**
   - `Set-Cookie: __Host-kpmpl_sid=…; Path=/; Secure; HttpOnly; SameSite=Lax`, no `Domain`;
   - the ID rotates on login (compare before and after);
   - logout invalidates it server-side (replaying the old cookie → 401);
   - idle 2 h and absolute 12 h with an injected clock.
   - Keep `SameSite=Lax` per the brief. `Strict` only via a `CONTRACT_CHANGES.md` entry with a reason.
2. **CSRF:**
   - a write without `X-Requested-With: kpmpl-web` → 403;
   - a write with `Origin: https://evil.example` → 403;
   - a write with no `Origin` → follow the backend's documented rule (recommend reject on cookie-authenticated writes).
3. **CORS:**
   - a preflight from a non-allowlisted origin gets no `Access-Control-Allow-Origin`;
   - an allowlisted origin gets an exact echo (never `*`) with `Allow-Credentials: true`.
4. **Headers:**
   - API: Helmet defaults, HSTS in production, `Cache-Control: no-store` on API and file responses, `X-Request-Id`;
   - SPA via nginx: the CSP in `nginx-security-headers.conf` produces no console violations across all E2E journeys (assert in Playwright by collecting `securitypolicyviolation` events);
   - the PDF frame works in Chromium, Firefox and WebKit.
5. **Login rate limiting and lockout:**
   - 6 failed logins in a minute for the same IP+username → 429 (envelope present);
   - 10 failures → 15-minute lockout;
   - unknown user and wrong password get the identical 401 message and similar timing;
   - the nginx `limit_req` on `/api/v1/auth/login` does not break the E2E suite.
6. **Upload validation:**
   - a text file renamed `.pdf` → 422;
   - an empty file → 422;
   - an 11 MB file → 422 (nginx 413 must still produce the envelope or be mapped);
   - the EICAR string → `infected`, quarantined, never served;
   - ClamAV down → fail closed;
   - the bucket is not publicly readable (anonymous GET → 403);
   - no storage URL appears in any response.
7. **Authorization matrix:**
   - an automated test for **every endpoint × every role** (5 roles), asserting allowed → 2xx/4xx-domain and denied → 403 (or 404 for HO on non-HO_VISIBLE packages and drafts);
   - a CI test fails if any route lacks a capability guard (except login).
   - Never rely on the UI hiding a button.
8. **Must-change-password:** while the flag is set, the server allows only `GET /auth/me`, `POST /auth/logout` and `POST /auth/change-password`; everything else → 403. Add a test; the frontend also enforces it per route.
9. **Audit log:**
   - `UPDATE` / `DELETE` on `audit_event` fail at the DB level;
   - logins, failed logins, permission denials, admin actions, password resets and every correction (before/after/reason) are recorded;
   - no passwords, tokens or file contents in logs (grep the pino output during the E2E run).
10. **No secrets in the frontend bundle:**
    - build with `VITE_API_MODE=http VITE_APP_MODE=production`;
    - `grep -R -n -e "DEMO_PASSWORD" -e "Demo Supplier A" -e "kpmpl-proto-db" -e "BEGIN PRIVATE KEY" -e "AKIA" dist/` → nothing;
    - no `localStorage` writes in http mode (Playwright check).
11. **Dependencies and images:**
    - `npm audit --omit=dev --audit-level=high` clean on both repos (document any accepted moderate with a reason; the frontend currently carries react-router 6 moderates, mitigated by the return-path guard);
    - Trivy on both images: no HIGH/CRITICAL without a written waiver;
    - Dependabot config in both repos.

Exit criteria: every item checked, with evidence; the fixes have tests; the E2E suite is still green.

---

## PHASE 4 — PRODUCTION BUILD, DEPLOY READINESS AND CI (no actual deployment)

Branch: `integration/phase-4-release`.

1. **Topology:** a single origin behind nginx.
   - `https://<host>/` serves the SPA (frontend image).
   - `https://<host>/api/` is proxied to the backend (`BACKEND_UPSTREAM`).
   - TLS terminates at the load balancer or ingress, or in nginx.
   - Document both options; HTTPS is mandatory (`__Host-` cookie).
2. **Environment matrix** (`docs/integration/ENVIRONMENTS.md`):
   - every backend env var (DB URL, S3 endpoint/bucket/keys, ClamAV host, `APP_MODE`, `NODE_ENV`, CORS allowlist, session secret, `MAX_UPLOAD_MB`, policy flags) per environment;
   - frontend build args (`VITE_API_MODE=http`, `VITE_APP_MODE=production`, `VITE_API_BASE_URL=/api/v1`);
   - secrets only from a secret manager; `.env.example` files only in Git.
3. **Migrations:** a separate job (`prisma migrate deploy`) before rollout; backward compatible; a migration check in CI (apply to an empty DB and to the previous schema).
4. **Backups:**
   - Postgres daily full backups + PITR; bucket versioning;
   - a **restore drill** (DB + one PDF into a scratch environment), written up in `RUNBOOK.md`;
   - do not state RPO/RTO figures (pending the client).
5. **Health and logging:**
   - backend `/healthz` and `/readyz`, nginx `/nginx-health`, container healthchecks;
   - structured pino logs with `requestId` end to end (nginx forwards `X-Request-Id`);
   - log retention noted as pending.
6. **CI:**
   - Frontend: `.github/workflows/frontend-ci.yml` exists (install, typecheck, lint, test, build, http build + demo-code grep, audit). Add an E2E job that boots the compose stack and runs Playwright, uploading the report.
   - Backend: lint, typecheck, unit, integration (Testcontainers), migration check, `npm audit`, image build, and Trivy.
   - Branch protection: required checks, 1 review, no direct pushes to `main`.
7. **Release artefacts:**
   - images tagged with version + git SHA;
   - a `CHANGELOG.md` entry per repo;
   - a final `backend/docs/integration/INTEGRATION_REPORT.md` summarising all phases.

---

## DEFINITION OF DONE (all must be true; paste the outputs)

- [ ] Frontend:
  ```bash
  npm ci && npm run typecheck && npm run lint && npm run test && npm run build
  ```
  All green. Lint has 0 errors; report the warning count.
- [ ] Frontend production bundle check:
  ```bash
  VITE_API_MODE=http VITE_APP_MODE=production npx vite build --outDir dist-http && ! grep -R -l -e "Demo Supplier A" -e "kpmpl-proto-db" dist-http
  ```
- [ ] Mock/demo still works:
  - `npm run build:preview` produces a single `dist/index.html`;
  - `npm run dev` with no env signs in as `demo-gate` / `demo`.
- [ ] Backend: lint, typecheck, unit and integration suites green, coverage ≥ 90 % lines on `modules/*/domain` and services (brief §12).
- [ ] Brief §12 acceptance tests 1–13 pass, each named with its rule ID; list the pass/fail counts.
- [ ] `CONTRACT_DIFF.md`: every row is `match` or deferred with the human's approval.
- [ ] `CONTRACT_CHANGES.md`: every change has a test reference.
- [ ] Compose:
  ```bash
  docker compose -f docker-compose.yml -f docker-compose.integration.yml up -d --wait
  ```
  Healthy; the seed is loaded.
- [ ] `npm run e2e` passes all 14 journeys on 5173 and 8080, three runs in a row, with 0 flakes.
- [ ] `SECURITY_VERIFICATION.md`: all 11 items evidenced.
- [ ] `npm audit --omit=dev --audit-level=high` is clean on both repos; Trivy shows no unwaived HIGH/CRITICAL.
- [ ] CI is green on every integration PR; nothing pushed to `main` directly.
- [ ] `RUNBOOK.md` (with the restore drill), `ENVIRONMENTS.md`, `LOCAL.md` and `INTEGRATION_REPORT.md` are written.

## CODING STANDARDS

- TypeScript `strict` (the frontend also uses `noUncheckedIndexedAccess`).
  - No `any`. Use `unknown` plus narrowing.
  - No non-null `!` in app code without a comment explaining why.
- ESLint and Prettier per repo config. Never disable a rule without an inline reason (`// eslint-disable-next-line <rule> -- why`).
- Conventional commits (`feat:`, `fix:`, `test:`, `chore:`, `docs:`, `refactor:`), one logical change per commit, small PRs per phase.
- Tests ship with every change. Bug fix = failing test first.
- Error handling:
  - never swallow errors;
  - user-facing messages stay short, plain English, and copied from the mock adapter's approved wording;
  - every error response carries `requestId`.
- Accessibility: keep labels, focus order, keyboard use, `role="alert"` on errors and 40 px+ touch targets. Do not regress (run axe in Playwright on the main pages and report the counts).
- **No changes to the v0.5 visual design.** No new colours, fonts, cards, shadows or layout.
  - Forms use `SafeForm`, never a bare `<form>`.
  - File inputs stay a real `<label>` wrapping a real `<input type="file">`.

## HARD PROHIBITIONS

- **No invented business rules.**
  - QC formulas and deductions (D-02), deduction thresholds, mandatory documents (D-05), approval authority (D-03, D-08), exit eligibility (D-04), Gate Entry uniqueness scope (D-01/KPM-X-003) and report columns (D-10) stay as the brief's **named, configurable policies**, marked "pending KPMPL confirmation".
  - `deductionCalculation` is always `{status:'not_configured', value:null}`.
- **No DataMan integration.** No connection, scraping or credentials. ERP refs are typed by staff and stored as opaque strings; milestones are `manual_staff_confirmation`.
- **No external messages.** No email, SMS or WhatsApp; reminders are in-app records only.
- **No real data.** Synthetic `DEMO-` data only in seeds, tests, fixtures, screenshots and logs. No real KPMPL names, invoices or credentials.
- **No secrets in Git or in the frontend bundle.** No tokens in `localStorage` or `sessionStorage`.
- **No pushing to `main`.** No force-push to shared branches. No merging your own PR without review.
- **No weakening of tests.** No skipping, deleting, loosening assertions or raising timeouts to hide flakiness.
- **No permission checks only in the UI.** Every capability is enforced on the server.
- **No floats for weights; no numeric parsing of refs.** No overwriting history: corrections append to audit.
- **No hosting or public deployment** as part of this task.

## REPORTING (after every phase; then STOP and wait for `continue`)

```
## Phase <n> report — <title>
Status: complete | blocked | partial
Branches / PRs: <links or names>

### What changed
- Backend: <bullets with file paths>
- Frontend: <bullets with file paths>

### Tests and checks (real output)
| Suite | Command | Pass | Fail | Skip | Notes |
|---|---|---|---|---|---|

### Contract
- CONTRACT_DIFF: match <n> · frontend-fix <n> · backend-fix <n> · decision-needed <n> · deferred <n>
- CONTRACT_CHANGES entries added: <ids>

### Decisions needed from the human
1. <question> — options A/B — my recommendation and why

### Policies defaulted (pending KPMPL)
- <policy>: <default> (brief §11 ref)

### Risks / known gaps
- <item> — impact — mitigation

### Next phase plan
- <3–6 bullets>
```
