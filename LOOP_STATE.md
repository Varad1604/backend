# LOOP_STATE — v0.8.3 → v0.8.5 backlog

Re-read at the start of every cycle. Mark items `[x] FIXED`, `[x] FIXED (already)`, `[p] PARKED` (reason in OPEN_QUESTIONS.md).

## Phase 3, Medium
- [ ] B-11 money fields on the accounting case (safe default: optional nullable invoiceAmount, gstAmount, tdsAmount, netAmount decimal columns + UI inputs; none required; log in OPEN_QUESTIONS.md)
- [ ] B-12 lock accounting fields after approval, clear stale approval on return
- [ ] B-13 no ERP milestone confirm/reverse after bill_posted
- [ ] B-14 no gross weight change after exit
- [ ] B-15 no QC re-submit/re-decide after exit, HO verify or posting
- [ ] B-16 close audit trail gaps, every state change audited
- [ ] B-17 scanner fail-open never marks files clean
- [ ] B-18 refuse default secrets in production
- [x] B-19 FIXED — policy.ts gate keeps overview.view (DB never removed it; keep-today's-access rule); ensureRole/seed already sync from policy.ts; OQ-3
- [ ] B-20 sync OpenAPI with routes and add the new error codes
- [ ] B-21 unique Gate Entry No. including through corrections
- [ ] B-22 overview ERP counts include accounting states
- [x] B-23 FIXED — policy.spec updated to the 8-role matrix incl. gate_doc_authority + new RBAC checks (safe default applied; OQ-4)
- [ ] B-24 remove hard-coded isDemo (safe default: keep column, stop hard-coding true, reads default to all rows; log it)
- [ ] F-07 frontend RBAC matches the backend (gate_doc_authority overview, ho Plant Head)
- [ ] F-08 Home cards filtered by capability
- [ ] F-09 hide Log reminder without erp.confirm
- [ ] F-11 new Idempotency-Key when payload/version changes
- [ ] F-12 refresh accountant checks after writes/reloads
- [ ] F-13 enter the accounting reference normally
- [ ] F-14 paging or a warning instead of the silent 500-row cap
- [ ] F-15 add invoice no. later, send nothing for blank
- [ ] F-16 tracker safe on unknown statuses
- [ ] F-17 hide the dead Send to Head Accountant button
- [ ] F-18 mock and http adapters behave the same

## Phase 4, Low
- [ ] B-25 remaining Prisma errors → 409/404
- [ ] B-26 unused accounting states
- [ ] B-27 editing a ready package returns it to draft
- [ ] B-28 reminder route/service same capability
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
- [ ] F-30 zero lint warnings (also: fix the 24 baseline lint ERRORS)
- [ ] F-31 workflow and RBAC tests per role
- [ ] F-32 admin can't remove their own admin role

## Phase gates
- [ ] All Medium done → full check → bump frontend 0.8.4 → commit "release 0.8.4"
- [ ] All Low done → full check → bump frontend 0.8.5 → commit "release 0.8.5"

## Full-check log
- (pending first run)
