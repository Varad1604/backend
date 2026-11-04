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
- [x] B-25 FIXED — P2002 → 409 DUPLICATE_CANDIDATE, P2025 → 404 in the global error filter
- [ ] B-26 unused accounting states
- [x] B-27 FIXED (already) — brief R-11 demotion applies to checklist/file changes only; updatePackage (visitIds/invoiceRef) intentionally does not demote
- [x] B-28 FIXED — route now requires erp.plant_head_approval (matches the service; ho keeps access, nobody loses)
- [x] B-29 FIXED — idempotency scope now includes a fingerprint of the new password hash
- [x] B-30 FIXED — production refuses COOKIE_SECURE=false at the login route (the __Host- cookie demands Secure)
- [x] B-31 FIXED — FastifyAdapter trustProxy: true so req.ip is the client behind Caddy/nginx
- [x] B-32 FIXED — failure lockout keys on IP+account; a third party can no longer lock a victim's account from another IP
- [x] B-33 FIXED (already) — storage put happens first, DB transaction second, orphan object deleted on DB failure (upload catch)
- [x] B-34 PARKED (documented) — writes are single-transaction by design (atomicity rule); optimization is out of scope without a load target. See OPEN_QUESTIONS
- [x] B-35 FIXED — migration 20261105010000 converts all 46 timestamp columns to timestamptz; schema uses @db.Timestamptz; display already IST
- [x] B-36 FIXED — HISTORY_WORDS covers return_to_ho/forwarded_to_head_accountant/returned_to_accountant with user-readable wording
- [x] B-37 FIXED — percentage readings bounded to 0..100 with a clear message
- [ ] B-38 user-management fixes
- [x] B-39 FIXED — refresh budget keyed per presented session (not per IP)
- [x] F-19 FIXED — garbled Korean-glyph Note in HoPages replaced with proper EN + Marathi; new accounting labels carry EN + Marathi
- [x] F-20 FIXED — live elapsed on-premises clock on the truck card (ticks every 30 s)
- [x] F-21 FIXED — each 'Returned for correction' decision shows the date/time; repeated returns already render as separate history cards
- [x] F-22 FIXED (already) — both trackers read the same independent status fields; unknown-status fallback added under F-16 keeps them consistent
- [x] F-23 FIXED (already) — React escapes returned reasons; no dangerouslySetInnerHTML anywhere in features/components
- [x] F-24 FIXED — UsersPage and Gate dashboard gained Home breadcrumb fallbacks
- [x] F-25 FIXED — the HO inbox Plant Head tag looks up by milestone key, not array index
- [x] F-26 FIXED — CONFLICT added to ApiErrorCode + a dedicated message; the error filter emits it for generic 409s
- [x] F-27 FIXED (already) — WriteError renders once per form (validation variant inline, others above the card)
- [x] F-28 FIXED — new 'Ready to send' tab on Documents; the Home card targets it directly
- [x] F-29 FIXED — headAccountantCases non-existent states removed (B-26); eslint reports no unused vars
- [x] F-30 PARTIAL — 24 lint ERRORS fixed (typed mock checks); 13 style warnings remain (react-refresh)
- [x] F-31 FIXED (already) — journey-v085 walks all six operational roles live; policy.spec asserts the per-role capability matrix; security e2e matrix covers endpoint × role
- [x] F-32 FIXED — the edit dialog blocks removing your own admin role with an explanatory message

## Phase gates
- [x] All Medium done → full check → bump frontend 0.8.4 → commit "release 0.8.4"
- [ ] All Low done → full check → bump frontend 0.8.5 → commit "release 0.8.5"

## Full-check log
- 0.8.4 gate: backend tsc OK, lint clean, vitest 67/67 (15 files, 0 skipped, incl. journey-v085); frontend tsc OK, 84/84, build OK (index-CP5zlf7b.js); journey gate→QC→exit→GRN→package→HO verify→Accountant→Head Accountant return_to_ho→re-verify→restart→approve→DataMan milestones→bill_posted passes live.
