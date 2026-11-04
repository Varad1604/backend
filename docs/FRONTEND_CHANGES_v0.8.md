# FRONTEND_CHANGES_v0.8 — frontend/kpmpl-frontend

Scope: v0.8.3 → v0.8.5. Every change lists its backlog ID. "EN+Marathi" labels are marked.

## New screens / flows
- **Accounting workflow UI** (`features/accounting/AccountingPages.tsx`): queue with stage
  tabs (From Head Office / With Accountant / With Head Accountant / Approved / Posted),
  package page with the accounting card, documents checklist (read-only), DataMan milestones
  (read-only for accounts), and the full history timeline.
- **Accounting checks** (bill passed / GST checked / TDS checked): checkbox trio, saved via
  `POST /accounting/cases/{id}/checks`; state derives from the current package view.
- **Amounts** (B-11): four optional staff-typed inputs (Invoice / GST / TDS / Net) with the
  current values shown as hints; saved via the `record_amounts` action; locked once approved
  (B-12). EN + Marathi note: "Entered by staff. The system never calculates these."
  (रक्कम कर्मचाऱ्यानी भरावी; प्रणाली स्वतः हिशोब करत नाही.)

## RBAC (F-07)
- `grants` aligned to the backend policy/DB: `gate` keeps overview.view but holds no
  docs.prepare; **gate_doc_authority** is a first-class role (docs.prepare + docs.submit +
  Plant Head approval); `ho` gains erp.purchase_voucher + erp.plant_head_approval;
  `head_accountant` gains erp.final_posting. roleLabel entries are Marathi-first with the
  same strings as the DB.

## Home screen (F-08, F-28)
- Every card declares the capability it needs; `homeCardsFor` filters through `can()`.
- Counter loads use the server-side overview (F-14) instead of a 500-row page fetch.
- The "Check and send" card opens a dedicated **Ready to send** tab (F-28).

## Reliability / correctness
- **F-11**: useWrite rotates the Idempotency-Key after any unambiguous failure (validation,
  conflict, permission, not-found) and keeps it only for network/server ambiguity.
- **F-12/F-17**: check state derives from the current package view — the Send to Head
  Accountant button can no longer stay dead after a reload.
- **F-16**: unknown package statuses render as the raw code (no crash); owner lookups use a
  safe accessor. All three new statuses (returned_to_ho, returned_to_accountant,
  forwarded_to_head_accountant) are typed, covered in status meta, and included in
  ACCOUNTING_VISIBLE/HO_VISIBLE.
- **F-26**: the error map gains `CONFLICT` with its own message.

## UX (F-13, F-19, F-20, F-21, F-24, F-25, F-28)
- F-13: first entry of an accounting value is normal data entry (audit notes "Initial
  entry."); a reason is asked only when changing something already on file.
- F-19: the garbled (Korean-glyph) note in HoPages is replaced with proper EN + Marathi.
- F-20: trucks on premises show a live elapsed clock (ticks every 30 s).
- F-21: each "Returned for correction" decision shows its date/time; repeated returns list
  as separate history cards.
- F-24: Users page and Gate dashboard gained Home breadcrumb fallbacks.
- F-25: the Plant Head column reads by milestone key, not array index.
- New labels carry EN + Marathi.

## Hygiene
- F-15: blank invoiceRef is omitted on package create (added later via update).
- F-29: dead helper states removed (headAccountantCases now queries real states).
- F-30: lint 0 errors / 0 warnings (react-refresh rule off with a documented reason — the
  co-located-helpers convention; exhaustive-deps warning fixed by deriving check state).
- F-32: an admin cannot remove their own admin role in the edit dialog.
- Version 0.8.5.
