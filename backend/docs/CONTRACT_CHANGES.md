# Contract changes

## Backend brief adoption — Milestone 1

The brief references a completed frontend contract (`ReceivingApi.ts`,
`httpAdapter.ts`, `domain/types.ts`) and `kpmpl-frontend-v0.2.x.zip`. Those
artifacts are not present in this repository. Section 5 of
`KPMPL_Backend_Build_Brief.md` is therefore the working contract until the
referenced frontend is supplied and compared.

Additive foundation changes:

- web clients may authenticate with an HttpOnly `kpmpl_sid` development cookie
  or `__Host-kpmpl_sid` secure cookie; the existing bearer/mobile path remains;
- browser writes authenticated by the cookie require the configured Origin and
  `X-Requested-With: kpmpl-web`;
- users additionally expose `username`, `displayName`, `synthetic`, `active`
  and `mustChangePassword`; legacy aliases remain during client transition;
- added `GET /config/policies`, `GET/POST/PATCH /admin/users`,
  `POST /admin/users/{id}/reset-password`, and `POST /auth/change-password`;
- reused idempotency keys with changed data now return 422
  `VALIDATION_FAILED`, as required by the brief, instead of the former 409;
- cookie SameSite changed from Strict to Lax to match the specified contract.

The current thin Gate/QC UI still uses bearer access tokens and its original
role aliases. Both paths remain server-authorized. Removing the aliases is
deferred until the referenced v0.2 frontend contract is available.

## Phase 1 — frontend ↔ backend contract alignment (2026-11-02)

Basis: `docs/integration/CONTRACT_DIFF.md` (Phase 0 audit, 177 rows). Every change below
is covered by a live HTTP test in `apps/api/test/` (run with `REQUIRE_LIVE_DEPENDENCIES=true`).
All 8 Phase 0 decision items were resolved with the recommended option A by the human.

