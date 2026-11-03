# KPMPL Gate-to-Bill — Web Frontend v0.6.0 (backend-ready)

**Developed by:** PRAVAHAx Systems Engineering · **Client:** Kaygaon Paper Mills Pvt. Ltd. (KPMPL)
**Contract:** `KPMPL_Backend_Build_Brief.md` §3 (conventions), §4 (roles), §5 (endpoints), §8 (security), §10 (switch-over).
**Status:** Not KPMPL-approved. Every business rule that KPMPL has not decided is labelled "pending KPMPL confirmation" in the UI.

> The default build is the **mock / demo** prototype: synthetic data in the browser, no server, no DataMan.
> The same code switches to the real backend with `VITE_API_MODE=http`. Nothing calculates QC deductions,
> sends messages, or writes to DataMan. The final QC decision is recorded by the QC Operator (KPMPL decision D-03, 2026-11-03).

---

## 1. What changed in v0.6.0

Backend switch-over per brief §10. Mock/demo mode stays the default and behaves as in v0.5.0. The v0.5 visual design is unchanged.

| Area | Change |
|---|---|
| Config | `src/configSchema.ts` + `src/config.ts`: `VITE_API_MODE` (mock\|http), `VITE_APP_MODE` (demo\|production), `VITE_API_BASE_URL` (default `/api/v1`), `VITE_API_TIMEOUT_MS`. Validated in `vite.config.ts` (the build fails) **and** at page load (the app shows a configuration-error page instead of starting). `production` requires `http`. |
| Dev proxy | Vite dev and preview servers proxy `/api` → `VITE_PROXY_TARGET` (default `http://localhost:3000`), so the session cookie is first-party. |
| HTTP adapter | Rewritten to brief §3/§5: `credentials: 'include'`, `X-Requested-With: kpmpl-web`, UUID v4 `Idempotency-Key` on every write except login and logout, `If-Match: <version>`, strict `{data}`/`{error}` parsing, typed error mapping, 401 → session-expired flow, AbortController timeout, a single retry for GETs only, multipart upload, file content URL, server CSV. |
| API interface | `changePassword`, `adminResetPassword`, `exportReceivingCsv`, `fileContentUrl`; `updateUser` now takes an idempotency key; `createUser` returns `temporaryPassword`; `attachFile` takes a real `File`. The mock adapter implements all of them. |
| Screens | **Change password** (header account menu → Change password; forced while the server flags `mustChangePassword`). **Users & Access**: Reset password with a one-time temporary password and a Copy button (it falls back to selecting the text). New users get a one-time temporary password too. **Login**: a "Your session has ended" message, and the user returns to the route they were on. |
| Production mode | The demo strip, Demo tools and demo account picker are hidden when `APP_MODE=production` and are **compiled out** of http/production bundles: no fixtures, no mock adapter, no demo tools (CI checks this). |
| PDF viewer | http mode loads `GET /api/v1/document-files/{id}/content` (same origin, the server authorises). Mock mode keeps in-tab blob URLs. |
| CSV | http: `GET /api/v1/reports/receiving.csv`. Mock: the same v0.5 columns, built in the browser. |
| Quality | TypeScript strict + `noUncheckedIndexedAccess`; ESLint 9 (typescript-eslint type-checked + react-hooks + react-refresh); Prettier; Vitest (71 unit tests: http adapter, config, redirect guard). |
| Delivery | `Dockerfile` (Node build → unprivileged nginx), `nginx.conf` (SPA fallback, security headers, `/api` reverse proxy via `BACKEND_UPSTREAM`), `.github/workflows/frontend-ci.yml`. |

---

## 2. Quick start

Requires Node.js ≥ 20.19 (tested on 22) and npm.

```bash
npm ci
npm run dev              # mock + demo → http://localhost:5173 (no server needed)
```

Demo accounts in mock mode: `demo-gate`, `demo-qc`, `demo-docs`, `demo-ho`, `demo-admin`. The password is `demo` (mock only). Each one lands on its role's start page.

### Against a local backend

```bash
cp .env.development.example .env.development.local   # VITE_API_MODE=http, proxy → localhost:3000
npm run dev                                          # browser → :5173, /api → backend
```

The backend must:
- allow Origin `http://localhost:5173` for writes (brief §3 CSRF Origin check);
- seed the demo users (brief §9).

`__Host-` cookies require `Secure`. Chrome and Firefox accept Secure cookies on `http://localhost`; Safari does not, so use HTTPS there.

### Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Vite dev server with the `/api` proxy |
| `npm run typecheck` | `tsc` for app (`tsconfig.json`) and build files (`tsconfig.node.json`) |
| `npm run lint` | ESLint (errors fail; warnings reported). `lint:strict` also fails on warnings |
| `npm run format` / `format:check` | Prettier write / check |
| `npm run test` | Vitest unit tests (`src/**/*.test.ts`) |
| `npm run build` | typecheck + production build into `dist/` (uses the current env) |
| `npm run build:preview` | single self-contained `dist/index.html`, always mock + demo (review link) |
| `npm run ci` | typecheck → lint → test → build |

---

## 3. Environment variables

All are read at **build/dev time** by Vite and end up in the bundle, so none of them may hold a secret.

| Variable | Values | Default | Notes |
|---|---|---|---|
| `VITE_API_MODE` | `mock` \| `http` | `mock` | Exact value; anything else fails the build and the page load |
| `VITE_APP_MODE` | `demo` \| `production` | `demo` (mock), `production` (http) | `production` + `mock` is rejected |
| `VITE_API_BASE_URL` | path or URL | `/api/v1` | Must start with `/` or be http(s). In production an absolute URL must be `https` (localhost excepted). Trailing slash stripped |
| `VITE_API_TIMEOUT_MS` | 1000–300000 | `20000` | JSON calls; uploads get 6×, CSV 3× |
| `VITE_PROXY_TARGET` | URL | `http://localhost:3000` | Dev/preview proxy target only; not in the bundle |
| `BACKEND_UPSTREAM` | URL | `http://backend:3000` | **Runtime** env of the nginx container (Docker), not Vite |

Files: `.env.example` (all keys documented), `.env.development.example` (local http + demo), `.env.production.example` (http + production).

### Modes

| `API_MODE` / `APP_MODE` | Use | Demo strip | Demo tools | Demo account picker |
|---|---|---|---|---|
| mock / demo (default) | offline demo, review preview | yes ("data is kept in this tab only") | yes | yes, one click signs in |
| http / demo | staging with the backend's demo seed | yes ("demo server") | no | yes, fills the username only (the password is the server's `DEMO_PASSWORD`) |
| http / production | production | no | no (not in bundle) | no (not in bundle) |
| mock / production | **rejected** | — | — | — |

---

## 4. Production deploy (single origin)

```bash
docker build -t kpmpl-frontend:0.6.0 .                 # build args default to http + production + /api/v1
docker run -p 8080:8080 -e BACKEND_UPSTREAM=http://backend:3000 kpmpl-frontend:0.6.0
```

- One origin for the SPA and `/api`. The nginx container serves `dist/` with an SPA fallback and reverse-proxies `/api/` to `BACKEND_UPSTREAM` unchanged (the backend serves `/api/v1/*`). Cookies stay first-party, CORS is not needed, and the PDF viewer can frame the file content endpoint.
- **HTTPS is mandatory.** Terminate TLS at the load balancer or ingress in front of the container. If it is behind a proxy, enable the commented `set_real_ip_from` lines in `nginx.conf` so login rate limits see real client IPs.
- The image runs as non-root (`nginxinc/nginx-unprivileged`, port 8080) with a health check at `/nginx-health`. Backend health is the backend's own `/healthz` and `/readyz`.
- SPA security headers (`nginx-security-headers.conf`):
  - CSP: `default-src 'self'`, `script-src 'self'`, `connect-src 'self'`, `frame-src 'self' blob:`, `object-src 'none'`, `frame-ancestors 'none'`;
  - HSTS, `nosniff`, `X-Frame-Options DENY`, `Referrer-Policy same-origin`, `Permissions-Policy`, COOP/CORP.
  - `/api` responses keep the backend's headers (Helmet, `Cache-Control: no-store`) plus HSTS.
- nginx extras:
  - `client_max_body_size 11m` (10 MB PDFs plus multipart overhead);
  - login limited to 10/min per IP as defence in depth (the backend enforces 5/min per IP+username);
  - an `X-Request-Id` is forwarded or generated.
- Build args: `VITE_API_MODE`, `VITE_APP_MODE`, `VITE_API_BASE_URL`, `VITE_API_TIMEOUT_MS`. For a staging image with the demo picker, pass `--build-arg VITE_APP_MODE=demo`.

---

## 5. Endpoint table (what `src/api/http/httpAdapter.ts` calls)

Base `/api/v1`. **IK** = `Idempotency-Key: <uuid v4>`. **IM** = `If-Match: <integer version>`. Every request sends `X-Requested-With: kpmpl-web`, `Accept: application/json` (CSV: `text/csv`) and `credentials: 'include'`. Success bodies are `{ "data": ... }`; errors are `{ "error": { code, message, fields, requestId, meta } }`.

