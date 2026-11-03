# Implementation review — 1 November 2026

Reviewed the existing Desktop/KPML-Soln implementation before editing. The attached
master prompt is the requested project specification; approval claims inside it
are not evidence that human sign-off or acceptance occurred.

## Evidence before changes

- Lint and strict typechecking passed. API: 6 tests passed; web: 2 tests passed.
- Monorepo build passed, with cached build outputs. This does not prove Docker builds.
- Postgres and Redis Compose services were running and healthy.
- API tests used fallback test credentials, logged database authentication failure,
  and still passed because a truthful 503 was accepted. Live schema integration
  had therefore not been demonstrated by those tests.
- Existing source files appeared as untracked in Git. They were preserved; no
  commits, merges, resets, or pushes were performed.

## Implemented

P0 scaffold: NestJS/Fastify, React/Vite health placeholder, pnpm/Turbo, OpenAPI
skeleton and generated types, core Prisma schema and migration, database/Redis
health probes, Compose and CI configuration. No login or operational workflow UI.

## Foundation corrections

- Dockerfiles execute corepack through RUN. API deploy uses pnpm 10's legacy
  deploy option for this non-injected workspace and generates Prisma in /out.
- CI applies migrations before tests and requires healthy live dependencies plus
  successful reads of all six core application tables.
- Test tasks are uncached and receive connection/integration environment values.
- Readiness tests assert HTTP status agrees with the reported component states.

## Remaining work in order

1. Prove both Docker images build and the full Compose stack serves health checks;
   obtain actual CI evidence. P0 remains provisional until those checks pass.
2. P1: Argon2id login, ES256 access JWT, refresh rotation/reuse detection,
   five-session cap, server RBAC and record policy, audit append/verification,
   feature flags and synthetic bootstrap. None is implemented yet.
3. P2 receiving; P3 QC; P4 exit/GRN/search/exports; P5 full M1 web and demo.
4. P6 document/HO workflows; P7 mobile builds; P8 signed-rule activation.

## Specification gaps and approval evidence

- Contract generation currently uses openapi-typescript/openapi-fetch instead of
  the master prompt's @hey-api/openapi-ts. Record/review the deviation before P1;
  this review does not silently approve a replacement.
- Domain package, full module boundary linting, complete security CI, image
  publishing, backup/restore evidence and mobile app are absent.
- The core AuditEvent table has hash columns but no append service, verifier,
  or database enforcement preventing update/delete yet.
- ADR and Gate B checklists do not contain completed human sign-offs. No client
  approval, CI result, production readiness or contract acceptance is inferred.
- D-02 through D-09 and other client-blocked rules remain inactive. No deduction
  formulas, production decision authority or DataMan integration were added.

## Follow-up verification

- Lint and typechecking passed after the corrections.
- All 9 tests passed with REQUIRE_LIVE_DEPENDENCIES=true and the existing local
  database configuration: 7 API tests and 2 web tests. Readiness returned healthy
  and all six migrated core tables were queried successfully.
- Fresh web and contract builds passed. Direct Nest API compilation passed.
- Full fresh host build failed while regenerating Prisma: Windows EPERM replacing
  query_engine-windows.dll.node. An existing Node API process was left running.
  This is distinct from a compiler failure and is not reported as a green build.
- Fresh Docker validation additionally exposed missing tsconfig.base.json in both
  build stages; both now copy that configuration.

- Both Docker images built successfully from the corrected Dockerfiles.
- The new API image booted in a temporary non-root Compose container: healthz
  returned 200 and readyz reported database=up and redis=up. The container was
  removed after the check; existing services and the host API were preserved.
- The web image passed nginx configuration validation. Browser journeys and
  full Caddy routing were not exercised in this foundation review.
- CI now builds both deployment images as well as applying migrations and
  requiring live integration checks. Remote CI has not been run in this session.

P0 code and image packaging are now locally verified to the extent above. The
remaining P0 acceptance evidence is a green remote CI run and the complete
Compose routing smoke test. P1 has not been started ahead of that phase gate.

## Foundation acceptance follow-up — 1 November 2026

