# PROGRESS — v0.8.3 → v0.8.5 overnight run

Baseline recorded 2026-11-04 (git `d23f373`/tag `baseline-v0.8.3`, then fixed to include the
Phase 1-2 uncommitted work as the true starting state).

## Baseline counts (before any fix)

| Suite | Result |
|---|---|
| backend `tsc --noEmit` | pass |
| backend `vitest run` (live deps) | 50 passed / **2 failed** / 9 skipped (61 total) |
| — failures | `policy.spec` (B-23: matrix grew to 8 roles incl. gate_doc_authority), `accounting.e2e-spec` + `security.e2e-spec` (still assume gate holds docs.prepare; the previous session removed it via migrations 20261104053200/20261104140000) |
| frontend `tsc` ×2 | pass |
| frontend `vitest run` | 84/84 passed |
| frontend `eslint src` | **24 errors** / 13 warnings (previous session's uncommitted code) |
| stack | 6 containers healthy; 17 migrations applied; served build == dist |

## Log (one line per completed item)
- startup: baseline committed, LOOP_STATE.md + OPEN_QUESTIONS.md created, baseline suites recorded.
- B-23: policy.spec updated to the 8-role matrix (gate_doc_authority) + new RBAC assertions — 5/5 green.
- spec alignment: accounting + security e2e specs moved to Phase 1-2 RBAC (gate_doc prepares packages) — 9/9 + accounting green.
- B-19: policy.ts gate regains overview.view (DB never removed it — keep-today's-access rule); OQ-3/OQ-4 logged.
- B-15/B-17/B-21/B-22/B-24: backend batch (QC locks after exit/verify; fail-open → 'unscanned'; correction duplicate-ref 409; overview ERP counts include accounting; isDemo reads unfiltered). Backend 62/62, 0 skipped.
- B-11/B-12: accounting money fields (additive migration 20261104210000) + record_amounts action with UI + mock parity; corrections/amounts locked after approval; return_to_ho clears stale approval. Frontend lint errors 24 → 0 (typed mock checks).
- B-28/F-09: reminder route capability = service capability (erp.plant_head_approval); button gating already matches.
- F-08/F-11/F-12/F-14/F-15/F-16/F-17: capability-filtered home cards; idempotency-key rotation on unambiguous failures; check-state re-sync (dead Send button fixed); home counters via server overview (no 500-row cap); blank invoice omitted on create; unknown-status-safe tracker. Frontend: tsc 0 errors, 84/84, lint 0 errors.
- B-16/B-26 + migration 20261104223000_accounting_check_details: accounting-checks endpoint rewritten (was a guaranteed 500), audit appends added, view exposes accountingChecks, head-accountant cases use real states. F-07 grants aligned. Backend 62/62, 0 skipped.