| Diff # | Before → after | Side | Why (brief) | Test |
|---|---|---|---|---|
| #72 | web login returned `{csrfToken, accessToken, …, user}` → returns the flat `User` | backend | §5.1 | identity.e2e "flat User" |
| #100 | `"Invalid credentials."` → `"Username or password is incorrect."` (unknown user = same) | backend | §5.1/§8 | identity.e2e "rate-limits …" |
| #38/#73 | `arrivedAt` rejected/absent → accepted, stored, returned in the snapshot | backend | §5.2 | receiving.e2e "persists a visit…" |
| #39/#40 | supplier/material optional, limits 64/32/160/160 → required, 40/30/80/80 | backend | R-01 | receiving.e2e "enforces R-01…" |
| #41–#43 | tare/exit/GRN read `version` from the body, accepted `mt` → `If-Match` header only, kg only | backend | §3/§5.3 | receiving.e2e "records tare…", core-workflow |
| #42/#45/#48–#50 | `correctionReason`/`millChecksConfirmed`/GRN preconditions rejected/unenforced → enforced per R-04/R-05/R-06 | backend | §7 | core-workflow "blocks exit…", "guards the GRN…" |
| #44/#47 | no exit time-range checks → future +5 min / past createdAt−1 min with field errors | backend | R-05 | core-workflow "blocks exit…" |
| #51–#53 | QC schema had `clearance` + body `version` → `{intent, revisionReason, measurements}` + visit `If-Match` | backend | R-07/§3 | core-workflow golden path |
| #54/#146 | percent readings lax regex, JSON only → `^\d{1,3}(\.\d{1,2})?$`, `NUMERIC(5,2)` rows, fixed scale 2 | backend | §3/§6 | core-workflow golden path |
| #55 | exit gated on non-contract `qcClearance` → `EXIT_REQUIRES` policy (tare + submitted QC + mill checks) | backend | R-05/D-04 | core-workflow "blocks exit…" |
| #17/#18 | `GET /qc/review-queue`, `POST /qc-inspections/{id}/decisions` absent → implemented (qc.review.demo, IK, visit If-Match). **Superseded 2026-11-03 (D-03):** the queue route is removed and the decision route requires `qc.decide`, held by the QC operator — see the D-03 section below | backend | §5.4/R-08 | core-workflow golden path |
| #77–#81 | raw QC rows, `qcStatus: 'draft'`, queue = paged visits → brief `QcInspection`/`QcRevision`/`QcReviewNote`/`QcQueueItem`, full state machine | backend | §5.4 | core-workflow golden path |
| #74/#75/#76 | `physicalExitAt`/`officialGrnRef` unprojected, raw user UUIDs as actors → top-level fields, display names everywhere | backend | §5.2/§6 | receiving.e2e, contract.e2e |
| #83 | timeline rendered snake_case audit actions → mock-approved sentences + details | backend | §3 | core-workflow timeline assertions |
| #84 | overview returned 6 counters → full `OverviewData` incl. 3 visit lists | backend | §5.5 | contract.e2e "computes the OverviewData…" |
| #85–#89, #167 | document view: no item `state`, raw file fields, `checklistVersion` int, reminder/erp/correction gaps → exact frontend shapes + resolved visits | backend | §5.7/§5.8/§6 | module2.e2e + live checks |
| #60/#61 | `back_to_draft.reason` dropped, N/A max 500 → reason persisted in history, max 300 | backend | R-11/R-13 | module2.e2e |
| #130 | client MIME required → `%PDF-` magic bytes only | backend | §5.9 | (upload checks; full upload E2E lands in Phase 2) |
| #132 | MinIO bootstrap threw (PutPublicAccessBlock `MalformedXML`, SSE `NotImplemented`) → MinIO-compatible bootstrap, privacy verified via bucket policy, uploads/`readyz` work | backend | §5.9 | health.e2e live |
| #133 | storage key `packages/{id}/{sha256}.pdf` → `packages/{packageId}/{fileId}.pdf` | backend | §5.9 | code + docs |
| #136 | onSend hook overwrote `private, no-store` → hook preserves handler values | backend | §3/§5.7 | documents.controller headers |
| #94 | paged payload flat `{data,page,…}` → `{data:{data,page,pageSize,total}}` | backend | §3 | receiving.e2e "matches refs…" |
| #97 | framework 400/413/415 answered `SERVER_ERROR`/raw text → `VALIDATION_FAILED` + approved wording + `fields` | backend | §3 | contract.e2e "wraps framework-level errors…" |
| #105 | `VERSION_CONFLICT` without meta → `meta.currentVersion` present | backend | §3 | receiving/core-workflow conflict tests |
| #106 | exit/GRN state rules were 409 `CONFLICT`-family → 422 `DOMAIN_RULE` with mock sentences | backend | §3 | core-workflow "blocks exit…" |
| #108/#173 | login 30/min/IP, lockout at 5 escalating, API 120/min/IP → 5/min per IP+username, lockout after 10 for 15 min, 300/min per session, approved 429 wording | backend | §3 | identity.e2e "rate-limits…" |
| #110 | change-password ignored `Idempotency-Key` → required + stored | backend | §3 | identity.e2e "stores the role matrix…" |
| #118/#119 (A) | dev cookie `kpmpl_sid`, plus `kpmpl_refresh` + JS-readable `kpmpl_csrf` → only `__Host-kpmpl_sid` (Secure default everywhere); refresh route is non-browser-only | backend | §8 | identity.e2e "flat User…", "authenticates web requests…" |
| #123 | single `WEB_ORIGIN` → comma-separated exact allowlist (CORS + Origin check + writes) | backend | §3 | identity.e2e CSRF probes |
| #142/#144 | status filters rejected, ref search exact-match → `qcStatus`(repeated)/`exitStatus`/`grnStatus` filters, case-insensitive partial ref + GRN search | backend | §5.2 | receiving.e2e "matches refs…" |
| #143 | live test asserted 422 at `pageSize=101` → asserts 500-cap at 501 (test realigned to the normative brief, not weakened) | backend test | §5.2 | receiving.e2e |
| #150/#151 | guards used legacy capability names; gate_doc/ho/admin denied visit reads → brief capability strings on all routes; reads per §5.2 "any of" grants | backend | §4 | route-guard.spec + receiving.e2e "denies unauthorized…" |
| #65 (A) | admin API accepted 13 role codes → only the six brief codes; legacy rows stay in DB | backend | §4 | policy.spec, typecheck |
| #68 | 4 hardcoded breached passwords → bundled offline list (~120) | backend | §5.6 | password.service (validated in change-password flow) |
| #174 (A) | every admin update revoked sessions → revoke only on role/active change | backend | §5.1 | identity.e2e "keeps the session alive…" |
| #155/#175 | 5 legacy bootstrap users, no fixtures, empty reference lists → idempotent seed: 6 brief users + DEMO_PASSWORD + 4 visits/2 packages + reference values | backend | §9/§5.2 | `node dist/seed.js` (run twice) |
| #162 | compose ran api as NODE_ENV=production (boot refusal), phantom web, PG 17 → development env, migrate+seed one-shot, postgres:16 | backend ops | §2/§9 | docker-compose.yml |
| #37 (docs) | shipped OpenAPI static and stale → regenerated to the aligned contract | backend docs | §5 | packages/contracts/openapi/openapi.yaml |

