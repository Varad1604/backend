# KPMPL Implementation Decisions & Open Business Ambiguities

Recorded while implementing the accounting upgrade. Nothing here invents financial rules;
ambiguities are listed as pending KPMPL decisions with a safe prototype default.

## Decisions made (prototype-safe, documented)

### D-A1 — New role codes and capabilities
- Role codes: `accountant`, `head_accountant` (snake_case, matching existing `gate_doc` style).
- New capabilities:
  - `accounting.inbox` — view the accounting queue and packages in accounting-visible states.
  - `accounting.review` — Accountant working actions (start accounting, submit to Head Accountant, propose corrections).
  - `accounting.approve` — Head Accountant approval / return-to-accountant actions.
  - `accounting.post` — Head Accountant posts the bill (final internal state).
- Grants:
  - `accountant`: receiving.view, overview.view, accounting.inbox, accounting.review
  - `head_accountant`: accountant set + accounting.approve + accounting.post
- Rationale: least privilege; mirrors the existing role/capability table pattern (data-driven, D-07).

### D-A2 — Workflow states (additive string values, no enum destruction)
`verified` (existing HO verify) → `with_accounting` → `with_head_accountant` →
`accounting_approved` → `bill_posted`.
- `start_accounting` (accounting.review): verified → with_accounting
- `submit_to_head_accountant` (accounting.review): with_accounting → with_head_accountant (requires confirmComplete)
- `return_to_accountant` (accounting.approve): with_head_accountant → with_accounting (reason required)
- `approve_accounting` (accounting.approve): with_head_accountant → accounting_approved
- `post_bill` (accounting.post): accounting_approved → bill_posted (requires a typed bill reference;
  once posted the package is terminal — duplicate posting is rejected with DOMAIN_RULE).
- All writes: Idempotency-Key + If-Match (package version) + one transaction + audit + history.

### D-A3 — Internal Bill Posting ≠ external ERP confirmation
- "Bill Posted" is an INTERNAL accounting status driven by the Accountant/Head Accountant workflow.
- The existing `ErpMilestone` rows (plant_head_grn_approval, purchase_voucher, final_posting) remain
  separate manual staff confirmations (`source=manual_staff_confirmation`) recorded by `ho`.
- The two tracks are independent on purpose; KPMPL has not decided how (or whether) they map.
- PENDING KPMPL: does final_posting in DataMan coincide with internal bill_posted? No coupling added.

### D-A4 — Editable accounting fields (corrections)
- Only two non-financial fields are correctable in this build:
  - `accountingRef` — opaque reference string, stored EXACTLY as typed (same rules as DataMan refs;
    purpose — internal bill ref vs DataMan voucher ref — PENDING KPMPL).
  - `accountantNote` / `headAccountantNote` — free-text working notes.
- Corrections require a reason (≤500 chars); every correction writes:
  field-level before/after in `AccountingCorrection` + append-only `AuditEvent` + PackageHistory row.
- NO amounts, tax, ledger codes, or payment data are added. PENDING KPMPL: authorized financial fields.

### D-A5 — Visibility
- ACCOUNTING_VISIBLE = [verified, with_accounting, with_head_accountant, accounting_approved, bill_posted].
- `accountant`/`head_accountant` see packages only in these states (else NOT_FOUND).
- HO visibility extended to the same set (was: through `verified`) so HO keeps its existing
  ERP-milestone confirmation duties after handoff ("all existing roles retain authorized functions").
- PDF download right extended to `accounting.inbox` holders for packages in accounting-visible states
  (accountants must see the supplier invoice they are accounting for).
- Gate `docs.prepare` list unchanged (still sees all packages read-only after handoff).

### D-A6 — Seed accounts
- New demo users `demo-accountant`, `demo-head-accountant` (DEMO_PASSWORD env, same as others).
- Seed remains idempotent: upsert only these two + role rows; existing users/visits/packages untouched.
- New synthetic demo visit DEMO-GATE-0005 + package DEMO-PKG-0003 in `verified` state so the
  accounting queue is demonstrable end-to-end.

### D-A7 — Frontend role-specific UI
- HomePage = role job cards: each role's landing card list filtered by capability.
- Nav is capability-filtered (already capability-driven; extended for accounting).
- Accounting UI is a new feature module; HO/Gate/QC screens unchanged except status labels.
