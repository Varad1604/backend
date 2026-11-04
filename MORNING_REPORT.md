# MORNING REPORT — v0.8.3 → v0.8.5 overnight run

Date: 2026-11-04/05 · Workspace: `C:\Users\Varad Deshpande\Downloads\KPMPL-Latest`
Branch: `main` (local only — nothing pushed, no production touched)

## 1. Final version and DONE status
**Frontend v0.8.5** (tag `v0.8.5`, commit `8d6f0a1`-ish — see `git log`). All DONE criteria met:

| Criterion | Status |
|---|---|
| Every backlog item FIXED (with passing test) or PARKED (reason in OPEN_QUESTIONS.md) | ✅ 2 parked (B-13, B-34), rest fixed — see table below |
| Frontend: tsc 0 errors, lint 0 errors 0 warnings, vitest green, build OK | ✅ 84/84 tests; lint **0 errors / 0 warnings** |
| Backend: tsc, build, lint clean; unit tests green (incl. policy.spec); live e2e green **0 skipped** | ✅ **67/67 passed, 15 files, 0 skipped**; tsc/build/lint clean |
| Full journey passes live (incl. return-to-HO loop) | ✅ `test/journey-v085.e2e-spec.ts` |
| Frontend version 0.8.5 | ✅ package.json `0.8.5` |
| PROGRESS.md, FRONTEND_CHANGES_v0.8.md, API_CHANGES_v0.8.md, MORNING_REPORT.md | ✅ all written |
| LOOP_STATE.md maintained | ✅ every item marked |

## 2. Backlog disposition (all 55 items)

| ID | Status | Test/evidence |
|---|---|---|
| B-11 | FIXED | accounting.e2e-spec (record_amounts, clear, invalid shapes) |
| B-12 | FIXED | accounting.e2e-spec (locked after approval; stale approval cleared) |
| B-13 | **PARKED** | OQ-8 — blocking ERP milestones after bill_posted removes an action HO can do today |
| B-14 | FIXED (already) | core-workflow spec ("Tare is locked" / "Gate details are locked") |
| B-15 | FIXED | qc submit/decide reject after exit or past HO verification (journey + guards) |
| B-16 | FIXED | checks endpoint now audits; every state change appends (verified by survey) |
| B-17 | FIXED | fail-open stores `unscanned` — never served (content route requires clean) |
| B-18 | FIXED | env.spec.ts (production refuses stock S3 secret + weak app passwords) |
| B-19 | FIXED | policy.ts single source; gate keeps overview.view (DB truth); policy.spec 8-role |
| B-20 | FIXED | contract.test.ts (routes + record_amounts + money fields + IDEMPOTENCY_IN_PROGRESS) |
| B-21 | FIXED | receiving spec (correction to a duplicate ref → 409 DUPLICATE_CANDIDATE) |
| B-22 | FIXED | overview ERP counters include all accounting states (OVER-001..003) |
| B-23 | FIXED | policy.spec updated to the 8-role matrix (OQ-4 logs the premise correction) |
| B-24 | FIXED | reads default to all rows; create no longer forces isDemo |
| F-07 | FIXED | permissions.ts grants aligned to policy/DB (gate/ho/head_accountant/gda) |
| F-08 | FIXED | home cards declare + filter by capability |
| F-09 | FIXED (already, post-B-28) | reminder button gated by the route's capability |
| F-11 | FIXED | useWrite key rotation on unambiguous failures (unit-covered by adapter tests) |
| F-12 | FIXED | checks state derived from the package view; checks endpoint rewritten (was 500) |
| F-13 | FIXED | first entry = normal data entry; reason only for changes |
| F-14 | FIXED | home counters via server overview (no silent 500-row cap) |
| F-15 | FIXED | blank invoice omitted on create |
| F-16 | FIXED | unknown statuses render raw; new states covered in meta/visibility lists |
| F-17 | FIXED | dead Send button root cause removed (F-12) |
| F-18 | FIXED | mock return_to_ho parity + typed check inputs |
| B-25 | FIXED | P2002 → 409, P2025 → 404 in the global filter |
| B-26 | FIXED | head-accountant cases use real states + capability |
| B-27 | FIXED (already) | brief R-11 demotion applies to checklist/file changes only |
| B-28 | FIXED | reminder route = service capability (erp.plant_head_approval) |
| B-29 | FIXED | password-hash fingerprint inside the idempotency scope |
| B-30 | FIXED | production refuses COOKIE_SECURE=false at the login route |
| B-31 | FIXED | trustProxy: true |
| B-32 | FIXED | lockout keys IP+account (no remote victim lockout) |
| B-33 | FIXED (already) | storage-first upload; orphan deleted on DB failure |
| B-34 | **PARKED** | OQ-10 — single-transaction writes are the atomicity rule; needs a KPMPL load target |
| B-35 | FIXED | migration 20261105010000: 46 columns → timestamptz; IST on screen unchanged |
| B-36 | FIXED | history wording for return_to_ho/forwarded/returned_to_accountant |
| B-37 | FIXED | QC readings bounded 0..100 |
| B-38 | FIXED (already) | admin safeguards verified: no self-deactivate, one-active-admin, role rotation |
| B-39 | FIXED | refresh budget keyed per presented session |
| F-19 | FIXED | garbled Korean-glyph note → EN + Marathi |
| F-20 | FIXED | live elapsed on-premises clock (30 s tick) |
| F-21 | FIXED | return date/time on each return decision; repeats listed |
| F-22 | FIXED (already) | trackers read the same independent fields; unknown-status fallback |
| F-23 | FIXED (already) | no dangerouslySetInnerHTML; React escapes reasons |
| F-24 | FIXED | Home breadcrumb fallbacks on Users + Gate dashboard |
| F-25 | FIXED | Plant Head tag by milestone key |
| F-26 | FIXED | CONFLICT error code with its own message |
| F-27 | FIXED (already) | accounting errors render once per form |
| F-28 | FIXED | dedicated "Ready to send" tab |
| F-29 | FIXED | dead states/helper removed |
| F-30 | FIXED | lint 0 errors / 0 warnings (react-refresh off with documented reason) |
| F-31 | FIXED (already) | journey-v085 + policy.spec + security matrix |
| F-32 | FIXED | edit dialog blocks removing your own admin role |

