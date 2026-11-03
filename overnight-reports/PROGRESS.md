# KPMPL Overnight Progress

Living checklist. Updated after every milestone.

## Milestone 0 — Verify current state (DONE)
- Full local stack already running and healthy:
  - `kpmpl-local-web` (nginx) on http://localhost:5173 (bind-mounts `frontend/kpmpl-frontend/dist` → rebuild of dist is served automatically)
  - `kpmpl-api-1` (image `kpmpl-api`) healthy on :3000 — `GET /api/v1/healthz` → `{"status":"ok"}`
  - `kpmpl-postgres-1` (16), `kpmpl-redis-1` (7), `kpmpl-minio-1`, `kpmpl-clamav-1` all healthy
- API health OK both direct (:3000) and via nginx proxy (:5173/api/v1/healthz).
- Workspace was NOT a git repository → initialized local-only repo (branch `main`, no remote),
  `.gitignore` excludes `.env*`, `node_modules`, `dist`, build artifacts.
  Baseline commit: "Checkpoint: pre-upgrade state (roles gate/gate_doc/qc/ho/admin; contract 0.6.0)".
- No Prisma reset / no destructive command run. Existing DB data untouched.

## Current backend model (as found)
- Roles in DB/policy: `gate, gate_doc, qc, ho, admin` (policy.ts + seeded role/capability rows).
- Package statuses: `draft → ready_for_gate_check → submitted_to_ho → under_ho_review →
  correction_requested ⇄ resubmitted → verified`. ERP milestones (plant_head_grn_approval,
  purchase_voucher, final_posting) are separate manual staff confirmations by `ho` (erp.confirm).
- 12 migrations, latest `20261103090000_qc_operator_decides`. Migration history must not be rewritten.

## Milestone plan
1. [x] State verified, git checkpoint (this file, DECISIONS.md, ISSUES_FOUND.md, TEST_RESULTS.md).
2. [x] Backend: add roles `accountant`, `head_accountant` + capabilities
       (`accounting.inbox`, `accounting.review`, `accounting.approve`, `accounting.post`).
3. [x] Backend: HO → Accountant → Head Accountant → Bill Posted workflow (new package states
       `with_accounting`, `with_head_accountant`, `accounting_approved`, `bill_posted`),
       authorized accounting corrections with reason, full audit trail, duplicate-posting guard.
4. [x] Backend: additive-only migration (new roles/capabilities rows + new tables).
5. [x] Backend: idempotent seed for demo accountant accounts (does not touch existing users).
6. [x] Backend: build + unit/integration tests green.
7. [x] Frontend: new roles in types/permissions, accounting UI (queue + actions + audit history),
       role-specific dashboards/simplification, button placement & accessibility fixes.
8. [x] Frontend: typecheck + lint + vitest + production build (http mode) green.
9. [x] Redeploy API container (compose build/up, NO -v) + run migration + seed; verify health.
10. [x] E2E browser tests via http://localhost:5173 (all roles, workflow, permissions).
11. [x] Final regression pass + MORNING_REPORT.md.

## Active errors
- (none — all suites green, stack healthy)

## Next executable step
- (complete) See MORNING_REPORT.md for the final summary, evidence and morning review steps.
