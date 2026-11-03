# CONTRACT_DIFF — Phase 0 audit

**Date:** 2026-11-02
**Scope:** every call in `frontend/kpmpl-frontend/src/api/http/httpAdapter.ts` (README §5, 37 rows) compared against the backend routes and the normative `KPMPL_Backend_Build_Brief.md`.
**Rule:** Phase 0 was a read-only audit. **Phase 1 update:** every backend-fix row has been implemented and every decision resolved with the human-approved option A; all rows now read `match` (resolution notes inline). Evidence: `docs/CONTRACT_CHANGES.md` (row → before/after/why/test) and the live HTTP tests in `apps/api/test/` (48/48 passing with live dependencies).
**Frontend paths** are relative to `kpmpl/frontend/kpmpl-frontend/`; **backend paths** are relative to `kpmpl/backend/`.

**Method / evidence:** both repos imported untouched and committed (`chore: import v0.6.0 frontend` = `4e8d212`, `chore: import backend` = `25fd076`); frontend suite run in full; backend lint/typecheck/unit run, then the full suite re-run with `REQUIRE_LIVE_DEPENDENCIES=true` against the repo's own `docker-compose.yml` services (Postgres, Redis, MinIO, ClamAV — all healthy); routes derived from code (the API boots only with a full env, so the route list below comes from controller sources and the shipped `packages/contracts/openapi/openapi.yaml`, 37 paths). Line numbers refer to the files as imported.

## Update 2026-11-03 — client decision D-03: the QC operator decides

**Decision (Kaygaon Paper Mills, 2026-11-03):** there is no separate QC decision role. The QC operator (role `qc`, demo user `demo-qc`) records the readings **and** makes the final QC decision (accept / accept with deduction / return for correction / reject). Brief open decision D-03 ("who decides QC outcomes") is resolved = QC operator.

| Area | Before | After |
|---|---|---|
| Roles (brief §4) | 6 codes incl. `qc_reviewer` | 5 codes: `gate, gate_doc, qc, ho, admin` |
| Decision capability | `qc.review.demo` (demonstration only) on `qc_reviewer` | `qc.decide` on `qc` (capability count stays 14) |
| Separation of duties | readings and decision held by different roles | none: the same QC operator who submitted may decide |
| `GET /qc/review-queue` | separate decision queue | **removed**; `GET /qc/queue` already lists `submitted` rows (= awaiting decision) |
| `POST /qc-inspections/{inspectionId}/decisions` | `qc.review.demo` · IK · IM(visit) | `qc.decide` · IK · IM(visit) — idempotency, If-Match, CSRF and audit unchanged |
| `QcReviewNote.demonstrationOnly` | `const: true` | `boolean`: `false` on new decisions, `true` kept on pre-decision history |
| Timeline wording | "QC accepted (demonstration only)" etc. | "QC accepted" etc.; immutable pre-decision audit rows (flagged `demonstrationOnly`) still render with "(demonstration only)" |
| `GET /config/policies` | `qcReviewEnabled` (demonstration_only) | `qcDecisionBy: { value: 'qc_operator', decision: 'D-03', status: 'decided' }` |
| `GET /platform/features` | `qcDecisions: false` | `qcDecisions: true` |
| `QC_REVIEW_ENABLED` env | gated the demo review | retired; still accepted if set, ignored |
| Demo seed | 6 users | 5 users (`demo-gate, demo-qc, demo-docs, demo-ho, demo-admin`) |
| DB | — | migration `20261103090000_qc_operator_decides`: renames capability `qc.review.demo` → `qc.decide`, grants it to `qc` (and the historical `qc_operator` row), drops it from any other role, deletes the `qc_reviewer` role with its grants and assignments, revokes `demo-review` sessions and deletes the user when nothing references it, otherwise deactivates it (history and the hash-chained AuditEvent stay intact), sets `QCReview.demonstrationOnly` default to false |
| Frontend | separate review queue/screen + nav, `demo-review` login | decision card on the QC inspection screen after submit; queue tab "Awaiting decision"; reviewer role, routes, nav and demo login removed |

