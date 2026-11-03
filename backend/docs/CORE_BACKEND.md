# Minimal M1 backend — 2 November 2026

Scope: one synthetic operational path, backend first. No frontend components,
dashboards, reports, PDF/HO workflows, mobile clients or new infrastructure.

## Working path

1. Gate creates a receiving visit and gross reading together.
2. QC sees the same stored visit in the pending queue and submits measurements.
3. Gate records tare; net is derived exactly from compatible decimal readings.
4. Gate records physical exit, independently of QC decisions and GRN tracking.
5. Staff attach an exact official GRN reference with explicit manual verification.

QC history and weighment corrections append versions rather than overwrite data.
QC corrections require a reason and retain earlier measurements. Exit recording
returns exitEligibility=not_configured; QC submissions return
deductionCalculation=not_configured. There is no accept/reject/override API, live
DataMan connection, formula, tax calculation or production release authority.
The QC field schedule remains unsigned; generic decimal-string observations are
preserved without inventing mandatory field names, units or thresholds.

## API

| Method | Path (under /api/v1) | Prototype role |
|---|---|---|
| POST | /receiving-visits | Gate |
| GET | /receiving-visits | Gate, QC operator/manager |
| GET | /receiving-visits/{id} | Gate, QC operator/manager |
| GET | /receiving-visits/{id}/weighments | Gate, QC operator/manager |
| POST | /receiving-visits/{id}/weighments | Gate |
| GET | /qc/queue | QC operator/manager |
| GET | /receiving-visits/{id}/qc-inspections | Gate, QC operator/manager |
| POST | /receiving-visits/{id}/qc-inspections | QC operator |
| POST | /receiving-visits/{id}/exit | Gate |
| GET | /receiving-visits/{id}/grn-links | Gate, QC operator/manager |
| POST | /receiving-visits/{id}/grn-links | Gate |

Every write needs Idempotency-Key (8–128 characters). Identical retries return
the original response with Idempotent-Replay: true. A changed payload on the
same key returns 409 IDEMPOTENCY_CONFLICT. Keys are user/path/method scoped and
expire after 24 hours. Failed transactions do not consume the key.

All writes after creation require the visit's current version. Conflicting
versions return 409 VERSION_CONFLICT. Reload before starting a new edited write;
retry the same unchanged request with its original key after a lost response.
GET responses compose independent domain states from their owning read services.

Official refs remain exact strings, including zeros, punctuation and whitespace.
Gate ref duplicates are advisory, not a uniqueness constraint. GRN relationships
remain many-to-many capable; a repeated official string is not silently merged
across visits or interpreted as an ERP approval. Verification actor/time/source
are assigned by the server. Times are UTC; physical event time is stored apart
from recording time. Weight inputs are positive decimal strings, at most 9 whole
and 3 fractional digits, with explicit kg/mt units. Net may be zero. No implicit
unit conversion or floating-point weight storage is used.

## Structure and future extension

Receiving owns the visit/version; weighment owns readings and exact arithmetic;
QC owns inspection revisions; movement-grn owns exit and verified-reference events.
Small read modules compose the visit response without circular write dependencies.
The shared write service commits data, audit and retry snapshot in one transaction.
Only existing Postgres/Redis services are used. Future invoice/package/mobile
work can add link tables, modules and consumers of the same generated contract.
No speculative framework, broker, generic workflow engine or second API is added.

Business capabilities are demo-only until D-07 is approved. Queries filter
isDemo=true and inaccessible records return 404. Admin alone has no business
access. Production SOPs and QC/exit authority remain separate activation gates.
Pending QC means no inspection exists yet; decision/return workflows are deferred.

## Verification and review

The suite uses isolated, migrated schemas and removes them after each run. It
covers the complete API path, actual Gate-to-QC permission denial (AT-11), exact
refs, decimal limits, concurrent retries/corrections, immutable histories,
transaction rollback, state independence and GRN provenance/cardinality.
Existing auth and web regressions still run; core screens are not yet wired.

Two additive migrations add receiving/weighment and QC/exit/GRN tables. Human
review of the SQL and draft PR is required before merge. Main remains unchanged.
The narrow next step is a basic Gate/QC UI consuming these APIs, then feedback
on the workflow; exports, M2 and mobile are deferred.

## Interface follow-up

