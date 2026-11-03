# KPMPL Issue Tracker (audit of 2026-11-03/04)

Baseline: git `b67df5c`. Every issue found by the independent audit, with current disposition.
Evidence references point into `01_INITIAL_AUDIT_REPORT.md`, `02_REMEDIATION_REPORT.md`,
`TEST_EVIDENCE.md` and `audit-reports/screenshots/`.

## Confirmed defects

| ID | Severity | Title | Disposition |
|---|---|---|---|
| KPMPL-001 | Medium | Server accepted characters outside the brief §3 safe charset in refs/names (control-chars-only validation; mock adapter was stricter — adapter inconsistency) | **Fixed and verified** — charset refinement added server-side; regression test added; backend suite 61/61; live audit: unsafe refs now 422 (VAL-001/001b) |
| KPMPL-002 | Low-Medium | Operations Overview blind to the accounting chain (counters ended at `verified`; posted bills and in-flight accounting invisible to management) | **Fixed and verified** — `withAccounting` + `billPosted` counters added server-side, contract + types + page + mock updated; live checks OVER-001…003; screenshot `overview-ho-fixed-1440.png` |
| KPMPL-003 | Low | Local web container served the SPA without security headers and kept its config in %TEMP% (fragile + unhardened) | **Fixed and verified** — hardened config deployed in place + `nginx -s reload`; headers verified by curl; durable copy saved as `frontend/kpmpl-frontend/nginx-local.conf` |

## Cleared suspicions (verified NOT defects)

| Ref | Suspicion | Disposition |
|---|---|---|
| S-1 | QC can download the receiving CSV | Not reproducible as defect — the brief §4 grants `qc` `overview.view`; policy, frontend grants and the security e2e matrix all agree |
| S-2 | Admin gets 403 on the Gate document-packages list | By design — admin holds `ho.inbox`, not `docs.prepare` (brief §4) |
| S-3 | Weighment/exit/GRN writes return 201 | Nest POST default; consistent; harmless |
| S-4 | QC decisions require the visit version which the submit just bumped | Documented contract ("which version is checked", brief §3); the UI re-reads; clients must too |
| S-5 | Global five-session eviction can kill a live session when a 6th login arrives | Documented capacity rule (brief: 10 users / 5 concurrent sessions); the UI handles the resulting 401 with the session-expired flow |
| S-6 | Login rate limit throttles back-to-back full E2E runs | Operational note (5/min per IP+username); ~1 min cooldown between runs |

## Open / deferred items

| Ref | Item | Disposition |
|---|---|---|
| D-1 | Editable *financial* accounting fields (amounts, tax, ledger codes) | **Blocked on business decision** — deliberately not invented (see DECISIONS.md D-A4) |
| D-2 | PO vs Purchase-Voucher distinction in the accounting chain | **Blocked on business decision** |
| D-3 | Coupling between internal "Bill Posted" and the external DataMan "final posting" milestone | **Blocked on business decision** — kept deliberately independent |
| D-4 | Overview report layout itself ("pending KPMPL confirmation" note in the UI) | **Blocked on business decision** — the KPMPL-002 counters were added within the existing layout |
| O-1 | 13 pre-existing ESLint warnings in the frontend (react-refresh export style) | **Deferred** — style-only, matches the existing codebase convention, 0 errors |
| O-2 | Frontend `openapi.yaml` is a hand-maintained snapshot of the backend contract | **Deferred** — pre-existing arrangement (generated source of record: `backend/packages/contracts`); snapshot extended and kept in sync for this audit's changes |
| O-3 | No remote CI run for the audit fixes | **Deferred by policy** — local-only work; CI runs on push, which is out of scope |