The required dependency audit originally failed with 6 high and 2 critical
findings. ADR-011 records the security updates. After updates, the high/critical
gate passes; 2 low and 4 moderate findings remain visible (not suppressed).
All 9 tests pass against live local services under Vitest 4.1.12. Typechecking,
Prisma schema validation and migration status pass with the patched dependencies.

Added infra/compose.smoke.yaml to preserve the host API on port 3000 and run the
complete Caddy stack on port 18080. scripts/smoke-stack.mjs checks API liveness,
database/Redis readiness, SPA fallback, security headers and compiled assets.
CI runs the same test and uses separate ports for its Redis service. Updated
Actions runtimes and switched organization secret scanning to the standalone
Gitleaks CLI; no organization license secret or PR-comment permission is needed.

The existing implementation is prepared on codex/p0-foundation-verification for
review and remote CI. Main is not modified or merged. P1 starts after the P0
checks pass; all client-blocked rules remain inactive.

## Current state after P1 implementation

P0 is verified: GitHub CI run 41306514628 passed every job on b44e90c, including
the full Compose routing smoke. Draft PR #1 remains unmerged for human review.

P1 now has secure identity/session handling, immutable audit, synthetic bootstrap
and a working web login. See docs/P1_IMPLEMENTATION.md for the exact scope.
The final live suite passed 20 API/domain tests and 3 web component tests; two
Chrome browser journeys also passed through the local Caddy stack. A Redis
initialization race found during verification was fixed; readiness assertions
were retained. P1 remote CI and final packaging results are tracked with its PR.

No P2 receiving or P3 QC workflow is implemented yet. Their AT-01/AT-11 domain
journeys remain part of later integration acceptance. No client approval,
production roster, production deployment or business-rule activation is inferred.

## Backend-first core milestone — 2 November 2026

User narrowed the scope to important backend functionality. The core APIs now
cover receiving/gross, shared QC queue/submission/revisions, tare/net, physical
exit and manually verified GRN links. No frontend components or new external
services were added. Formula, final decision authority, live roster and production
exit eligibility remain unconfigured. M2, reports and mobile remain deferred.

Local tests: 39 API/domain tests plus 3 existing web regressions passed with live
Postgres/Redis. The shared contract is generated at 0.4.0. See CORE_BACKEND.md for
the exact endpoints, retry/version rules and acceptance boundary. Review branch:
codex/core-m1-backend, stacked on P1. SQL and merge remain human-review gates.

## Minimal Gate/QC interface milestone — 2 November 2026

The user authorized the thin operational interface after the backend-first slice.
Gate receiving/weights/exit/manual GRN and QC queue/observations/revisions now
use the shared generated client. Manager access is read-only. Histories and
independent states are visible. Safe in-memory retries preserve the original
key/body after an uncertain save; conflicts require reload and review.

Validation: 39 live backend tests, 7 web tests, 3 browser journeys, repository
lint/typecheck and web build pass. The browser checks the full persisted path,
Gate/QC permission UX, a concurrent version conflict, reload persistence and
375px layout. Backend PR #3 is green in CI, including Docker/Compose/browser.
No API/schema/dependency changes were needed. This branch adds no migrations.
See CORE_INTERFACE.md for limitations and the synthetic walkthrough handoff.
Human SQL review and merge approval remain outstanding; main is unchanged.

## UI clarity and essential-gap review — 2 November 2026

User requested a clearer interface while preserving backend priority and milestone
updates. Gate/QC now have named task controls, a What needs attention panel,
plain independent statuses, separate corrections and collapsed history. Tare is
distinct from correction; correction reasons are required before submission.
The UI does not enforce an unsigned QC/exit order or equate submission with approval.

Backend review found material search was offered by the UI but absent in the
repository query. Contract 0.4.1 clarifies exact Gate reference vs case-insensitive
vehicle/supplier/material search; both register and pending QC now include material.
No schema, dependency, formula or production permission change was required.

Validation: 39 live API/domain tests, 8 web tests and 3 browser journeys pass,
along with lint/typecheck, API compilation and web build. See WALKTHROUGH.md
for the human feedback checklist and next build boundary. Automated walkthrough
is complete; user workflow acceptance and migration/merge review remain pending.
New work remains local on codex/core-m1-interface; no newer remote CI is claimed.