The separate codex/core-m1-interface slice now supplies the thin Gate/QC client
described above. See CORE_INTERFACE.md. The earlier no-frontend scope describes
the backend milestone; backend behavior and migrations are unchanged.

## Minimal line-entry correction — current local behavior

User rejected the earlier form-heavy workflow and requested few-click operation,
retention of optional details and backend protection against early departure.

- Arrival: Gate Entry number, truck number, gross weight. Weight defaults visibly
  to kg; other units, supplier, material, challan, PO and notes remain under More
  details (optional). Omitted supplier/material are stored as NULL, never guessed.
- Tare: one weight, inheriting the visit's unit. Saving it never records departure.
- QC: one inspection note; detailed readings remain optional. Empty notes without
  any reading are rejected by the API. A note is not an acceptance decision.
- Departure: one explicit Truck has left action, disabled until QC inspection and
  compatible gross/tare/net are recorded. The API checks the same prerequisites
  inside its versioned transaction, so direct requests cannot bypass the UI.
- GRN: number plus Verified in DataMan — save. That explicit action records staff
  verification. It never implies ERP approval or posting.

The operator account header and truck summary are compact. Optional metadata,
corrections and history remain accessible without occupying the normal path.

Contract 0.5.0 makes optional arrival details nullable in responses and optional
in requests. Migration 20261102100000 only drops two NOT NULL constraints; it
does not delete rows or rewrite existing values. Human SQL review is required
before merge. These user-directed changes supersede older statements saying
departure could be recorded before QC/tare or supplier/material were mandatory.

Validation: 41 live backend tests, 8 web tests and 4 browser journeys pass; lint,
all typechecks, API compilation and web build pass. Tests cover three-input
creation, actual optional-detail retention, notes-only QC, both missing departure
prerequisites, rejected empty QC, no exit side effect from tare, rollback of
rejected version claims and safe retry after prerequisites are satisfied.

Pending clarification: whether departure must additionally require an explicit
QC Cleared/Hold decision. Current prototype checks record presence only; it does
not invent acceptance authority, thresholds or a production release SOP. A
human's note must not be interpreted as approval. No production activation or
claim of universal correctness is made. Latest changes remain local/unmerged.

## Explicit QC clearance — current rule confirmed by user

The user explicitly chose Require QC Cleared + tare before departure. This
supersedes the earlier inspection-presence-only prerequisite and the pending
clearance question in historical milestone notes.

QC now has Cleared and Hold actions on its short note form. Clearing can be one
click without a note; Hold requires a short note. Save note only is secondary and
never gives clearance. Optional readings and correction reasons remain available.
Only the existing synthetic qc_operator write role can record these decisions;
Gate cannot clear its own trucks. (Update 2026-11-03, KPMPL decision D-03: the QC
operator records the readings and the final QC decision; there is no other QC decision role.)

QCRevision stores pending/cleared/hold, immutable submittedBy/submittedAt and the
claimed visitVersion. All pre-existing revisions default to pending; nobody is
auto-cleared. Latest QC action is ordered by visitVersion across every inspection,
so editing an older inspection cannot accidentally retain a newer clearance.
Any new note or revision without an explicit decision returns current clearance
to pending. Hold and pending remain in the actionable QC queue until cleared;
departed trucks are excluded. Queue search and pagination still apply.

Departure checks current explicit cleared status plus compatible gross/tare/net
inside the same root-version transaction. Failed attempts roll back their claimed
version and do not consume the retry key. Concurrent Hold/departure with the same
version cannot both commit. The departure audit captures qcClearanceRevisionId
as evidence of the decision used. A new explicit decision after departure is
rejected; later audited note corrections do not undo the recorded physical event.

No accept/reject threshold, deduction formula, ERP approval or release override
has been invented. Production roster/SOP activation is still separate. New SQL
adds only clearance/version columns and constraints; human review is required
before merge. Contract is 0.6.0. Optional arrival details remain unchanged.

Validation: 43 live API/domain tests, 8 component tests and 4 browser journeys
pass. Tests cover pending notes, Hold, missing tare, unauthorized decisions,
revision invalidation, queue transitions, audit rollback, exact retries and the
Hold/departure race. Lint, all typechecks, API compilation, web build and full
history secret scan pass. Changes are local on codex/core-m1-interface; no main
merge, new remote CI claim or production rollout is implied.
