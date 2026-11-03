# Truck journey source-of-truth audit — 2 November 2026

This audit distinguishes approved process facts from prototype behavior. The
normative inputs are `02_BUSINESS_WORKFLOWS.md`, `03_ROLE_PERMISSION_MATRIX.md`,
`05_UI_SCREEN_SPECIFICATION.md`, `08_QC_FIELDS_AND_RULES.md` and
`13_OPEN_DECISIONS_REGISTER.md` in the supplied v0.5 development pack.

## Canonical M1 journey

1. DataMan already contains the official Gate Entry reference.
2. Gate records the truck and gross weight in this app.
3. The same visit appears in QC without retyping Gate data.
4. QC records observations/readings and preserves revisions.
5. The QC operator makes the final QC decision on the submitted readings
   (accept / accept with deduction / return for correction / reject). Decided by
   KPMPL on 2026-11-03 (D-03); there is no separate decision role.
6. Gate records tare; the backend derives net only from compatible readings.
7. Gate records physical exit as a separate event. The production release rule
   for rejection, return and partial unload is not confirmed.
8. Gate records the official GRN reference later after staff verify it in
   DataMan. Exit and GRN are independent facts.

## Prototype safety rule

The user explicitly requires a QC-clear signal plus tare before the departure
action can be recorded. The prototype enforces that invariant at the API and UI.
Because D-04 remained open at the time (D-03 was decided on 2026-11-03), the signal is labelled as a synthetic demo
clearance and cannot be represented as approved production authority. Audit and
API metadata retain `decisionAuthority=not_confirmed` and
`releaseAuthority=not_configured`.

## Deliberately deferred

- QC override policy (D-03 itself is decided: the QC operator decides);
- accept/reject/deduction formulas and mandatory QC field schedule;
- physical release behavior for rejection, return and partial unloading;
- DataMan integration, ERP posting and ERP approval inference;
- M2 documents, Head Office packet, reports and mobile clients.

Any future implementation of these items requires a signed decision or an
explicitly labelled synthetic demonstration. They must not be inferred from UI
controls, sample forms or test data.