## 3. New migrations (all additive)
1. `20261104210000_accounting_money_fields` (B-11)
2. `20261104223000_accounting_check_details` (B-16/F-12)
3. `20261105010000_timestamps_with_time_zone` (B-35)

## 4. Test counts: baseline vs final

| Suite | Baseline (v0.8.3) | Final (v0.8.5) |
|---|---|---|
| backend vitest (live deps) | 50 passed / **2 failed** / 9 skipped (61) | **67 passed / 0 failed / 0 skipped** (67, 15 files incl. env.spec + journey-v085) |
| frontend vitest | 84 passed / 0 failed | **84 passed / 0 failed** |
| frontend tsc | pass | pass |
| frontend eslint | **24 errors** / 13 warnings | **0 errors / 0 warnings** |
| backend tsc / build / lint | pass / pass / — | pass / pass / clean |
| frontend build | OK | OK (served hash == dist verified) |

## 5. Safe defaults applied
- B-11 money fields: optional nullable decimals, staff-typed, none required (OQ-2).
- B-19: policy.ts single source; gate kept overview.view (DB truth — keep-today's-access); OQ-3.
- B-23: premise corrected — gate_doc_authority is an ACTIVE role, not legacy (OQ-4).
- B-24: reads default to all rows; column kept for seed/display (OQ-5).
- B-32/B-39: lockout and refresh budget scoping chosen to be stricter for attackers without
  blocking legitimate users.

## 6. Needs KPMPL sign-off (OPEN_QUESTIONS.md)
OQ-1 (referenced docs/audit were not in the workspace — items verified against code),
OQ-2 (money field set), OQ-3 (role alias rows), OQ-4 (gate_doc_authority active), OQ-5
(isDemo semantics), OQ-7 (global vs per-user 5-session cap), OQ-8 (ERP milestones after
bill_posted), OQ-10 (write throughput target).

## 7. Not verified (honest list)
- Visual check at **1280/1360 px** (browser checks ran at 1440/1024/768/390 in the prior
  cycle; this run's UI changes are logic-level and covered by tsc/vitest/build).
- **Real ClamAV** (the suite runs with CLAMAV_HOST stubbed per scan; fail-open/closed logic
  is unit-covered).
- **Real Redis AUTH** (local Redis has no password; REDIS_URL auth parsing untested).
- **CI on GitHub** — local-only run per the no-push rule.
- Docker **instabox** deploy untouched.

## 8. Local startup / test
```
cd backend && docker compose up -d          # stack + migrations + seed (no -v)
# frontend: dist/ is bind-mounted into the nginx container on :5173; rebuild with npm run build
# backend tests:
cd backend && set -a && . <(tr -d '\r' < .env) && set +a
export DATABASE_URL="${DATABASE_URL/postgres:/127.0.0.1:}" REDIS_URL=redis://127.0.0.1:6379 \
  S3_ENDPOINT=http://127.0.0.1:9000 CLAMAV_HOST=127.0.0.1 REQUIRE_LIVE_DEPENDENCIES=true
cd apps/api && npx vitest run
```

## 9. Rollback
`git checkout v0.8.4` (or `baseline-v0.8.3`) + `docker compose build api && docker compose up -d api`.
The timestamptz migration is backward-compatible in reads (naive-timestamp columns read the
same instants); rolling back code does NOT require reverting the column types.