| # | Adapter method | Method & path | Headers | Body → response `data` | Brief |
|---|---|---|---|---|---|
| 1 | `login` | `POST /auth/login` | — | `{username,password}` → `User` (sets `__Host-kpmpl_sid`) | 5.1 |
| 2 | `me` | `GET /auth/me` | — | → `User` (401 ⇒ `null`) | 5.1 |
| 3 | `logout` | `POST /auth/logout` | — | → 204 | 5.1 |
| 4 | `changePassword` | `POST /auth/change-password` | IK | `{currentPassword,newPassword}` → any 2xx | 5.6 |
| 5 | `listVisits` | `GET /receiving-visits?search=&qcStatus=a&qcStatus=b&exitStatus=&grnStatus=&page=&pageSize=` | — | → `Page<ReceivingVisit>` | 5.2 |
| 6 | `getVisit` | `GET /receiving-visits/{id}` | — | → `ReceivingVisit` | 5.2 |
| 7 | `createVisit` | `POST /receiving-visits` | IK | `CreateReceivingVisitInput` → 201 `ReceivingVisit` | 5.2 |
| 8 | `correctVisit` | `PATCH /receiving-visits/{id}` | IK IM | `CorrectVisitInput` → `ReceivingVisit` | 5.2 |
| 9 | `getTimeline` | `GET /receiving-visits/{id}/timeline` | — | → `TimelineEvent[]` | 5.2 |
| 10 | `getReferenceData` | `GET /reference-data/receiving` | — | → `{suppliers,materials}` | 5.2 |
| 11 | `recordTare` | `POST /receiving-visits/{id}/weighments` | IK IM | `{kind:'tare',value,unit:'kg',correctionReason?}` → `ReceivingVisit` | 5.3 |
| 12 | `recordExit` | `POST /receiving-visits/{id}/exit` | IK IM | `{physicalExitAt,remarks?,millChecksConfirmed}` → `ReceivingVisit` | 5.3 |
| 13 | `recordGrn` | `POST /receiving-visits/{id}/grn-links` | IK IM | `{officialGrnRef,verifiedInDataManByStaff,correctionReason?}` → `ReceivingVisit` | 5.3 |
| 14 | `getQcQueue` | `GET /qc/queue` | — | → `QcQueueItem[]` | 5.4 |
| 15 | `getQcInspection` | `GET /receiving-visits/{id}/qc-inspections` | — | → `QcInspection[]` (0 or 1; UI reads `[0]`) | 5.4 |
| 16 | `submitQc` | `POST /receiving-visits/{id}/qc-inspections` | IK IM(**visit**) | `QcSubmitInput` → `QcInspection` | 5.4 |
| 17 | — | ~~`GET /qc/review-queue`~~ removed 2026-11-03 (D-03): `getQcQueue` lists submitted rows awaiting the QC operator's decision | — | — | 5.4 |
| 18 | `decideQc` | `GET …/qc-inspections` then `POST /qc-inspections/{inspectionId}/decisions` (`qc.decide`, QC operator) | IK IM(**visit**) | `{outcome,reason}` → `QcInspection` | 5.4 |
| 19 | `getOverview` | `GET /reports/overview` | — | → `OverviewData` | 5.5 |
| 20 | `exportReceivingCsv` | `GET /reports/receiving.csv?from=&to=` | Accept `text/csv` | → CSV body; filename from `Content-Disposition` | 5.5 |
| 21 | `listUsers` | `GET /admin/users` | — | → `User[]` | 5.6 |
| 22 | `createUser` | `POST /admin/users` | IK | `{username,displayName,roles}` → `User & {temporaryPassword}` | 5.6 |
| 23 | `updateUser` | `PATCH /admin/users/{id}` | IK | `{displayName?,roles?,active?}` → `User` | 5.6 (+§3 IK rule) |
| 24 | `adminResetPassword` | `POST /admin/users/{id}/reset-password` | IK | — → `{temporaryPassword}` | 5.6 |
| 25 | `listPackages('gate')` | `GET /document-packages` | — | → `DocumentPackageView[]` | 5.7 |
| 26 | `listPackages('ho')` | `GET /head-office/cases` | — | → `DocumentPackageView[]` | 5.8 |
| 27 | `getPackage` | `GET /document-packages/{id}` | — | → `DocumentPackageView` | 5.7 |
| 28 | `createPackage` | `POST /document-packages` | IK | `{visitIds,invoiceRef?}` → 201 view | 5.7 |
| 29 | `updatePackage` | `PATCH /document-packages/{id}` | IK IM | `{visitIds?,invoiceRef?}` → view | 5.7 |
| 30 | `attachFile` | `POST /document-packages/{id}/files` | IK IM | **multipart/form-data**: `category`, `file` → view | 5.7, 5.9 |
| 31 | `removeFile` | `DELETE /document-packages/{id}/files/{fileId}?category=` | IK IM | → view | 5.7 |
| 32 | `setNotApplicable` | `PUT /document-packages/{id}/items/{category}/applicability` | IK IM | `{notApplicableReason: string\|null}` → view | 5.7 |
| 33 | `packageAction` | `POST /document-packages/{id}/actions` | IK IM | `PackageAction` (`mark_ready`, `back_to_draft`, `submit_to_ho`, `start_review`, `request_correction`, `verify`) → view | 5.7 |
| 34 | `fileContentUrl` | `GET /document-files/{fileId}/content` (iframe `src`) | cookie only | → PDF stream | 5.7 |
| 35 | `hoCheckItem` | `POST /head-office/reviews` | IK IM(package) | `{packageId,category,check,note}` → view | 5.8 |
| 36 | `recordErpMilestone` | `POST /head-office/cases/{id}/erp-milestones` | IK IM | `ErpMilestoneInput` (a reverse sends its reason in `note`) → view | 5.8 |
| 37 | `sendReminder` | `POST /head-office/cases/{id}/reminders` | IK IM | `{note}` → view | 5.8 |