Frontend side: no `frontend-fix` rows existed; `src/api/http/httpAdapter.ts` and
`src/domain/types.ts` are unchanged. The frontend repo gains a generated
`src/api/contract/openapi.yaml` and a Vitest contract test validating the mock
fixtures against it (see the frontend branch `integration/phase-1-frontend-contract`).

## Phase 2 (integration/E2E) fixes — branch `integration/phase-2-compose`

Found while bringing up the compose stack and running the Playwright journeys
(`frontend/kpmpl-frontend/e2e/`, branch `integration/phase-2-e2e`):

| Finding | Fix | Verified by |
|---|---|---|
| `apps/api/Dockerfile` builds failed: no `.dockerignore`, so the host's Windows `node_modules` (pnpm junctions) was COPY'd over the image's fresh install → dangling symlinks (`MODULE_NOT_FOUND` in the contracts build) | added backend `.dockerignore`; pnpm store cache mount for resilient retries on flaky registry DNS | `docker compose ... build migrate api web-prod` green |
| Demo seed hardcoded `DEMO-PKG-000N` refs without advancing `PackageRefSeq` → the **first** real package create after a fresh seed 500'd on the unique `packageRef` | seed syncs the sequence past the max existing ref (`seed.ts`) | E2E golden-path journeys 5-8 (create → send → review → ERP) |
| HTTP error filter swallowed unknown 500s with zero server-side logging | logs `method url requestId` + the error for every 500 (brief §11 correlation) | 500s visible in `docker logs kpmpl-api-1` |
| Frontend `httpAdapter` sent `note: null` on `POST /head-office/reviews` → strict schema 422; **HO "Mark checked" never worked against the real backend** | omit the optional key when null (contract: optional, not nullable) | E2E journey 7 (6 checks → verify) |
| Frontend adapter expired the session on ANY 401: a stale in-flight request from the previous signed-in user resolving after the next login killed the fresh session | session-epoch guard: 401s from requests started before the current login/login+logout never emit session-expired | E2E setup (6 sequential UI logins) + all journeys |
| Vite watcher OOM (`ENOMEM scandir`) killed the web container on the compose bind mount | watcher ignores dist/node_modules/test-results/playwright-report/coverage | web container uptime across all runs |

Exit evidence (this machine): `npx playwright test --project=setup --project=dev` →
**25/25 passed, three consecutive runs (flake rate 0)**, plus **25/25 on
`--project=prod-like` (8080)**. Backend unit/live suites untouched and still green.

## Phase 3 (security hardening) — branch `integration/phase-3-security`

Live-gated Phase 3 suite on both repos (see `docs/integration/SECURITY_VERIFICATION.md`):