Unchanged: exit eligibility (D-04: tare + QC submitted + mill checks), wire names `reviews[]` / `QcReviewNote` / `awaitingReview` and the `QCReview` table (they now hold the QC operator's decisions; renaming them would be a breaking wire/DB change with no behavioural gain).

---

## Appendix A — 0.1 inventory

```
kpmpl/
  frontend/kpmpl-frontend/   ← kpmpl-frontend-v0.6.0.zip (npm, package-lock.json)
  backend/                   ← Backend Module.zip (pnpm@10.15.0 workspace + turbo)
  brief/KPMPL_Backend_Build_Brief.md
```

| Item | Frontend | Backend |
|---|---|---|
| Package manager | npm 11.14.1 (lockfile) | pnpm 10.15.0 (workspace + turbo 2.x) |
| Node | engines ≥ 20.19 (host: 24.19.0) | engines ≥ 24.0.0 (host: 24.19.0) |
| Framework | React 18.3 + Vite 6 + TS 5.6 strict | NestJS **11** (Fastify adapter) + TS 5.7 strict |
| ORM / DB | — | Prisma **6** / PostgreSQL (compose: **17**-alpine; brief says 16) |
| Storage / scan / cache | — | MinIO (S3 SDK), ClamAV (raw INSTREAM), Redis 7 |
| Auth | cookie only (`credentials:'include'`) | server-side `Session` table + argon2id; Bearer option for mobile |
| Validation | — | Zod 4 schemas per route (`.strict()`) |
| Tests | Vitest (71 unit) | Vitest (10 files; 5 e2e gated behind `REQUIRE_LIVE_DEPENDENCIES=true`) |

Key artefact locations: routes = `apps/api/src/modules/*/[a-z]*.controller.ts`; Zod DTOs = `receiving.schemas.ts`, `document.schemas.ts`, `qc.service.ts` (`qcSubmissionSchema`), `movement.service.ts` (`exitSchema`/`grnSchema`), `auth.controller.ts` (login/change-password); guards = `identity-access/auth.guard.ts` + `access.decorators.ts` + `policy.ts` (capability matrix); error filter = `modules/common/http-error.filter.ts`; envelope = hand-written per controller (`{data}`), no interceptor; idempotency = `platform/idempotent-write.service.ts` (+ `identityWrite` in `auth.service.ts`); versioning = `receiving.repository.ts::claimVersion` / `documents.service.ts::claim` (integer `If-Match`); cookie/session = `auth.controller.ts::cookies` + `auth.service.ts`; CORS/CSRF/Helmet = `http.ts` + guard line 27; upload = `documents.controller.ts::upload` + `documents.service.ts::upload`; storage = `file-storage.service.ts`; ClamAV = `malware-scanner.service.ts`; CSV = `reports.service.ts::csv`; seed = **none** (`bootstrap.ts` = one-off 5-user demo bootstrap; no fixture seed); `docker-compose.yml` = postgres/redis/minio/clamav/api/web/caddy; `.env.example` present; OpenAPI = static `packages/contracts/openapi/openapi.yaml` served at `/api/v1/docs` (admin-only), **not** generated from code.

---

## Appendix B — 0.2 test runs (real output)

### Frontend — `npm ci && npm run typecheck && npm run lint && npm run test && npm run build && npm run build:preview`

| Step | Result |
|---|---|
| typecheck | clean (both tsconfigs) |
| lint | `✖ 6 problems (0 errors, 6 warnings)` — all `react-refresh/only-export-components` |
| test | `Test Files 3 passed (3)` · `Tests 71 passed (71)` (48 http adapter + 11 config + 12 redirect guard) |
| build | `✓ built in 2.40s` → `dist/` |
| build:preview | `✓ built` → single `dist/index.html` 613.14 kB; `preview: classic script OK, import.meta occurrences = 0` |

Exit code 0 for the whole chain.

### Backend — `pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm test`

| Step | Result |
|---|---|
| lint (`eslint .`) | 0 errors |
| typecheck (turbo, contracts + api) | `Tasks: 2 successful, 2 total` |
| test (default env) | `Test Files 6 passed | 4 skipped (10)` · `Tests 13 passed | 34 skipped (47)` · exit 0 — the 34 skips are the 5 e2e files gated on `REQUIRE_LIVE_DEPENDENCIES` |

### Backend with live dependencies (compose: postgres+redis+minio+clamav, all `healthy`; `prisma migrate deploy` → “No pending migrations to apply”)

```
REQUIRE_LIVE_DEPENDENCIES=true DATABASE_URL=postgresql://kpmpl:change-me@127.0.0.2:55432/kpmpl?schema=public REDIS_URL=redis://localhost:6379 S3_ENDPOINT=http://localhost:9000 pnpm test
→ Test Files  2 failed | 8 passed (10)
→ Tests  3 failed | 44 passed (47)        (exit 1)
```

Failures (exact, unmodified):

1. `test/health.e2e-spec.ts` → `AssertionError: {"status":"unavailable","checks":{"database":"up","redis":"up","storage":"down"}}: expected 503 to be 200`.
   **Root cause reproduced:** the bucket bootstrap in `file-storage.service.ts::ensure()` throws against the repo's own MinIO: `PutPublicAccessBlockCommand → MalformedXML` and `PutBucketEncryptionCommand → NotImplemented: Server side encryption specified but KMS is not configured`. Verified with a direct SDK repro (all four calls, step by step). Consequence: `readyz` storage is permanently `down` **and file uploads fail** with this stack (see diff row #132).
2. `test/health.e2e-spec.ts` → readyz verdict test, same storage cause.
3. `test/receiving.e2e-spec.ts` → `expected 200 to be 422` at `pageSize=101`. The test asserts a 100-row page cap; the code allows 500 and **the brief mandates 500** (§5.2), which the frontend also requests. The test contradicts the normative brief (see diff row #143).

Also recorded (environment, not repo): a direct `npx vitest` run needs `PORT=3000` because this machine exports `PORT=0`; through `pnpm test` it passes.

Coverage: not reported (no coverage script configured) — Definition-of-Done item “≥ 90 % lines on modules/*/domain” **not yet measured**.

Route inventory note (updated after a successful boot): the compose `api` service itself still cannot boot as shipped (`NODE_ENV=production` in `docker-compose.yml` vs `APP_MODE=demo` in `.env` → env-schema refusal; phantom `apps/web` build context — row #162). However the API **does boot standalone** against the compose dependencies with `NODE_ENV=development APP_MODE=demo PORT=3000 DATABASE_URL=postgresql://kpmpl:change-me@127.0.0.2:55432/kpmpl?schema=public REDIS_URL=redis://localhost:6379 S3_ENDPOINT=http://localhost:9000 node apps/api/dist/main.js`. Verified live: `GET /api/v1/healthz` → 200; `GET /api/v1/readyz` → 503 `{status:"unavailable",checks:{database:"up",redis:"up",storage:"down"}}` (confirms row #132); `GET /api/v1/docs` → 401 (exists, admin-only). The route list below therefore matches the running server's controllers; it was derived from controller sources cross-checked against the shipped `packages/contracts/openapi/openapi.yaml` (37 paths).

---

## 1. Path and method (all 37 adapter calls)

| # | Area | Frontend (file:line) | Backend (file:line) | Brief § | Status | Justification | Proposed change |
|---|---|---|---|---|---|---|---|
| 1 | login | httpAdapter.ts:212 `POST /auth/login` | auth.controller.ts:26 | 5.1 | match | public route, 200, sets cookie | — |
| 2 | me | httpAdapter.ts:213 `GET /auth/me` | auth.controller.ts:60 | 5.1 | match | | — |
| 3 | logout | httpAdapter.ts:221 `POST /auth/logout` → 204 | auth.controller.ts:65 `@HttpCode(204)` | 5.1 | match | clears cookie + revokes server-side | — |
| 4 | changePassword | httpAdapter.ts:228 `POST /auth/change-password` | auth.controller.ts:74 | 5.6 | match | path/method OK (see #110 for IK) | — |
| 5 | listVisits | httpAdapter.ts:246 `GET /receiving-visits?search=&qcStatus=*…` | receiving.controller.ts:20 | 5.2 | match | path OK (query handled in #142) | — |
| 6 | getVisit | httpAdapter.ts:247 `GET /receiving-visits/{id}` | receiving.controller.ts:22 | 5.2 | match | | — |
| 7 | createVisit | httpAdapter.ts:248 `POST /receiving-visits` | receiving.controller.ts:16 | 5.2 | match | 201 | — |
| 8 | correctVisit | httpAdapter.ts:249 `PATCH /receiving-visits/{id}` | receiving.controller.ts:24 | 5.2 | match | reads `If-Match` | — |
| 9 | getTimeline | httpAdapter.ts:250 `GET …/timeline` | receiving.controller.ts:26 | 5.2 | match | | — |
| 10 | getReferenceData | httpAdapter.ts:251 `GET /reference-data/receiving` | receiving.controller.ts:39 | 5.2 | match | | — |
| 11 | recordTare | httpAdapter.ts:254 `POST …/weighments` | receiving.controller.ts:30 | 5.3 | match | path OK (body/If-Match in #41) | — |
| 12 | recordExit | httpAdapter.ts:259 `POST …/exit` | movement.controller.ts:12 | 5.3 | match | path OK | — |
| 13 | recordGrn | httpAdapter.ts:260 `POST …/grn-links` | movement.controller.ts:16 | 5.3 | match | path OK | — |
| 14 | getQcQueue | httpAdapter.ts:263 `GET /qc/queue` | qc.controller.ts:11 | 5.4 | match | path OK (shape in #81) | — |
| 15 | getQcInspection | httpAdapter.ts:264 `GET …/qc-inspections` (array, reads `[0]`) | qc.controller.ts:13 | 5.4 | match | returns array (shape in #78) | — |
| 16 | submitQc | httpAdapter.ts:265 `POST …/qc-inspections` | qc.controller.ts:15 | 5.4 | match | path OK | — |
| 17 | **Superseded 2026-11-03 (D-03 entry above): route removed.** getQcReviewQueue | httpAdapter.ts:266 `GET /qc/review-queue` | **no route** | 5.4 | match | Route absent (grep of all controllers: no `review-queue`) | Add `GET /qc/review-queue` (`qc.review.demo`, `updatedAt ASC`, brief §5.4) with an HTTP test |
| 18 | **Updated 2026-11-03 (D-03): adapter call is now `decideQc`, capability `qc.decide`, held by the QC operator.** reviewQc | httpAdapter.ts:267 `POST /qc-inspections/{inspectionId}/decisions` (after GET inspection) | **no route** | 5.4 | match | Route absent → QC review flow impossible | Add decisions route (IK, If-Match = **visit** version, `{outcome, reason}`, `demonstrationOnly: true`) + test |
| 19 | getOverview | httpAdapter.ts:275 `GET /reports/overview` | reports.controller.ts:11 | 5.5 | match | path OK (shape in #84) | — |
| 20 | exportReceivingCsv | httpAdapter.ts:276 `GET /reports/receiving.csv?from=&to=` | reports.controller.ts:12 | 5.5 | match | path OK | — |
| 21 | listUsers | httpAdapter.ts:286 `GET /admin/users` | admin-users.controller.ts:19 | 5.6 | match | | — |
| 22 | createUser | httpAdapter.ts:287 `POST /admin/users` | admin-users.controller.ts:20 | 5.6 | match | | — |
| 23 | updateUser | httpAdapter.ts:288 `PATCH /admin/users/{id}` | admin-users.controller.ts:28 | 5.6 | match | consumes IK | — |
| 24 | adminResetPassword | httpAdapter.ts:289 `POST /admin/users/{id}/reset-password` | admin-users.controller.ts:35 | 5.6 | match | consumes IK, revokes sessions | — |
| 25 | listPackages('gate') | httpAdapter.ts:292 `GET /document-packages` | documents.controller.ts:18 | 5.7 | match | | — |
| 26 | listPackages('ho') | httpAdapter.ts:292 `GET /head-office/cases` | documents.controller.ts:27 | 5.8 | match | filters `HO_VISIBLE` | — |
| 27 | getPackage | httpAdapter.ts:293 `GET /document-packages/{id}` | documents.controller.ts:19 | 5.7 | match | HO 404 on non-HO_VISIBLE | — |
| 28 | createPackage | httpAdapter.ts:294 `POST /document-packages` | documents.controller.ts:20 | 5.7 | match | 201 | — |
| 29 | updatePackage | httpAdapter.ts:295 `PATCH /document-packages/{id}` | documents.controller.ts:21 | 5.7 | match | | — |
| 30 | attachFile | httpAdapter.ts:296 `POST …/files` multipart | documents.controller.ts:24 | 5.7/5.9 | match | reads `category` + `file`, If-Match | — |
| 31 | removeFile | httpAdapter.ts:302 `DELETE …/files/{fileId}?category=` | documents.controller.ts:25 | 5.7 | match | soft-delete | — |
| 32 | setNotApplicable | httpAdapter.ts:304 `PUT …/items/{category}/applicability` | documents.controller.ts:22 | 5.7 | match | | — |
| 33 | packageAction | httpAdapter.ts:306 `POST …/actions` (6 kinds) | documents.controller.ts:23 | 5.7 | match | discriminated union, per-kind caps | — |
| 34 | fileContentUrl | httpAdapter.ts:307 `GET /document-files/{fileId}/content` | documents.controller.ts:26 | 5.7 | match | | — |
| 35 | hoCheckItem | httpAdapter.ts:310 `POST /head-office/reviews` | documents.controller.ts:28 | 5.8 | match | | — |
| 36 | recordErpMilestone | httpAdapter.ts:312 `POST /head-office/cases/{id}/erp-milestones` | documents.controller.ts:29 | 5.8 | match | | — |
| 37 | sendReminder | httpAdapter.ts:313 `POST /head-office/cases/{id}/reminders` | documents.controller.ts:30 | 5.8 | match | | — |

Extra backend routes not called by the frontend: `POST /auth/refresh`, `GET /receiving-visits/{id}/weighments`, `GET /receiving-visits/{id}/grn-links`, `GET /identity/users`, `GET /audit/verification`, `GET /platform/features`, `GET /healthz|readyz|docs|config/policies`. Harmless read-only extras (noted in #176).

## 2. Request schemas (field names, optionality, enums, unknown-field handling)

| # | Area | Frontend (file:line) | Backend (file:line) | Brief § | Status | Justification | Proposed change |
|---|---|---|---|---|---|---|---|
| 38 | `CreateReceivingVisitInput.arrivedAt` | types.ts:85 (`arrivedAt?`), sent by NewReceivingPage.tsx:56 | receiving.schemas.ts:8 `createVisitSchema` has **no `arrivedAt`**, `.strict()` | 5.2, §6 | match | Filling “Arrival time” → 422 `fields.arrivedAt` (unknown key); no `arrived_at` column exists | Accept + store `arrivedAt`; return it in the visit snapshot; test |
| 39 | create: supplier/material optional | types.ts:82-83 (required in UI) | receiving.schemas.ts:9-10 `.optional()` | R-01 | match | R-01 makes both required; backend accepts visits without them (its own e2e asserts `supplierDisplayName: null` — that test encodes the deviation) | Make required per R-01; update the contradicting backend test with a CONTRACT_CHANGES entry |
| 40 | create max lengths | NewReceivingPage form (no client cap) | receiving.schemas.ts:8-11 → ref 64, vehicle 32, supplier/material 160 | R-01 (40/30/80/80) | match | Backend limits exceed the brief | Align to 40/30/80/80; add validation tests |
| 41 | `RecordTareInput` version | httpAdapter.ts:254-258 sends `{kind:'tare',value,unit:'kg',correctionReason?}` + **`If-Match` header** | receiving.schemas.ts:12 `recordWeightSchema` requires **`version` in the body**; controller never reads `If-Match` | 5.3, §3 | match | Every tare from the UI → 422 `fields.version`; If-Match semantics absent | Take the version from `If-Match`; drop body `version`; HTTP test asserting 201 with header-only version |
| 42 | tare `correctionReason` | types.ts:163 `correctionReason?`; sent on second tare | receiving.schemas.ts:12-16 knows only `correctsId`+`reason`; `.strict()` | 5.3, R-04 | match | Correcting a tare from the UI → 422 unknown key | Accept `correctionReason` (map to the stored reason) + test |
| 43 | tare unit enum | UI always `'kg'` | receiving.schemas.ts:14 `z.enum(['kg','mt'])` | §3 (kg) | match | Accepts `mt`, which the contract does not define | Restrict to `kg` (or document as decision if `mt` is wanted later) |
| 44 | `RecordExitInput` version | httpAdapter.ts:259 sends header only | movement.service.ts:9 `exitSchema` requires body `version` | 5.3, §3 | match | Every exit → 422 | Use `If-Match`; test |
| 45 | `millChecksConfirmed` | types.ts:171 required, always sent | movement.service.ts:9 — field absent, `.strict()` | R-05 | match | Exit body rejected (unknown key) **and** the R-05 rule “must be true” is not enforced | Accept + enforce the flag; test both failure modes |
| 46 | `physicalExitAt` optional on server | UI always sends | movement.service.ts:9 `.optional()` (defaults to now) | 5.3 | match | UI always sends it; no visible difference | — |
| 47 | exit time-range checks | — | movement.service.ts:12-20 | R-05 | match | No “≤ 5 min in the future / not before createdAt − 1 min” validation | Implement R-05 range checks + tests |
| 48 | `RecordGrnInput` version | httpAdapter.ts:260 header only | movement.service.ts:10 body `version` required | 5.3, §3 | match | Every GRN write → 422 | Use `If-Match`; test |
| 49 | GRN `correctionReason` | types.ts:176 `correctionReason?` | movement.service.ts:10 `.strict()`, no such key | 5.3 | match | GRN correction from the UI → 422 | Accept `correctionReason`; enforce “different value + reason” (R-06); test |
| 50 | GRN preconditions | — | movement.service.ts:21-27 | R-06 | match | No “tare must exist first”; no audit note when the same GRN appears on other visits | Implement R-06 checks + tests |
| 51 | `QcSubmitInput.intent` | types.ts:139 `'draft'\|'submit'` always sent | qc.service.ts:9 `qcSubmissionSchema` has no `intent`, `.strict()` | R-07 | match | Every QC save/submit → 422 unknown key; draft flow impossible | Accept `intent`; draft → `in_progress` (or keep `returned`), submit → `submitted`; tests |
| 52 | `revisionReason` | types.ts:138 sent as `revisionReason` | qc.service.ts:11 uses `reason` | R-07 | match | Resubmission-after-return reason rejected (unknown key) | Accept `revisionReason` (map to stored reason); require it when returning → resubmitting |
| 53 | QC `If-Match` | httpAdapter.ts:265 sends **visit** version header | qc.service.ts:10 requires body `version` | 5.4, §3 | match | Every QC write → 422 | Take visit version from `If-Match`; test that QC writes bump the visit version |
| 54 | measurements validation | types.ts:131-135 `unit:'percent'`, UI fixed-scale strings | qc.service.ts:13-14 value regex `^-?\d+(\.\d+)?$`, stored as `QCRevision.measurements Json` | §3, §6 | match | Percent not validated to `^\d{1,3}(\.\d{1,2})?$`, no fixed scale 2, negatives/floats accepted; §6 wants `NUMERIC(5,2)` rows | Add percent regex + scale normalisation (and, per §6, a `qc_measurement` table) with tests |
| 55 | QC `clearance` concept | not in contract; UI never sends it | qc.service.ts:10 `clearance: 'cleared'\|'hold'`; exit requires `qcClearance === 'cleared'` (movement.service.ts:16) | R-05, R-07, D-04 | match | Exit is gated on a state the brief does not have and the UI can never produce → the golden path M1 is unreachable; R-05 says returned/rejected QC must **not** block exit | Re-implement exit prerequisites as the brief’s `EXIT_REQUIRES` policy (tare + QC submitted + mill-checks); tests |
| 56 | **Updated 2026-11-03: frontend type renamed `QcDecisionInput`.** `QcReviewInput {outcome,reason}` | types.ts:146-149 | no schema/route (see #18) | 5.4, R-08 | match | Covered by #18 | — |
| 57 | `CreatePackageInput` | types.ts:244 `{visitIds, invoiceRef?}` | document.schemas.ts:6 | 5.7 | match | names/optionality match, `.strict()` | — |
| 58 | `UpdatePackageInput` | types.ts:245 `{visitIds?, invoiceRef?}` | document.schemas.ts:7 | 5.7 | match | | — |
| 59 | `PackageAction` (6 kinds) | types.ts:231-241 | document.schemas.ts:9-15 | 5.7 | match | all six kinds, matching field names incl. `confirmComplete: true`, `categories` min 1 | — |
| 60 | `back_to_draft.reason` | types.ts:233 | document.schemas.ts:10 accepted but **never persisted** (documents.service.ts `action()` stores only `kind`) | R-13 | match | R-13 requires the reason; it disappears (audit/history show nothing) | Persist the reason into history/audit; test |
| 61 | applicability reason length | UI free text | document.schemas.ts:8 max **500** | R-11 (max 300) | match | Brief caps 300 | Cap at 300; test |
| 62 | HO check `{packageId,category,check,note}` | httpAdapter.ts:310-311 | document.schemas.ts:16-17 | 5.8, R-16 | match | enum `ok\|issue\|unchecked`, issue ⇒ note | — |
| 63 | `ErpMilestoneInput` | types.ts:253-259 | document.schemas.ts:18 | 5.8 | match | reverse path accepts `verifiedInDataManByStaff:false` + reason in `note` | — |
| 64 | reminder `{note}` | httpAdapter.ts:313 | document.schemas.ts:19 (max 300) | 5.8, R-21 | match | | — |
| 65 | `CreateUserInput.roles` / update roles | types.ts:215-216 (brief codes only) | admin-users.controller.ts:11 `roleSchema = z.enum(roleCodes)` = **13 codes** (adds `qc_operator, qc_manager, gate_doc_authority, ho_accounts, plant_head, head_accounts, viewer`) | §4 | match (decision A: API restricted to the 6 brief codes; legacy rows remain in the DB only) | Brief §4 defines exactly 6 role codes; the API accepts 7 legacy/extra codes (needed today by `bootstrap.ts`) — visible if an admin API client assigns one | **A (recommended):** restrict the API to the 6 brief codes in Phase 1, migrate the demo bootstrap to brief codes, keep legacy rows for history. **B:** keep aliases until the thin-client transition ends, documented in CONTRACT_CHANGES |
| 66 | `UpdateUserInput` | types.ts:216 | admin-users.controller.ts:12 | 5.6 | match | optional fields match; empty body rejected | — |
| 67 | `ChangePasswordInput` | types.ts:221 `{currentPassword,newPassword}` | auth.controller.ts:20 min 10 | 5.6 | match | min 10 matches `MIN_PASSWORD_LENGTH` | — |
| 68 | breached-password list | — | password.service.ts:22-25 — 4 hardcoded strings | 5.6 | match | Brief requires a breached-password list; four entries are a stub (external calls are prohibited, so it must be a bundled offline list) | Bundle an offline common-password list (no network); test that a listed password is rejected |
| 69 | unknown-field handling | — | all schemas `.strict()` → 422 | §8 (“whitelist/strip”) | match (decision A: keep .strict() rejection — deviation from §8 strip wording recorded in CONTRACT_CHANGES) | Brief says strip unknown fields; backend rejects them. After Phase 1 the UI sends no unknown fields, so no visible difference — but strict rejection is what surfaced rows #38-#55 | **A (recommended):** keep `.strict()` (fails loud on drift) and record the deviation in CONTRACT_CHANGES. **B:** switch to strip to match §8 literally |
| 70 | unknown enum values | — | every `z.enum` rejects → 422 | §8 | match | unknown roles/categories/checks fail closed | — |

## 3. Response schemas

| # | Area | Frontend (file:line) | Backend (file:line) | Brief § | Status | Justification | Proposed change |
|---|---|---|---|---|---|---|---|
| 71 | `User` (+ `mustChangePassword`) | types.ts:18-31 | auth.service.ts:18-21 `userDto` | 5.1/5.6 | match | flat user, `mustChangePassword` top-level (README §7.1 resolved); extra `fullName/employeeCode/isActive` keys are harmless duplicates | — |
| 72 | **login response** | httpAdapter.ts:212 expects `data` = `User` | auth.controller.ts:32-36 returns `data = {csrfToken, accessToken, expiresInSec, user:{…}}` | 5.1 | match | `data.roles` is `undefined` → sign-in lands every role in the wrong place / crashes `can()`. **Highest-severity break** | Return `{data: userDto}` (strip tokens for the web client); HTTP test asserting the flat `User` |
| 73 | `ReceivingVisit.arrivedAt` | types.ts:93 | no column, no output | 5.2 | match | UI shows “Not recorded” always (cross-ref #38) | Add column + snapshot field |
| 74 | `ReceivingVisit.physicalExitAt` | types.ts:106 top-level | snapshot exposes nested `physicalExit.*` only (movement-read.service.ts:11-15) | 5.2 | match | Exit time never shown on visit/register/CSV | Map to top-level `physicalExitAt` |
| 75 | `ReceivingVisit.officialGrnRef` | types.ts:107 | not projected (GRN lives in `GRNReference`/`GRNLink`) | 5.2 | match | GRN column always empty | Map latest linked ref to top-level `officialGrnRef` |
| 76 | display names (`createdBy`, `submittedBy`, corrections `requestedBy`, reminders `recordedBy`, QC `recordedBy`) | types.ts:104, 237, 222, 227, 136 — all shown as names | receiving.service.ts:48 stores/returns `createdBy = userId`; documents.service.ts view returns raw user UUIDs | 5.2/5.8, §6 | match | “Entered by” and package history render raw UUIDs (visible on every visit detail + package) | Resolve to `app_user.display_name` as stored at event time (§6); tests |
| 77 | `qcStatus` values | types.ts:41-49 (`pending…rejected`, no `draft`) | receiving.service.ts:33 + qc-read.service.ts:22 default **`'draft'`**; only value ever produced by writes is `submitted` | 5.2, R-07/R-08 | match | Unknown label in UI; `returned/accepted/…` states unreachable (no review module) | Default `pending`; implement the QC state machine (R-07/R-08); label test |
| 78 | `QcInspection` | types.ts:136-143 `{inspectionId, visitId, qcStatus, revisions, reviews, deductionCalculation}` | qc-read.service.ts:25-29 returns raw rows `{id, visitId, qcStatus, currentRevisionId, revisions[…]}` + top-level `deductionCalculation` outside `data` | 5.4 | match | `inspectionId` undefined → `reviewQc` cannot build its URL; `reviews` missing; `deductionCalculation` not inside the payload | Map to the brief shape; HTTP test |
| 79 | `QcRevision` | types.ts:124-134 `{revision, state, …, revisionReason, recordedBy, recordedAt}` | qc-read.service.ts:27 raw `{revisionNo, clearance, measurements, remarks, reason, submittedBy(userId), …}` | 5.4 | match | Field names + actor name + `state` all wrong → QC history renders blank/mislabelled | Map fields, resolve display names; test |
| 80 | **Updated 2026-11-03: these are the QC operator's decision records; `demonstrationOnly` is now boolean (false for new records).** `QcReviewNote` | types.ts:126-133 `reviews[]` | **no `qc_review` model, no review storage** | 5.4, R-08 | match | Reviews can neither be stored nor shown | Add `qc_review` table + decisions route (#18); tests |
| 81 | `QcQueueItem` | types.ts:144-148 `{visit, latestRevision, lastReturnReason}` | qc.controller.ts:11 returns the paged visit list (`receiving.list`) | 5.4 | match | `getQcQueue()` receives `{data,page,…}` instead of an array → `.map` crash on the QC queue screen | Return `QcQueueItem[]` (oldest first, statuses `pending,in_progress,returned,submitted`); test |
| 82 | `TimelineEvent` shape | types.ts:154-160 | receiving.service.ts:101-104 | 5.2 | match | `{id, at, actor, action, detail?, source}` all present, newest first, actor resolved | — |
| 83 | timeline action wording | mock fixtures (e.g. fixtures.ts:155 “Package created”) | audit actions raw: `receiving_created`, `weight_recorded`, `qc_submitted`… | §3 (approved wording) | match | `Timeline.tsx:13` renders `{e.action}` verbatim → users see snake_case identifiers | Emit the mock’s human sentences (or map at write time); snapshot test |
| 84 | `OverviewData` | types.ts:175-191 (`receiving/qc/gate/documents/erp` counters + 3 visit lists) | reports.service.ts:19 returns `{timezone, generatedAt, counters:{visitsToday, onPremises, qcPending, packagesAtGate, packagesAtHo, verifiedPackages}}` | 5.5 (“exactly as the mock getOverview()”) | match | Overview screen reads `receiving.total` etc. → every counter undefined | Compute the full `OverviewData` shape in SQL; contract test against the type |
| 85 | `DocumentItem.state` | types.ts:205 `'missing'\|'attached'\|'not_applicable'` | documents.service.ts:37-41 view omits `state` | 5.7/5.8 | match | Checklist row status cannot be rendered | Derive `state` server-side; test the 6-row order |
| 86 | `DocumentFile` | types.ts:196-203 `{id,name,sizeBytes,mimeType,uploadedAt,uploadedBy,synthetic}` | documents.service.ts:38 `{id, category, originalName, size, sha256, scanStatus, uploadedAt}` | 5.7 | match | File name/size show blank in the checklist and the PDF viewer header | Map to the brief field names (+ `uploadedBy` display name, `synthetic:false`); test |
| 87 | `checklistVersion` | types.ts:234 `string` (`'demo-checklist-0 (not approved)'`) | schema.prisma:266 `Int @default(1)` | R-11 | match | Type mismatch (number vs string); brief pins the literal value | Store/return the brief string; test |
| 88 | `Reminder` | types.ts:222-227 `{id, recipient, note, sentBy, sentAt}` | documents.service.ts:44 `{…, packageId, note, recordedBy, recordedAt}` — no `recipient` | 5.8, R-21 | match | Reminder list fields don’t render; R-21 recipient label missing | Map names + set `recipient: 'Plant Head (recipient and channel pending, D-09)'`; test |
| 89 | `DocumentPackageView.visits` | types.ts:243 resolved `ReceivingVisit[]` | documents.service.ts:45 returns raw `ReceivingVisit` DB rows (no weights/qc/exit/grn/status fields) | 5.8 | match | Truck rows inside a package show no gross/tare/QC/exit/GRN status → package screens misleading | Reuse the visit snapshot projection for `visits`; test |
| 90 | `createUser → User & {temporaryPassword}` | types.ts:218 | auth.service.ts:167-171 | 5.6 | match | present, shown once | — |
| 91 | `reset-password → {temporaryPassword}` | types.ts:220 | auth.service.ts:197-204 | 5.6 | match | present (+ harmless user fields) | — |
| 92 | `change-password` response | README §7.2 accepts 204 or `{data}` | auth.controller.ts:74-81 → 200 `{data:{changed:true}}` | 5.6 | match | handled | — |

## 4. Envelope

| # | Area | Frontend (file:line) | Backend (file:line) | Brief § | Status | Justification | Proposed change |
|---|---|---|---|---|---|---|---|
| 93 | `{data}` on 2xx | httpAdapter.ts:176-184 requires it | every controller wraps manually | §3 | match | present everywhere (extra sibling keys like `exitEligibility`/`message` sit outside `data` and are ignored — the QC one is folded into #78) | — |
| 94 | paged double envelope | httpAdapter.ts:246 `Page<T>` = `data.data` | receiving.service.ts:87-89 returns `{data: rows, page, pageSize, total}` — **flat, not nested** | §3 | match | `page.data` is `undefined` in the UI → register, dashboards, follow-up, package pickers all break; also affects `/qc/queue` (#81) | Return `{data:{data,page,pageSize,total}}`; HTTP test |
| 95 | 204 logout | httpAdapter.ts:221-226 | auth.controller.ts:65 `@HttpCode(204)` no body | §3 | match | | — |
| 96 | error envelope on app errors | httpAdapter.ts:94-110 | http-error.filter.ts:10-21 | §3 | match | `{error:{code,message,fields,requestId,meta}}` for Zod/HttpException/guard errors; `requestId` = `X-Request-Id` (same `randomUUID`) | — |
| 97 | framework errors 400/413/415 (body-limit 100 KiB, malformed JSON, multipart too large) | README §5 fallbacks expect 422/413→`VALIDATION_FAILED` | **Verified live against the booted API:** the envelope **is** present on framework errors — malformed JSON → 400 `{"error":{"code":"SERVER_ERROR","message":"Body is not valid JSON but content-type is set to 'application/json'",…}}`; body >100 KiB → 413 `{"error":{"code":"SERVER_ERROR","message":"Request body is too large",…}}`; unknown path → 404 `{"error":{"code":"NOT_FOUND",…}}`. Gap: the 400/413 bodies carry `code:"SERVER_ERROR"` and raw Fastify wording instead of `VALIDATION_FAILED` (with `fields`) and approved user-facing text, so the UI shows "Something went wrong. Nothing was saved." for a too-large upload | §3 | match | Envelope structure is fine (this half of the row is resolved); the **code and message** on framework payload errors are wrong and the approved wording is lost. 11 MB multipart behaviour still to capture in Phase 1 (needs an authenticated session) | Map Fastify malformed-JSON / payload-too-large errors to `VALIDATION_FAILED` + approved message (413 keeps HTTP 413 per README §5) in the filter; tests for 400/413 |
| 98 | `readyz` 503 shape | frontend never calls it | http-error.filter.ts:14-17 deliberately passes readiness JSON through | §9 | match | machine-readable exception, documented | — |

## 5. Error codes

| # | Area | Frontend (file:line) | Backend (file:line) | Brief § | Status | Justification | Proposed change |
|---|---|---|---|---|---|---|---|
| 99 | 401 `UNAUTHENTICATED`; deactivated login = 401 | errors.ts:41; README §7.6 | auth.guard.ts:21, auth.service.ts:50, filter code map | §3, §4 | match | 401 for bad creds **and** deactivated (brief wins over mock’s 403; UI handles both) | — |
| 100 | login failure message | UI shows server message on login | auth.service.ts:50 `'Invalid credentials.'` — **confirmed live** (wrong-creds POST → 401 `{"error":{"code":"UNAUTHENTICATED","message":"Invalid credentials."}}`) | 5.1 | match | Brief pins “Username or password is incorrect.” (same for unknown user) | Use the brief’s exact string; test |
| 101 | 403 `FORBIDDEN` | errors.ts:39 `body = e.message` | guard/filter 403 | §3 | match | | — |
| 102 | 404 `NOT_FOUND` incl. “not visible to this role” | errors.ts:43 | HO draft → 404 (documents.service.ts:26-31), file content → 404 (documents.service.ts:186) | §3, §4 | match | existence not leaked | — |
| 103 | 422 `VALIDATION_FAILED`, `fields` = UI input names | httpAdapter.ts:101-106 | http-error.filter.ts:20 (Zod path = JSON key) | §3 | match | e.g. `grossWeight`, `officialGateEntryRef`, `reason` all map; `fields.version` only appears via the body-version bugs (#41/#44/#48/#53) and disappears once fixed | — |
| 104 | 409 `DUPLICATE_CANDIDATE` + `meta.existingId` | errors.ts:46-47 “Possible duplicate” + `e.message` | receiving.service.ts:46 (exact brief message + meta) | R-02 | match | message matches the brief/mock wording; also test-proven (`receiving.e2e-spec.ts`) | — |
| 105 | 409 `VERSION_CONFLICT` + `meta.currentVersion` | httpAdapter.ts:99-104 reads `meta` | repository.ts:12 + documents.service.ts:47 `conflict()` sends only `{code,message}` | §3 | match | `meta.currentVersion` missing (brief requires it; useful for reload logic) | Add `meta:{currentVersion}` on every version conflict; test |
| 106 | state rules → 422 `DOMAIN_RULE` | errors.ts default branch | movement.service.ts:15/18 and weighment.service.ts throw **409** with codes `EXIT_ALREADY_RECORDED`, `DEPARTURE_PREREQUISITES_MISSING`, `DEPARTURE_ALREADY_RECORDED`, `CONFLICT` (filter maps bare 409 → `CONFLICT`) | §3, R-04/R-05 | match | UI shows “Updated by someone else” for a business-rule block — wrong message and wrong code for “Record the tare first…” | Throw 422 `DOMAIN_RULE` with the brief’s sentence; tests |
| 107 | 500 `SERVER_ERROR` message | errors.ts:29 | filter line 18 | §3 | match | exact “Something went wrong. Nothing was saved.” | — |
| 108 | 429 body | httpAdapter.ts:67 maps 429 → `DOMAIN_RULE`, shows envelope message | rate-limit.service.ts:12/15 → code `RATE_LIMITED`, message “Too many requests. Try again later.” | §3 (429 not in table) | match | Envelope present and the fallback works, but the displayed wording differs from the frontend’s approved “Too many attempts. Wait a minute and try again.” (brief silent ⇒ prefer frontend behaviour, golden rule 2) | Keep code `RATE_LIMITED`; use the approved message; test |

## 6. Headers

| # | Area | Frontend (file:line) | Backend (file:line) | Brief § | Status | Justification | Proposed change |
|---|---|---|---|---|---|---|---|
| 109 | `Idempotency-Key` required on visit/package/HO/admin writes; replay; mismatch; 24 h; same transaction | httpAdapter.ts:148 | receiving/movement/qc/documents controllers parse `idempotencyKeySchema`; idempotent-write.service.ts:11-34 | §3 | match | replay returns stored body + `Idempotent-Replay: true`; mismatch → 422 “Idempotency key reused with different data” (exact); TTL 24 h; record written inside the tx; test-proven | — |
| 110 | IK on `POST /auth/change-password` | httpAdapter.ts:228 sends it | auth.controller.ts:74 never reads/requires it (ignored ⇒ accepted) | §3 (“every write except login/logout”) | match | Not *required* where the brief requires it | Require + store IK on change-password; test |
| 111 | IK excluded on login/logout | httpAdapter.ts:37 | controllers don’t parse it | §3 | match | | — |
| 112 | `If-Match` on `PATCH /receiving-visits/{id}` | httpAdapter.ts:249 header integer | receiving.controller.ts:24 + service checks integer ≥ 1 | §3 | match | missing/NaN → 422 `fields.version` | — |
| 113 | `If-Match` on all package/HO writes | httpAdapter.ts:295-313 | documents.controller.ts:21-30 `ifMatchSchema` (integer coerce) | §3, 5.7/5.8 | match | package version compared under `updateMany … version` (row-lock equivalent), bumps +1 | — |
| 114 | `If-Match` on weighments/exit/grn/QC | httpAdapter.ts:254-265 sends `If-Match: <visit version>` | controllers **ignore the header**; services demand `body.version` | §3 (“which version is checked”) | match | No optimistic locking as specified; combined with #41/#44/#48/#53 these four writes cannot succeed from the UI | Read `If-Match` in all four controllers, compare against the **visit** version, bump visit version; concurrency test (one 200 + one 409) |
| 115 | `X-Requested-With: kpmpl-web` on writes | httpAdapter.ts:144 | auth.guard.ts:27 (cookie-authenticated writes) | §3 | match | missing header or wrong Origin → 403; Bearer (future mobile) exempt — consistent with §3’s “frontend must send” | — |
| 116 | `X-Request-Id` echoed | httpAdapter.ts:106 (`requestId` fallback to header) | http.ts onSend + filter `requestId: request.id` (same UUID) | §9 | match | | — |

## 7. Session cookie

| # | Area | Frontend (file:line) | Backend (file:line) | Brief § | Status | Justification | Proposed change |
|---|---|---|---|---|---|---|---|
| 117 | name/flags in production | README §6 | auth.controller.ts:21-24 (`COOKIE_SECURE=true`): `__Host-kpmpl_sid`, HttpOnly, `SameSite=Lax`, `Path=/`, no `Domain`, `maxAge` 12 h | §8 | match | exactly the brief | — |
| 118 | dev flag | — | same lines with `COOKIE_SECURE=false` (the default outside production) → cookie is named **`kpmpl_sid`** | §8 | match (decision A: __Host-kpmpl_sid always, Secure by default; Safari-on-http caveat documented) | UI never reads it (HttpOnly), so nothing breaks — but the brief mandates the `__Host-` name and Phase 3 must evidence it | **A (recommended):** run local/integration stacks with `COOKIE_SECURE=true` (Chrome/Firefox accept Secure cookies on `http://localhost`; document the Safari caveat, as the frontend README already does). **B:** keep dev name, document deviation |
| 119 | extra cookies | README §6 says the session cookie is the only one | `kpmpl_refresh` (HttpOnly, path `/api/v1/auth`) + `kpmpl_csrf` (**not** HttpOnly) set on every login | §8 | match (decision A: only the session cookie is set; kpmpl_csrf and kpmpl_refresh removed) | Brief defines only the session cookie; `kpmpl_csrf` puts a readable token in JS, and the frontend never uses either extra cookie (no `/auth/refresh` calls; CSRF is Origin + XRW) | **A (recommended):** drop `kpmpl_csrf`, keep `kpmpl_refresh` only if the future mobile/thin client needs it. **B:** keep both, documented in CONTRACT_CHANGES as transitional |
| 120 | rotation on login | — | auth.service.ts:64-72 — new `sessionId` + new cookie value per login | §8 | match | | — |
| 121 | logout clears + server-side invalidation; revocation on deactivation and admin reset | E2E expectation (Phase 2 #10) | logout revokes (auth.service.ts:147), `authorize()` re-checks `isActive` per request (line 27), admin update/reset revoke all target sessions (lines 174/200) | §4, §8 | match | replaying a revoked cookie → 401 | — |
| 122 | idle 2 h / absolute 12 h | README §6 | auth.service.ts:95 idle check on `lastSeenAt`, `expiresAt = +12 h` fixed | 5.1, §8 | match | | — |

## 8. CORS and CSRF

| # | Area | Frontend (file:line) | Backend (file:line) | Brief § | Status | Justification | Proposed change |
|---|---|---|---|---|---|---|---|
| 123 | allowlist source | `.env.*` docs | `WEB_ORIGIN` = **single origin** (env.ts:33) used by cors + the Origin check | §3 (“origin(s)”) | match | Phase 2 needs `http://localhost:5173` **and** `http://localhost:8080` live at once (Vite dev + prod-like nginx); one value cannot serve both | Accept a comma-separated `WEB_ORIGIN` allowlist (exact echoes only); tests for both origins |
| 124 | credentials + exact echo, never `*` | README §6 | http.ts `cors {origin: env.WEB_ORIGIN, credentials: true}` | §3 | match | non-allowlisted origin gets no `Access-Control-Allow-Origin` | — |
| 125 | `Origin` check on writes; missing Origin rejected | README §6 | auth.guard.ts:27 (`origin !== WEB_ORIGIN` → 403, so absent Origin fails; also rejects `sec-fetch-site: cross-site`) | §3 | match | missing Origin rejected (the recommended rule) | — |
| 126 | behind Vite dev proxy | vite.config.ts:31-33 (`changeOrigin:false`, default target `http://localhost:3000`) | guard compares browser `Origin: http://localhost:5173` to default `WEB_ORIGIN` | §3 | match | first-party cookie, Origin preserved | — |
| 127 | behind nginx (same origin) | nginx.conf proxies `/api` | `WEB_ORIGIN` must equal the public origin — configuration requirement, no code gap | §3 | match | record in ENVIRONMENTS.md (Phase 4) | — |

## 9. Multipart upload

| # | Area | Frontend (file:line) | Backend (file:line) | Brief § | Status | Justification | Proposed change |
|---|---|---|---|---|---|---|---|
| 128 | field names `category` + `file`, 1-field limit | httpAdapter.ts:296-301 | documents.controller.ts:24; http.ts multipart `{files:1, fields:2, fileSize:10 MB}` | 5.7, 5.9 | match | names match; `MAX_UPLOAD_MB` honoured | — |
| 129 | `%PDF-` magic + empty rejection | README §6 | documents.service.ts:179 | 5.9 | match | extension/client MIME alone never trusted for the magic check; empty → 422 `DOMAIN_RULE` | — |
| 130 | client MIME reliance | — | documents.service.ts:179 also requires `file.mimetype === 'application/pdf'` | 5.9 (“do not trust … the client MIME type”) | match | A genuine PDF whose OS/browser reports an empty/other `File.type` is rejected; the brief says trust magic bytes, not the client MIME | Drop the client-MIME condition once magic bytes pass; test with a mislabelled-but-valid PDF |
| 131 | ClamAV fail-closed + infected wording | README §6 | malware-scanner.service.ts (`SCAN_FAIL_CLOSED` default `true`); documents.service.ts:181-182 | 5.9 | match | scanner down → 422 “The security scanner is unavailable…”; infected → 422 `DOMAIN_RULE` “This file failed the security scan.” (exact) | — |
| 132 | bucket bootstrap / storage | — | file-storage.service.ts:11-20 `ensure()` | 5.9, §9 | match | Against the repo’s own compose MinIO, `ensure()` throws: `PutPublicAccessBlockCommand → MalformedXML`, `PutBucketEncryptionCommand → NotImplemented: Server side encryption specified but KMS is not configured` (reproduced step-by-step, and confirmed on the booted server: `readyz` → 503 `storage:"down"` while database/redis are `up`). Result: **uploads fail** and `readyz` storage is permanently `down` (2 of the 3 live-test failures) | Make bootstrap MinIO-compatible (retry/ignore unsupported calls or configure KMS) while keeping private/versioned/SSE requirements; re-run the live suite + an upload test |
| 133 | storage key format | — | documents.service.ts:180 `packages/{id}/{sha256}.pdf` | 5.9 (`packages/{packageId}/{fileId}.pdf`) | match | Not UI-visible, but deviates from the normative key layout (affects audit/runbook wording) | Use the fileId key; test |
| 134 | response = updated `DocumentPackageView` | httpAdapter.ts:300 | documents.service.ts:204 returns the view | 5.7 | match | correct envelope/status (view content issues tracked in #85-#89) | — |

## 10. File content endpoint

| # | Area | Frontend (file:line) | Backend (file:line) | Brief § | Status | Justification | Proposed change |
|---|---|---|---|---|---|---|---|
| 135 | path + `Content-Type: application/pdf`, `Content-Disposition: inline; filename="…"`, `X-Content-Type-Options: nosniff` | httpAdapter.ts:307 | documents.controller.ts:26 | 5.7 | match | filename sanitised against quote/backslash | — |
| 136 | `Cache-Control: private, no-store` | — | controller sets `private, no-store`, but the global `onSend` hook (http.ts:18-21) **overwrites** it with plain `no-store` | §3, 5.7 | match | `private` is lost on file responses | Set `private, no-store` in the hook (or don’t overwrite); assert the exact header in a test |
| 137 | access rules | — | guard `RequiresAny(docs.prepare, ho.inbox)` + service: `docs.prepare` OR (`ho.inbox` AND HO_VISIBLE), else 404; deleted/infected → 404 | 5.7 | match | QC has neither capability → 404/403 as specified | — |
| 138 | same-origin framing | PDF viewer iframe | helmet registered with `contentSecurityPolicy: false` (http.ts:12) → no `frame-ancestors`; X-Frame-Options falls back to Helmet’s default `sameorigin` | integration check 10 | match | same-origin SPA framing works with `SAMEORIGIN`/`'self'`; **verify the emitted header value in Phase 2 journey 7** (Chromium/Firefox/WebKit) | If XFO proves absent/deny, send `frame-ancestors 'self'` explicitly |

## 11. CSV export

| # | Area | Frontend (file:line) | Backend (file:line) | Brief § | Status | Justification | Proposed change |
|---|---|---|---|---|---|---|---|
| 139 | path, `overview.view` auth, UTF-8 BOM, RFC 4180 quoting, `=+-@` prefix, `Content-Disposition: attachment; filename="…"`, `from/to` `YYYY-MM-DD` in Asia/Kolkata | httpAdapter.ts:276-284; mockAdapter.ts:25 | reports.controller.ts:12 + reports.service.ts:21-26 | 5.5 | match | BOM `\uFEFF`, CRLF, quoting, all four formula prefixes, date window in IST | — |
| 140 | columns = `RECEIVING_CSV_COLUMNS` (14, exact names/order) | mockAdapter.ts:25 `['Gate Entry No.','Vehicle No.','Supplier','Material','Gross Wt (kg)','Tare Wt (kg)','Net Wt (kg)','QC status','Exit status','Exit time (IST)','GRN status','GRN No.','Entry time (IST)','Entered by']` | reports.service.ts:25 header = 9 different labels (`Gate Entry Ref`,`Vehicle`,…,`Created At`), missing Net/QC/Exit/GRN status/Entered by | 5.5, D-10 | match | Brief: use the frontend’s current columns; E2E journey 9 asserts the exact header row | Emit the 14 columns in order (values incl. derived net, statuses, display names); test asserts the header byte-for-byte |

## 12. Pagination

| # | Area | Frontend (file:line) | Backend (file:line) | Brief § | Status | Justification | Proposed change |
|---|---|---|---|---|---|---|---|
| 141 | default 50, max 500, `page`/`pageSize`/`total`, `createdAt DESC` | README §5, screens use 500 and 1 | receiving.schemas.ts:17-19 + repository.ts:35-37 | 5.2 | match | values match the brief | — |
| 142 | `qcStatus=*` (repeated), `exitStatus`, `grnStatus` query params | httpAdapter.ts `qs()`; views.ts:10-12; register/dashboard screens | `listVisitsSchema` `.strict()` with **no status fields** | 5.2 | match | Register views (“Waiting for QC”, “Returned by QC”, …) and dashboard count tiles → 422 on every call | Add the three filters (arrays for `qcStatus`, repeated-param parsing) + tests per filter |
| 143 | backend test contradicts the brief’s max | — | `receiving.e2e-spec.ts:159` expects 422 at `pageSize=101` (code correctly allows 500) | 5.2 (max 500) | match | The shipped live suite fails on this line; the brief and the UI both require 500 | Change the assertion to `pageSize=501` (still asserts the boundary), record in CONTRACT_CHANGES as a test-alignment (not a weakening) |
| 144 | `search` over Gate Entry ref case-insensitive/partial | register search box | repository.ts:28 uses **exact equality** for the ref (case-insensitive only for vehicle/supplier/material) | 5.2 | match | Searching `0008` or mixed case finds nothing | `contains … insensitive` for the ref too; tests |

## 13. Date and decimal formats

| # | Area | Frontend (file:line) | Backend (file:line) | Brief § | Status | Justification | Proposed change |
|---|---|---|---|---|---|---|---|
| 145 | kg regex + fixed scale | types.ts `DecimalString`; UI regexes | receiving.schemas.ts:14 `^\d{1,9}(\.\d{1,3})?$` (+ rejects 0); output `toFixed(3)` | §3, §12.10 | match | `15000.0001` → 422 and `"15000.000"` stays a string — proven by the live e2e test | — |
| 146 | percent format/scale | types.ts:131-135 | qc.service.ts:14 lax regex; stored in JSON (no `qc_measurement` NUMERIC(5,2) table) | §3, §6 | match | Percent accepts `1e3`-style/negative/over-precision input and is echoed unnormalised (`12.5` vs brief `12.50`) | Enforce `^\d{1,3}(\.\d{1,2})?$`, normalise scale 2, store as `NUMERIC(5,2)`; tests |
| 147 | refs opaque, byte-for-byte | types.ts header comment | `ReceivingVisit.official_gate_entry_ref` text; no numeric parsing anywhere | §1 rule 4, §12.10 | match | `0008-HO`, `00071-HO` round-trip (live test passes) | — |
| 148 | times ISO UTC `Z`; event time ≠ record time | types.ts `Iso8601` | `toISOString()` everywhere; `physicalExitAt`/`erpOccurredAt` stored as event times beside `recordedAt`/`confirmedAt` | §3 | match | | — |

## 14. Roles and capabilities

| # | Area | Frontend (file:line) | Backend (file:line) | Brief § | Status | Justification | Proposed change |
|---|---|---|---|---|---|---|---|
| 149 | role codes + matrix | permissions.ts:24-31 | policy.ts:13-21 + seed migration `20261102130100_seed_role_capabilities` | §4 | match | brief capability sets are seeded exactly for all 6 roles (legacy aliases coexist — API surface in #65) | — |
| 150 | capability **strings on routes** | permissions.ts capability union = brief’s 14 | guards use legacy names: `receiving.read`, `weighment.record`, `movement.exit`, `grn.record`, `qc.queue`, `qc.submit`, `auth.self`, `platform.read`, `identity.manage`, `audit.verify` (docs/HO/admin routes do use brief caps) | §4 (“exact strings”) | match | Brief mandates the 14 exact strings; two parallel vocabularies will drift | Guard routes with the brief’s capability names (aliases may remain in the DB during transition); route-guard test keeps coverage |
| 151 | read-route grants | gate_doc/ho/admin have `receiving.view` (permissions.ts) | `GET /receiving-visits`, `GET …/{id}`, `…/timeline`, `…/qc-inspections` require `receiving.read`, granted only to gate/qc/qc_reviewer (policy.ts:23-31 + migration) | §5.2 | match | **gate_doc cannot open the truck picker** (403 on `listVisits`), ho/admin 404/403 on visits and timelines — brief allows all three via `receiving.view`/`docs.prepare`/`ho.inbox` | Authorise these reads with the brief’s capability sets (§5.2 “any of …”); cross-role tests |
| 152 | **Updated 2026-11-03 (D-03): role sets are now gate; qc (incl. `qc.decide`).** write grants for queue/weighment/exit/grn/qc | — | legacy caps granted to exactly the brief’s role sets (gate; qc; qc_reviewer) | §4 | match | effective access equals the brief matrix for these routes | — |
| 153 | HO visibility = `HO_VISIBLE` states | types.ts `PackageStatus` | documents.service.ts:14 list filter, get→404, erp/reminder→404, file content check | §4 | match | draft invisible to HO; 5 states match the brief list | — |

## 15. Demo mode and configuration

| # | Area | Frontend (file:line) | Backend (file:line) | Brief § | Status | Justification | Proposed change |
|---|---|---|---|---|---|---|---|
| 154 | `APP_MODE` + refuse demo-in-production | configSchema/README §3 | env.ts:35, env superRefine line 43 | §8 | match | boots fail on `APP_MODE=demo` + `NODE_ENV=production` | — |
| 155 | **Updated 2026-11-03 (D-03): seed is now 5 users, without the former QC decision account.** demo seed: `demo-gate, demo-qc, demo-review, demo-docs, demo-ho, demo-admin`, password from `DEMO_PASSWORD`, brief roles + 4 fixture visits / 2 packages | README §2; mock fixtures.ts | **no `DEMO_PASSWORD` anywhere**; `bootstrap.ts` creates **5** uppercase users (`DEMO-GATE`…) with **legacy roles** (`qc_operator`, `qc_manager`, `ho_accounts`), random passwords written to `.demo-credentials.json`; **no fixture seed exists at all** | §9 | match | (a) UI login `demo-gate` fails (employeeCode lookup is case-sensitive), (b) `roles[0]` = legacy code → `permissions.ts` grants lookup fails → navigation/permissions dead, (c) no demo-docs user, (d) no seeded visits/packages for E2E | Add an idempotent seed: 6 users with brief role codes, password from env `DEMO_PASSWORD`, plus fixtures equivalent to `mock/fixtures.ts` (4 visits, 2 packages, synthetic only); tests |
| 156 | **Superseded 2026-11-03 (D-03): flag retired; still parsed, ignored.** `QC_REVIEW_ENABLED` env flag | prompt contract list | derived: `policies.ts:9` (`APP_MODE !== 'production'`), no env var | §4 | match (decision A: QC_REVIEW_ENABLED env flag added, brief defaults) | Behaviour is right for demo/production today, but the brief names an env flag (default true in staging / false in production until sign-off) | **A (recommended):** add `QC_REVIEW_ENABLED` with those defaults, feeding `policies.ts`. **B:** keep derived value, document in CONTRACT_CHANGES |
| 157 | `MAX_UPLOAD_MB` | — | env.ts:44 default 10 | 5.9 | match | | — |
| 158 | policy flags (`GATE_ENTRY_UNIQUE_SCOPE`, `EXIT_REQUIRES`, …) | README §7 (static labels) | config/policies.ts (named, read-only, `pending KPMPL confirmation` via `status`) | §7, §11 | match | exists exactly as the brief’s “flag in `config/policies.ts`” | — |
| 159 | `GET /config/policies` | README §5 (not called yet) | policies.controller.ts:5-8 | §7 | match | present | — |
| 160 | health paths | README §4 mentions `/healthz` | actually `/api/v1/healthz` + `/api/v1/readyz` (global prefix) | §9 | match | under `/api/v1`; frontend never calls them — fix the README wording later if touched | — |
| 161 | listen port | dev proxy default `http://localhost:3000` (vite.config.ts:24) | env.ts:36 default 3000 | §3 | match | | — |
| 162 | dev compose viability | — | docker-compose.yml: `postgres:17` (brief 16); `api` runs `NODE_ENV: production` while `.env.example` sets `APP_MODE=demo` → env schema refuses to boot; `web` builds `apps/web/Dockerfile` which does not exist in the repo | §2, §9 | match | `docker compose up` as shipped cannot serve the stack (API boot refusal + missing build context) | Fix dev compose (development env for api, drop/replace the phantom `web`, pin postgres:16) — the Phase 2 `docker-compose.integration.yml` covers the integration stack either way |
| 163 | stack versions vs brief §2 | engines ≥ 20.19 | Node ≥ 24 (brief 22 LTS), NestJS 11 (brief 10), Prisma 6 (brief 5), PG 17 (brief 16) | §2 | match (decision A: current versions accepted; recorded in CONTRACT_CHANGES) | Contract-neutral, but the brief says “record each choice as an ADR” and the ADRs present don’t cover these bumps | **A (recommended):** accept the versions, add one ADR + note in CONTRACT_CHANGES (tests pass on them). **B:** downgrade to the brief’s versions (costly, no contract benefit) |

## 16. Frontend README §7 open points (9 items)

| # | Area | Frontend (file:line) | Backend (file:line) | Brief § | Status | Justification | Proposed change |
|---|---|---|---|---|---|---|---|
| 164 | §7.1 `mustChangePassword` placement | types.ts:29 top-level optional | auth.service.ts:18-21 top level on every user payload | 5.6 | match | resolved: top level, absent = false | — |
| 165 | §7.2 change-password 204 or `{data}`; wrong current password 422 `fields.currentPassword` or 401 | httpAdapter.ts:228-244 | 200 `{data:{changed:true}}`; wrong password → 401 (auth.service.ts:134), which the adapter converts to the `currentPassword` field error via `/auth/me` | 5.6 | match | both accepted paths behave | — |
| 166 | §7.3 IK on `PATCH /admin/users/{id}` | httpAdapter.ts:288 sends it | admin-users.controller.ts:28 requires + consumes it | §3 vs §5.6 | match | §3 wins; header both required and used | — |
| 167 | §7.4 `ErpMilestone.source` accepts `manual_staff_confirmation` / `staff_confirmed` | types.ts:215 | documents.service.ts view returns **no `source`** (column has no default in the view) | 5.8, §6 | match | `source` is `undefined` in the UI; §6 mandates `manual_staff_confirmation` | Include `source: 'manual_staff_confirmation'` (all milestones); test |
| 168 | §7.5 reverse sends reason in `note`, `verifiedInDataManByStaff:false` | httpAdapter.ts:312 | documents.service.ts `erp()` reverse branch reads `input.note`, ignores the flag | 5.8, R-20 | match | | — |
| 169 | §7.6 deactivated login: brief 401 / mock 403 | README §7.6 | 401 (see #99) | §3 | match | brief wins; UI handles both | — |
| 170 | §7.7 429/413 send the error envelope | httpAdapter.ts:67-73 | 429 → envelope ✓ (#108); 413 → likely no envelope/500 (#97) | §3 | match | half of the point holds | covered by #97/#108 fixes |
| 171 | §7.8 CSV `Content-Disposition: attachment; filename="…"`; UI sends no `from/to` yet | httpAdapter.ts:276-284 | reports.controller.ts:12 sends exactly that | 5.5 | match | | — |
| 172 | §7.9 screens fetch `pageSize=500`; >500 needs paging/filtering | GateDashboard/ReceivingRegister/DocumentPages | server max 500 (#141); server-side filters missing (#142) | 5.2 | match (decision A: accept the 500-page register; status filters now let tiles count server-side) | Synthetic data is far below 500, but the “To do” tiles silently under-count above 500 | **A (recommended):** accept now — fix #142 so tiles use filtered counts, keep the README note, revisit if the client expects >500 visits. **B:** build server-side filter endpoints in Phase 1 (scope creep) |

## 17. Anything else found

| # | Area | Frontend (file:line) | Backend (file:line) | Brief § | Status | Justification | Proposed change |
|---|---|---|---|---|---|---|---|
| 173 | rate limits | httpAdapter.ts:67 (429 wording) | rate-limit.service.ts: login `30/min per IP` (brief: **5/min per IP+username**); lockout starts at the **5th** failure with escalating 30 s…15 min (brief: lockout **after 10, for 15 min**); general API `120/min per IP` (brief: 300/min per session) | §3 | match | All three numbers differ from the normative contract; Phase 3 must evidence 6th-attempt 429 and the 10-failure lockout | Implement the brief’s three limits (keyed per IP+username / per session); tests + SECURITY_VERIFICATION evidence |
| 174 | admin `PATCH /admin/users/{id}` always revokes the target’s sessions | E2E journey 10 expects revocation on **reset** | auth.service.ts:174 revokes on *every* update, including displayName-only edits | §4 (“rotate on role change”) | match (decision A: revoke only on role/active change) | Visible: editing someone’s name signs them out; brief only mandates rotation for role change/deactivation/reset | **A (recommended):** revoke only when `roles` or `active` changed. **B:** keep “any update revokes” (safer, but surprising) documented as a deviation |
| 175 | reference data seeded list | NewReceivingPage.tsx:186 datalist + getReferenceData | `reference_data` table **absent**; only distinct values from existing visits (receiving.service.ts:96-101); no admin-managed list | 5.2, §6 | match | A fresh install offers an empty supplier/material suggestion list until visits exist | Add the `reference_value` model + seed; expose distinct-used ∪ seeded |
| 176 | extra read routes | — | `GET …/weighments`, `GET …/grn-links`, `/auth/refresh`, `/identity/users`, `/audit/verification`, `/platform/features` | §5 | match | not in the brief, read-only, none reachable by surprise (all capability-guarded — route-guard test passes) | leave as is; note in CONTRACT_CHANGES as additions |
| 177 | JSON body limit 100 KB | — | main.ts `bodyLimit: 102_400` (100 KiB) | §3 | match | 102 400 B = 100 KiB ≈ 100 KB; envelope caveat tracked in #97 | — |

---

## Summary

| Status | Phase 0 | Phase 1 (after) |
|---|---|---|
| `match` | 103 | **177** |
| `backend-fix` | 66 | 0 |
| `frontend-fix` | 0 | 0 |
| `decision-needed` | 8 | 0 (all resolved with option A) |
| **total rows** | **177** | **177** |

No `frontend-fix` rows: the v0.6.0 adapter conforms to the brief everywhere it is checked; every code-changing row is on the backend side (consistent with the brief’s own rule that the frontend already embodies the contract).

## decision-needed items — all resolved with option A in Phase 1 (original recommendations kept for the record)

1. **#65 — legacy role codes accepted by the admin API.** A: restrict to the brief’s 6 codes now (recommended — the demo seed must move off legacy codes anyway, #155); B: keep aliases until the “thin client” transition ends.
2. **#69 — unknown fields: reject (`.strict()`) vs strip.** A: keep rejecting (recommended — it caught every request-shape drift in this audit) and note the §8 wording deviation in CONTRACT_CHANGES; B: switch to strip.
3. **#118 — dev cookie name.** A: run local/integration with `COOKIE_SECURE=true` so the cookie is always `__Host-kpmpl_sid` (recommended; Chrome/Firefox OK on localhost, Safari caveat documented); B: accept `kpmpl_sid` locally.
4. **#119 — extra cookies.** A: drop `kpmpl_csrf` (JS-readable, unused) and keep `kpmpl_refresh` only if a future non-browser client needs it (recommended); B: keep both as transitional, documented.
5. **#156 — `QC_REVIEW_ENABLED`.** A: add the env flag with brief defaults (recommended); B: keep deriving from `APP_MODE`, document.
6. **#163 — stack versions (Node 24 / Nest 11 / Prisma 6 / PG 17).** A: accept + ADR + CONTRACT_CHANGES note (recommended); B: downgrade to brief versions.
7. **#172 — >500-visit screens.** A: accept now, fix filtered counts, keep README note (recommended); B: build server-side filters in Phase 1.
8. **#174 — session revocation on every admin update.** A: revoke only on role/active change (recommended); B: keep, documented.

## Risks (top 5) — all five closed in Phase 1 (sign-in, golden path, storage bootstrap, list surfaces, seed; evidence in CONTRACT_CHANGES + live tests). Kept as the Phase 0 record:

1. **Sign-in is broken end-to-end (#72)** — `login` returns a nested payload, so no role can authenticate through the HTTP adapter. Impact: everything. Mitigation: first fix in Phase 1, covered by an HTTP test asserting the flat `User`.
2. **Golden path M1 unreachable (#41-#55, #17/#18, #81, #94)** — every tare/exit/GRN/QC write fails 422 (body `version`/strict schemas), the QC review module and queue shape don’t exist, and exit is gated on a non-contract `clearance` state. Impact: the core journey and 14 of the E2E journeys cannot start. Mitigation: Phase 1 re-work of those five routes + contract tests; the missing review module is the largest single work item.
3. **Uploads and readiness broken against the bundled stack (#132)** — MinIO bootstrap calls fail (`MalformedXML`, `NotImplemented`), so `readyz` is 503 and file attachment fails; two live tests fail for this reason. Impact: Module 2 and health checks. Mitigation: fix `ensure()`/MinIO config in Phase 1; add a real upload test (the current `module2` e2e never uploads a file).
4. **List/read surfaces broken or mis-authorized (#94, #142, #151, #154-#176 rows 76/77/84)** — flat page envelope, rejected status filters, `gate_doc`/`ho`/`admin` denied the visit register, raw UUID actor names, non-contract overview shape. Impact: most screens render blank or 403 even after login works. Mitigation: Phase 1 envelope/filter/capability fixes with per-route tests.
5. **No usable demo seed and a failing backend test as shipped (#155, #143)** — no `DEMO_PASSWORD`, no fixture data, legacy role codes (UI permission lookups fail), plus the live suite’s `pageSize=101` assertion contradicts the brief. Impact: Phase 2 E2E cannot boot. Mitigation: build the seed in Phase 2.2 (contract-aligned), fix the test boundary in Phase 1 with a CONTRACT_CHANGES entry.

Known gaps outside the diff (tracked for later phases): backend e2e tests authenticate with Bearer/mobile tokens only, so the cookie + Origin + `X-Requested-With` path has **no automated coverage** yet (Phase 3 item 2); must-change-password server-side route lockdown not yet enforced (Phase 3 item 8); coverage ≥ 90 % not measured (no coverage script); the shipped OpenAPI YAML is static, missing the two QC review paths, and cannot serve Phase 1’s contract test until regenerated from code (choice between OpenAPI-validation vs shared-Zod happens in Phase 1).