**Not called by the frontend (yet):** `GET /config/policies` (brief §7; pending rules are labelled statically in the UI), `GET /healthz`, `GET /readyz`, `GET /api/v1/docs`.

### Error mapping (`ApiError.code`)

The server's `error.code` is used when it is one of: `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `VALIDATION_FAILED`, `DUPLICATE_CANDIDATE`, `VERSION_CONFLICT`, `DOMAIN_RULE`, `SERVER_ERROR`. Otherwise the HTTP status decides:

| Status | Code |
|---|---|
| 401 | `UNAUTHENTICATED` |
| 403 | `FORBIDDEN` |
| 404 | `NOT_FOUND` |
| 409 | `VERSION_CONFLICT` |
| 400, 413, 422 | `VALIDATION_FAILED` (413 adds `fields.file`) |
| 429 | `DOMAIN_RULE` ("Too many attempts…") |
| 502, 503, 504, fetch failure, timeout | `NETWORK_UNAVAILABLE` (a timeout sets `meta.timeout`) |
| other | `SERVER_ERROR` |

A 2xx body without `data`, or a body that is not JSON (e.g. `index.html` from a misrouted proxy), is a `SERVER_ERROR`. `requestId` comes from the envelope or the `X-Request-Id` header.

### Session expiry

A 401 on any call except `login`, `me`, `logout` emits a session-expired event. The app then:
1. clears the user;
2. redirects to `/login`, keeping the route;
3. shows "Your session has ended";
4. returns the user to that route after sign-in.

For `change-password`, a 401 is checked with `GET /auth/me`. If the session is alive, the 401 is shown as a "Current password is incorrect" field error.

### Retries and idempotency

- Screens create one key per logical write and reuse it on a manual retry (`useWrite`). The server replays the original response.
- The adapter retries **GETs once** on a network failure. It **never** retries writes.
- A timed-out write tells the user it may or may not have saved, and that repeating it is safe.

---

## 6. Security notes

- **No tokens in JS storage.** The session is the server's `__Host-kpmpl_sid` cookie (`HttpOnly; Secure; SameSite=Lax; Path=/`, brief §8). The frontend never reads it.
  - The `__Host-` prefix needs **HTTPS** and a single origin; serve SPA and API from one host (nginx above or the Vite proxy in dev).
  - `localStorage` / `window.name` are used **only by the mock adapter** for synthetic demo data.
- **CSRF:** every request sends `X-Requested-With: kpmpl-web` and the browser sends `Origin`. The backend must reject writes that lack the header or come from an Origin outside its allowlist.
- **The backend enforces every permission.** `src/auth/permissions.ts` only hides navigation. A hidden button is not access control (KPM-NFR-001/003).
- **No secrets in the bundle.** Every `VITE_*` value is public. Production bundles contain no demo fixtures, mock adapter or demo tools; CI greps for them.
- **Uploads:** the UI accepts PDFs up to 10 MB as a guide only. The server is authoritative: `%PDF-` magic bytes, size, ClamAV scan, private bucket.
- **Return paths** after login accept only in-app paths. `//host`, backslashes and absolute URLs are rejected (react-router 6 advisory GHSA-wrjc-x8rr-h8h6).
- **Temporary passwords** are shown once, held only in React state, and are never logged or stored.

