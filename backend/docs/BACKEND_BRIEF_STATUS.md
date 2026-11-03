# Backend build brief reconciliation

This file treats `KPMPL_Backend_Build_Brief.md` as the requested specification, not as evidence of client sign-off.

## Implemented

- Foundation: configuration, errors, request IDs, retry safety, optimistic versions, immutable audit, sessions, database RBAC, user administration, health/readiness, CI security jobs and authenticated OpenAPI.
- Module 1: receiving/gross, corrections, reference data, timeline, QC queue/revisions/clearance, tare/net, exit, manual GRN, overview and CSV.
- Module 2: package/truck ownership, six-row checklist, private PDF storage/scanning/download, Gate handoff, HO review/correction/resubmission/verification, ordered manual ERP milestones, reversal and in-app reminder log.
- Contract: shared OpenAPI 1.0.0 includes administration, policies, reports and Module 2 routes.

## Explicit user-directed deviations

- Arrival retains the user's requested three-field quick path; supplier and material remain optional under “More details”, although R-01 lists them as required.
- Departure retains the user's explicit requirement for current QC `cleared` plus tare. The brief's prototype D-04 permits submitted readings with mill checks and says returned/rejected need not block. The stricter direct user decision is preserved and documented.
- Local HTTP uses `kpmpl_sid`; deployed HTTPS uses `__Host-kpmpl_sid`, because browsers reject `__Host-` cookies without `Secure`.
- Legacy role/capability aliases and bearer access remain during the existing frontend/mobile transition.

## External completion evidence still required

- Client-owned staging deployment and green remote CI for this exact worktree.
- Client-cloud backup/PDF restore drill using `RUNBOOK.md`.
- Human confirmation of policies D-01 through D-12, production roster and production secrets.
- The frontend artifact and adapter files named by the brief were not supplied in this repository; the existing minimal React interface was preserved instead of inventing an incompatible replacement.
