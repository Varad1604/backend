# API_CHANGES_v0.8 — backend (NestJS/Prisma)

Scope: v0.8.3 → v0.8.5. Every change lists its backlog ID. Additive migrations only.

## Migrations (new, in order)
1. `20261104210000_accounting_money_fields` — B-11: four nullable decimal columns on
   `AccountingRecord` (invoiceAmount, gstAmount, tdsAmount, netAmount). No computations.
2. `20261105010000_timestamps_with_time_zone` — B-35: all 46 `timestamp(3)` columns converted
   to `timestamptz` (the application always wrote UTC instants; display stays IST).
3. `20261104223000_accounting_check_details` — B-16/F-12: the per-check JSON detail columns
   (`bill_check`, `gst_check`, `tds_check`) the check-table migration lacked.

## Endpoint / behavior changes
- **B-11** `POST /document-packages/{id}/accounting` accepts a new action
  `{ kind: 'record_amounts', invoiceAmount?, gstAmount?, tdsAmount?, netAmount? }` (money =
  decimal strings, ≤2 fractional digits; at least one per call; `null` clears). The package
  view carries the four amounts as fixed 2-decimal strings.
- **B-12** `correct_accounting` / `record_amounts` are **locked once accounting_approved**
  (only post_bill or return_to_ho remain). `return_to_ho` clears approvedBy/approvedAt.
- **B-15** QC submit and decide are refused (DOMAIN_RULE) once the truck has exited or its
  package is past HO verification.
- **B-21** visit corrections check Gate Entry uniqueness (advisory lock + 409
  DUPLICATE_CANDIDATE with `meta.existingId`) when the ref changes.
- **B-17** fail-open scanner failures store files as `scanStatus: 'unscanned'` — never
  served, never satisfy a checklist row.
- **B-25** the global error filter maps Prisma P2002 → 409 DUPLICATE_CANDIDATE and P2025 →
  404 with user-readable messages.
- **B-16** `POST /accounting/cases/{id}/checks` rewritten to the real column model (the old
  code wrote unknown Prisma args — a guaranteed 500) and now appends an audit event.
- **B-26** `GET /head-accountant/cases` queries the real states (with_head_accountant,
  accounting_approved) and requires accounting.approve.
- **B-28/F-09** the reminder route requires `erp.plant_head_approval` — same as the service.
- **B-22** overview ERP counters count packages in every accounting state.
- **B-24** reads no longer filter `isDemo` (the column stays; display/seed use only).
- **B-19** policy.ts is the single source for the role/capability matrix; the gate keeps
  overview.view (the DB never removed it — keep-today's-access rule).
- **B-29** change-password idempotency scope includes a fingerprint of the new password.
- **B-30** production refuses COOKIE_SECURE=false at the login route.
- **B-31** `trustProxy: true` so req.ip is the client behind Caddy/nginx.
- **B-32** the login failure lockout keys on IP+account — no remote account lockout.
- **B-37** QC percentage readings are bounded to 0..100.
- **B-39** the refresh rate budget is keyed per presented session.
- **B-36** history wording covers return_to_ho / forwarded_to_head_accountant /
  returned_to_accountant.
- **B-23** policy.spec expects the current 8-role matrix incl. gate_doc_authority.

## Error codes
`CONFLICT` (generic 409), `IDEMPOTENCY_IN_PROGRESS`, `RATE_LIMITED`, `DUPLICATE_CANDIDATE`
are documented in the OpenAPI snapshot; the filter emits them.

## Journey proof
`test/journey-v085.e2e-spec.ts` walks live: gate → QC (accept with deduction) → exit →
GRN → package (Document Authority) → HO verify → Accountant (checks + amounts + handover) →
Head Accountant **return to HO** → re-verify → restart → handover → approve → DataMan
plant-head/voucher/final-posting milestones → bill_posted → duplicate post refused.