## Minimal line-entry correction — current local behavior

User rejected the earlier form-heavy workflow and requested few-click operation,
retention of optional details and backend protection against early departure.

- Arrival: Gate Entry number, truck number, gross weight. Weight defaults visibly
  to kg; other units, supplier, material, challan, PO and notes remain under More
  details (optional). Omitted supplier/material are stored as NULL, never guessed.
- Tare: one weight, inheriting the visit's unit. Saving it never records departure.
- QC: one inspection note; detailed readings remain optional. Empty notes without
  any reading are rejected by the API. A note is not an acceptance decision.
- Departure: one explicit Truck has left action, disabled until QC inspection and
  compatible gross/tare/net are recorded. The API checks the same prerequisites
  inside its versioned transaction, so direct requests cannot bypass the UI.
- GRN: number plus Verified in DataMan — save. That explicit action records staff
  verification. It never implies ERP approval or posting.

The operator account header and truck summary are compact. Optional metadata,
corrections and history remain accessible without occupying the normal path.

Contract 0.5.0 makes optional arrival details nullable in responses and optional
in requests. Migration 20261102100000 only drops two NOT NULL constraints; it
does not delete rows or rewrite existing values. Human SQL review is required
before merge. These user-directed changes supersede older statements saying
departure could be recorded before QC/tare or supplier/material were mandatory.

Validation: 41 live backend tests, 8 web tests and 4 browser journeys pass; lint,
all typechecks, API compilation and web build pass. Tests cover three-input
creation, actual optional-detail retention, notes-only QC, both missing departure
prerequisites, rejected empty QC, no exit side effect from tare, rollback of
rejected version claims and safe retry after prerequisites are satisfied.

Pending clarification: whether departure must additionally require an explicit
QC Cleared/Hold decision. Current prototype checks record presence only; it does
not invent acceptance authority, thresholds or a production release SOP. A
human's note must not be interpreted as approval. No production activation or
claim of universal correctness is made. Latest changes remain local/unmerged.

## Explicit QC clearance — current rule confirmed by user

The user explicitly chose Require QC Cleared + tare before departure. This
supersedes the earlier inspection-presence-only prerequisite and the pending
clearance question in historical milestone notes.

QC now has Cleared and Hold actions on its short note form. Clearing can be one
click without a note; Hold requires a short note. Save note only is secondary and
never gives clearance. Optional readings and correction reasons remain available.
Only the existing synthetic qc_operator write role can record these decisions;
Gate cannot clear its own trucks. (Update 2026-11-03, KPMPL decision D-03: the QC
operator records the readings and the final QC decision; there is no other QC decision role.)

QCRevision stores pending/cleared/hold, immutable submittedBy/submittedAt and the
claimed visitVersion. All pre-existing revisions default to pending; nobody is
auto-cleared. Latest QC action is ordered by visitVersion across every inspection,
so editing an older inspection cannot accidentally retain a newer clearance.
Any new note or revision without an explicit decision returns current clearance
to pending. Hold and pending remain in the actionable QC queue until cleared;
departed trucks are excluded. Queue search and pagination still apply.

Departure checks current explicit cleared status plus compatible gross/tare/net
inside the same root-version transaction. Failed attempts roll back their claimed
version and do not consume the retry key. Concurrent Hold/departure with the same
version cannot both commit. The departure audit captures qcClearanceRevisionId
as evidence of the decision used. A new explicit decision after departure is
rejected; later audited note corrections do not undo the recorded physical event.

No accept/reject threshold, deduction formula, ERP approval or release override
has been invented. Production roster/SOP activation is still separate. New SQL
adds only clearance/version columns and constraints; human review is required
before merge. Contract is 0.6.0. Optional arrival details remain unchanged.

Validation: 43 live API/domain tests, 8 component tests and 4 browser journeys
pass. Tests cover pending notes, Hold, missing tare, unauthorized decisions,
revision invalidation, queue transitions, audit rollback, exact retries and the
Hold/departure race. Lint, all typechecks, API compilation, web build and full
history secret scan pass. Changes are local on codex/core-m1-interface; no main
merge, new remote CI claim or production rollout is implied.
