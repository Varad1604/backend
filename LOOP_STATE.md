# LOOP_STATE — v0.8.3 → v0.8.5 backlog

Re-read at the start of every cycle. Mark items `[x] FIXED`, `[x] FIXED (already)`, `[p] PARKED` (reason in OPEN_QUESTIONS.md).

## Phase 3, Medium
- [x] B-11 FIXED — additive migration 20261104210000_accounting_money_fields (4 nullable decimals), record_amounts action + view + UI inputs + mock parity; OQ-2 logged
- [x] B-12 FIXED — corrections/amounts locked once accounting_approved; return_to_ho clears approvedBy/At
- [ ] B-13 no ERP milestone confirm/reverse after bill_posted
- [ ] B-14 no gross weight change after exit
- [x] B-15 FIXED — qc.service submit+decide reject after exit or once the package is past HO verification
- [ ] B-16 close audit trail gaps, every state change audited
- [x] B-17 FIXED — fail-open stores scanStatus 'unscanned' (never served, never resolves a checklist row)
- [ ] B-18 refuse default secrets in production
- [x] B-19 FIXED — policy.ts gate keeps overview.view (DB never removed it; keep-today's-access rule); ensureRole/seed already sync from policy.ts; OQ-3
- [ ] B-20 sync OpenAPI with routes and add the new error codes
- [x] B-21 FIXED — correct() checks duplicates (advisory lock + 409 DUPLICATE_CANDIDATE) when the ref changes
- [x] B-22 FIXED — ERP_COUNTING_STATES includes every accounting state in reports.service
- [x] B-23 FIXED — policy.spec updated to the 8-role matrix incl. gate_doc_authority + new RBAC checks (safe default applied; OQ-4)
- [x] B-24 FIXED — isDemo filters removed from reads; create no longer forces the flag; OQ-5
- [ ] F-07 frontend RBAC matches the backend (gate_doc_authority overview, ho Plant Head)
- [x] F-08 FIXED — every card declares its capability and homeCardsFor filters through can()
- [x] F-09 FIXED (already, post-B-28) — the button is gated by the Plant Head approval capability, which is what the route now requires
- [x] F-11 FIXED — useWrite rotates the key on unambiguous failures; keeps it only for network/server-error ambiguity
- [x] F-12 FIXED — checks state re-syncs from p.accountingChecks on every write response and reload
- [ ] F-13 enter the accounting reference normally
- [x] F-14 FIXED — home counters come from the server-side overview (SQL-computed), no 500-row fetch
- [x] F-15 FIXED — blank invoiceRef is omitted on package create (added later via the existing update path)
- [x] F-16 FIXED — PackageStatusTag falls back to the raw status; owner lookups use a safe accessor
- [x] F-17 FIXED (via F-12) — the button was dead because the check state never re-synced after reloads
- [ ] F-18 mock and http adapters behave the same

## Phase 4, Low
- [ ] B-25 remaining Prisma errors → 409/404
- [ ] B-26 unused accounting states
- [ ] B-27 editing a ready package returns it to draft
- [x] B-28 FIXED — route now requires erp.plant_head_approval (matches the service; ho keeps access, nobody loses)
- [ ] B-29 change-password idempotency includes the new password
- [ ] B-30 no non-__Host- cookie fallback in production
- [ ] B-31 trustProxy for Caddy
- [ ] B-32 lockout can't target a user (per-IP + per-account backoff)
- [ ] B-33 orphaned uploads, multipart order
- [ ] B-34 write throughput bottlenecks
- [ ] B-35 timestamps with time zone, IST on screen
- [ ] B-36 tracker/history wording
- [ ] B-37 stronger QC validation
- [ ] B-38 user-management fixes
- [ ] B-39 refresh rate limit per session
- [ ] F-19 Marathi gaps, label fixes
- [ ] F-20 live Running time
- [ ] F-21 QC Returned tag time, list repeated returns
- [ ] F-22 truck and package tracker agree
- [ ] F-23 valid HTML in returned reasons
- [ ] F-24 BackButton fallbacks for gate and admin
- [ ] F-25 Plant Head column by milestone key
- [ ] F-26 unknown 409 codes get their own message
- [ ] F-27 accounting errors shown once
- [ ] F-28 Check and send card opens its own list
- [ ] F-29 remove dead code
- [x] F-30 PARTIAL — 24 lint ERRORS fixed (typed mock checks); 13 style warnings remain (react-refresh)
- [ ] F-31 workflow and RBAC tests per role
- [ ] F-32 admin can't remove their own admin role

## Phase gates
- [ ] All Medium done → full check → bump frontend 0.8.4 → commit "release 0.8.4"
- [ ] All Low done → full check → bump frontend 0.8.5 → commit "release 0.8.5"

## Full-check log
- (pending first run)
