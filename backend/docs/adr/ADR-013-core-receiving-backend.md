# ADR-013: Small receiving backend slice

2 November 2026. Draft engineering implementation; human SQL/merge review pending.

Continue the already-green P1 baseline e467e22. Prioritize backend behavior;
leave frontend polishing, reports, mobile, PDF/HO work and Docker repair out of
this slice. Contract 0.3.0 is generated before the handlers.

Receiving owns the visit root; weighment owns decimal readings and corrections.
Reuse one small transactional write service for idempotency, authorization and
audit orchestration. Store numeric(12,3), return decimal strings, and never
normalize official ERP references. A duplicate reference returns a warning.
Weight corrections append rows and require a reason plus optimistic version.
No delete endpoint or premature invoice/GRN uniqueness constraints are added.

Prototype permissions: Gate creates/records weight; Gate and QC operator/manager
read synthetic visits. An admin role alone has no business-record access.
All production business permissions remain disabled pending D-07. Read queries
filter isDemo=true; inaccessible records return 404. No new tenant framework is
introduced for the single-mill prototype.

Use transaction-scoped key locks to serialize identical retries, row versions
to reject racing corrections, and reference locks only for reliable duplicate
warnings. Data, append-only audit and the response snapshot commit together.
Idempotency keys are scoped to user/method/path and retained for 24 hours.
Failures roll back entirely and do not consume a key. No broker or extra runtime.

Initial QC state is the documented draft (no submitted inspection yet); movement
and GRN remain independent. Their later commands must not infer ERP approval or
QC acceptance. Signed formula/authority/exit rules remain unconfigured.

## Essential path extension (same milestone)

After the receiving slice passed 32 backend tests, contract 0.4.0 added only the
remaining core actions: QC submission/revision, exit and manual GRN linking.
QC and movement read modules are separate from their command modules so receiving
can compose state without circular dependencies or cross-module table writes.
Multiple inspections/GRNs are not constrained to one per visit. Business approvals
remain disabled. See docs/CORE_BACKEND.md for the exact scope and API contract.
