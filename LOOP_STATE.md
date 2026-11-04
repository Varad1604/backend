# LOOP_STATE — v0.8.3 → v0.8.5 backlog

Re-read at the start of every cycle. Mark items `[x] FIXED`, `[x] FIXED (already)`, `[p] PARKED` (reason in OPEN_QUESTIONS.md).

## Phase 3, Medium
- [x] B-11 FIXED — additive migration 20261104210000_accounting_money_fields (4 nullable decimals), record_amounts action + view + UI inputs + mock parity; OQ-2 logged
- [x] B-12 FIXED — corrections/amounts locked once accounting_approved; return_to_ho clears approvedBy/At
- [p] B-13 PARKED — blocking ERP milestones after bill_posted would remove an action HO staff can perform today (late manual DataMan confirmations); stricter-option rule → OQ-8
- [ ] B-14 no gross weight change after exit
- [x] B-15 FIXED — qc.service submit+decide reject after exit or once the package is past HO verification
- [ ] B-16 close audit trail gaps, every state change audited
- [x] B-17 FIXED — fail-open stores scanStatus 'unscanned' (never served, never resolves a checklist row)
- [x] B-18 FIXED — production refuses the stock S3 secret and well-known weak app passwords; env.spec.ts covers it
- [x] B-19 FIXED — policy.ts gate keeps overview.view (DB never removed it; keep-today's-access rule); ensureRole/seed already sync from policy.ts; OQ-3
- [x] B-20 FIXED — snapshot gains record_amounts + money fields on AccountingInfo, /accounting/queue + /document-packages/{id}/erp-milestones/plant-head-approval routes, IDEMPOTENCY_IN_PROGRESS error code; contract test counts updated (40 paths)
- [x] B-21 FIXED — correct() checks duplicates (advisory lock + 409 DUPLICATE_CANDIDATE) when the ref changes
- [x] B-22 FIXED — ERP_COUNTING_STATES includes every accounting state in reports.service
- [x] B-23 FIXED — policy.spec updated to the 8-role matrix incl. gate_doc_authority + new RBAC checks (safe default applied; OQ-4)
- [x] B-24 FIXED — isDemo filters removed from reads; create no longer forces the flag; OQ-5
- [ ] F-07 frontend RBAC matches the backend (gate_doc_authority overview, ho Plant Head)
- [x] F-08 FIXED — every card declares its capability and homeCardsFor filters through can()
- [x] F-09 FIXED (already, post-B-28) — the button is gated by the Plant Head approval capability, which is what the route now requires
- [x] F-11 FIXED — useWrite rotates the key on unambiguous failures; keeps it only for network/server-error ambiguity
- [x] F-12 FIXED — checks state re-syncs on every write response and reload; deeper root cause fixed: the checks endpoint wrote unknown Prisma args (guaranteed 500) and the view lacked accountingChecks (migration 20261104223000_accounting_check_details)
- [x] F-13 FIXED — first entry of a value is normal data entry (audit notes 'Initial entry.'); a reason is asked only for changes
- [x] F-14 FIXED — home counters come from the server-side overview (SQL-computed), no 500-row fetch
- [x] F-15 FIXED — blank invoiceRef is omitted on package create (added later via the existing update path)
- [x] F-16 FIXED — PackageStatusTag falls back to the raw status; owner lookups use a safe accessor
- [x] F-17 FIXED (via F-12) — the button was dead because the check state never re-synced after reloads
- [x] F-18 FIXED — mock return_to_ho parity added; record_amounts/checks/states already mirrored (mock inputs typed to the shared contract)

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