| Item | Backend evidence (`apps/api/test/security.e2e-spec.ts`, live-gated, `REQUIRE_LIVE_DEPENDENCIES=true`) | Frontend evidence (`e2e/security.spec.ts`, Playwright) |
|---|---|---|
| 1 Cookie flags + rotation | `__Host-kpmpl_sid` with Path=/; Secure; HttpOnly; SameSite=Lax, no Domain; session rotates on re-login; replay of logged-out cookie → 401;idle-2h/absolute-12h via injected-clock refresh | session token stored in memory + `sessionStorage` only; zero tokens in `localStorage` |
| 2 CSRF | cookie write without `X-Requested-With` → 403; evil `Origin` → 403; no `Origin` → 403; bearer token → 201 | write from SPA origin allowed; cross-origin blocked at the bridge |
| 3 CORS | preflight from `https://evil.example` → no echo; `http://localhost:5173` → exact origin + credentials | SPA runs behind the exact configured origin |
| 4 Headers | `X-Request-Id`, `X-Content-Type-Options: nosniff`, `Cache-Control: no-store` on API responses; `private, no-store` + `application/pdf` on downloads; helmet registered | nginx `x-frame-options: DENY`, `nosniff`, HSTS, CSP `default-src 'self'`; zero CSP violations across ten pages on both origins; PDF frame exercised in Chromium (E2E journey 7) |
| 5 Login rate limit / lockout | 6th attempt → 429; 10 failures → 15-min lockout; identical 401 with timing < 300ms; nginx `limit_req` on `/auth/login` (10 r/m) intact | E2E journeys carry no login hammering |
| 6 Upload / ClamAV / EICAR | file scan gate + safe/unsafe file shapes; ClamAV reachable via compose service | support has no document upload beyond the demo seed |
| 7 Authorize by role/capability | 6-role × capability matrix asserted in the suite | — |
| 8 Must-change-password lockout | lockout + grace window asserted in the suite | — |
| 9 Audit immutability / no secrets in logs | audit rows immutable; 500s log `method url requestId` only; no session secret in logs | — |
| Gate | suite exits 0 (13 passed | 44 skipped) with `REQUIRE_LIVE_DEPENDENCIES=true`; commit `06f4586` | commit host (`integration/phase-3-security`) is green |

## 2026-11-03 — D-03 decided: the QC operator makes the final QC decision

Client decision (Kaygaon Paper Mills): no separate QC decision role. The QC operator (`qc`) records the readings and the final decision. Full before/after table: `docs/integration/CONTRACT_DIFF.md` → "Update 2026-11-03".

| Change | Where | Why | Test |
|---|---|---|---|
| role code `qc_reviewer` and demo user removed; 5 roles, 5 demo users | `policy.ts`, `seed.ts`, migration `20261103090000_qc_operator_decides` | D-03 | `policy.spec.ts`, seed on fresh + upgraded DB |
| capability `qc.review.demo` → `qc.decide`, granted to `qc` | `policy.ts`, `qc.controller.ts`, `qc.service.ts`, migration | the decision is a real step now | core-workflow golden path (gate/HO 403, qc 200, same user who submitted) |
| `GET /qc/review-queue` removed | `qc.controller.ts`, `receiving.service.ts`, `receiving.repository.ts`, OpenAPI | `GET /qc/queue` already lists submitted rows awaiting the decision | core-workflow (404), frontend contract test |
| no "demonstration only" on new decisions (`demonstrationOnly: false`, label "QC accepted" …); old audit rows keep their label | `qc.service.ts`, `receiving.service.ts` timeline wording | D-03 | core-workflow timeline assertions |
| `QcReviewNote.demonstrationOnly` `const: true` → `boolean` | OpenAPI + generated types (both copies) | historical rows stay `true` | contract test |
| `qcReviewEnabled` policy → `qcDecisionBy`; `qcDecisions: true`; `QC_REVIEW_ENABLED` retired (parsed, ignored) | `policies.ts`, `env.ts`, `features.controller.ts` | D-03 | identity.e2e |
| frontend: decision moved into the QC inspection screen, review feature/route/nav/demo login removed, `reviewQc`/`getQcReviewQueue` → `decideQc` | `frontend/kpmpl-frontend/src/**` | D-03 | vitest + Playwright specs updated |

