# Minimal Gate/QC interface — 2 November 2026

The existing API now has a thin operational web client. Scope remains the
synthetic receiving → gross → QC observations → tare/net → physical exit →
manually verified GRN reference path. No new endpoints, migrations or packages.

## Available

- Gate: paginated/searchable register, new receiving/gross form, visit detail,
  tare and weight corrections with reason, physical exit confirmation, manual
  GRN verification checkbox and reference capture.
- QC operator: pending queue, all visits, observations (up to 50 per submission),
  new inspections and reasoned replacement revisions.
- QC manager: queue/register/detail and history, without write controls.
- All authorized readers: separate visit/QC/movement/GRN states, server-derived
  exact net weight and append-only weight/QC/GRN provenance histories.

Every network call uses the generated client through the existing API boundary.
`operations-api.ts` is the typed domain adapter; `Operations.tsx` owns query and
save state; `OperationForms.tsx` owns forms. TanStack Query keys are user-scoped,
and operation caches are removed on sign-out. Server permissions remain decisive.
No token is added to browser storage.

## Save behavior

One write can be outstanding at a time. Save disables competing operations and
navigation. Network failures and server errors retain the exact command and key
in memory; Retry same save replays that command, including its original version.
Inputs stay frozen until the outcome is known. A page-leave warning helps avoid
losing an unresolved request. This is not offline persistence: closing/reloading
the page or losing the session can still discard unsaved input or retry state.
After an interrupted session, inspect stored records before creating another visit.

Definite HTTP rejection retains editable input and shows the server error. A
version conflict requires Reload records, review and a new submission; the UI
does not automatically rebase or resubmit. Successful saves invalidate list and
detail queries. A failed detail/history load hides write forms until reloaded.
Official text is not trimmed; decimal inputs stay strings. Only server results
claim a saved state. Duplicate-reference advisories remain visible after creation.

QC field codes and units are entered explicitly because the signed field schedule
is absent. Revising an inspection replaces its full observation set and keeps the
previous revision. No QC acceptance, deductions or exit eligibility is inferred.
Physical time input is local and sent as an ISO instant; recording time is assigned
by the server. Leaving physical time blank records the current server time.

## Verification and handoff

Local verification: repository lint/typecheck, web build, 7 web component tests,
39 live API/domain tests and 3 Playwright browser journeys. The workflow browser
test creates a synthetic visit, hands it from Gate to QC in separate authenticated
contexts, submits two observations, proves a stale Gate write is rejected, reloads,
records tare/exit/GRN and checks persistence after a full page reload. Existing
login/rotating-session and failed-login regressions remain. No browser console
exceptions were observed; narrow viewport overflow check passes. Desktop/mobile
screenshots are captured under ignored test-results/ for visual review.

Backend draft PR #3 passed all CI jobs, including image builds and Compose/browser
checks. Both additive backend SQL migrations have been inspected; human review
is still required before merge. This UI slice adds no SQL and does not merge any
draft PR. The next useful step is a human walkthrough with synthetic Gate/QC
accounts, then essential workflow feedback. Client decisions, full UAT, reports,
M2, mobile, production rollout and additional UI polish remain outside this slice.

## Usability follow-up

The task-oriented client now separates Record tare, Record departure, Add GRN
reference and corrections. New arrivals and history are opened explicitly.
Plain status labels and What needs attention explain recorded/missing facts
without inventing QC approval or release rules. Contract 0.4.1 also fixes the
material-search mismatch. Current validation is 39 backend + 8 web tests and
3 browser journeys. See WALKTHROUGH.md for the user review checklist.

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