---

## 7. Open contract points for the integrator

Resolved against the aligned backend in Phase 1 (see the backend's `docs/CONTRACT_CHANGES.md`);
kept as the record of what each point meant:
1. **Resolved:** `mustChangePassword` is a top-level optional `User` field on `login`, `me` and admin responses; absent = false.
2. **Resolved:** change-password answers `200 {data:{changed:true}}`; a wrong current password is a 401, which the adapter converts to a `currentPassword` field error. The route consumes `Idempotency-Key` like every write.
3. **Resolved:** `PATCH /admin/users/{id}` both sends and requires `Idempotency-Key` (§3 wins).
4. **Resolved:** every `ErpMilestone` carries `source: 'manual_staff_confirmation'` (brief §6); the legacy `staff_confirmed` value is still accepted by the type.
5. **Resolved:** reversing keeps sending the reason in `note` with `verifiedInDataManByStaff:false`; the server stores it as `reversalReason`.
6. **Resolved:** deactivated users get 401 (brief wins; the login page handles both).
7. **Resolved:** 429 (`RATE_LIMITED`, "Too many attempts. Wait a minute and try again.") and 413 (mapped to `VALIDATION_FAILED` with `fields.file`) both carry the full envelope.
8. **Resolved:** CSV is served with `Content-Disposition: attachment; filename="receiving.csv"` and the exact 14 columns of `RECEIVING_CSV_COLUMNS`. The UI still does not send `from`/`to`.
9. **Resolved (accepted):** lists fetch up to `pageSize=500` (the brief's maximum); the status tiles use the new `qcStatus`/`exitStatus`/`grnStatus` query filters server-side. Above 500 visits a paged UI would still be needed (accepted for now; revisit if KPMPL expects larger volumes).

Contract drift guard: `src/api/contract/` holds a generated copy of the backend's
OpenAPI document and a Vitest suite that validates the mock fixtures (the exact
objects the UI renders) against it. Regenerate the copy whenever the backend
contract changes.

---

## 8. Tests

- `npm run test`: 79 Vitest unit tests.
  - **http adapter** (48): envelope parsing, error mapping, headers, IK/If-Match, UUID generation, multipart, file URL, CSV, 401 handling, timeout, retry policy.
  - **config** (11).
  - **return-path guard** (12).
  - **contract** (8): the mock fixtures validated against the generated backend OpenAPI copy in `src/api/contract/`.
- jsdom UI tests on the single-file preview live outside this repo, in the project's `work/tests`: `ui.cjs`, `repro.cjs`, `reload.cjs`, and `v06.cjs` (reset password → forced change → sign-in; one-time password and copy fallback; session-expired return).

---

## 9. Architecture

```
src/
  configSchema.ts / config.ts   env parsing + validation (build and runtime)
  api/
    ReceivingApi.ts             the ONLY UI↔data boundary
    http/httpAdapter.ts         real backend (brief §3/§5); createHttpAdapter() is injectable for tests
    mock/                       synthetic adapter + fixtures; permissions, validation, idempotency, versions
    index.ts                    picks the adapter at build time (unused one is tree-shaken)
    errors.ts                   ApiError + consistent user wording
  auth/                         AuthContext (+ session-expired), guards, permissions (UI only), demo accounts
  domain/                       types, decimal strings, status labels
  components/                   ui/ and layout/ (paper/ink, IBM Plex, ruled; SafeForm instead of bare forms)
  features/                     account/ admin/ auth/ documents/ followup/ gate/ ho/ overview/ qc/ receiving/
```

Rules kept from v0.2–v0.5:
- QC, exit and GRN are separate status domains.
- Official references are opaque strings.
- Weights are decimal strings, and net is derived only for display.
- No deduction is computed. QC outcomes are real decisions recorded by the QC Operator on the inspection screen after the readings are submitted (D-03, decided 2026-11-03).
- Every write carries an idempotency key and the expected version.
- A failed save never shows success.
- Unsaved-change guards; prototype assumptions are labelled in the UI.

## Changelog

- **0.6.0** (2 Nov 2026): backend-ready switch-over (above).
- **0.5.0**: print-style redesign (paper/ink, IBM Plex, ruled tables, Demo tools in the ink strip).
- **0.4.0**: visual refresh.
- **0.3.0 / 0.2.x**: Module 2 (documents, Head Office, ERP milestones) and full Module 1 on synthetic data.
