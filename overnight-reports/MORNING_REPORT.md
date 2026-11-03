# KPMPL — Morning Report (overnight run, 3 → 4 November 2026)

Overnight autonomous implementation is **complete and verified locally**. Nothing was pushed,
deployed remotely, or destroyed. The full evidence trail is in `overnight-reports/`
(`PROGRESS.md`, `TEST_RESULTS.md`, `DECISIONS.md`, `ISSUES_FOUND.md`, `api-walk-accounting.mjs`).

---

## 1. What was implemented

### New roles: Accountant and Head Accountant
- Role codes `accountant` and `head_accountant` added to the data-driven role/capability matrix
  (backend `policy.ts`, seeded into `Role`/`Capability`/`RoleCapability` tables — data, not code).
- New capabilities: `accounting.inbox`, `accounting.review` (Accountant),
  `accounting.approve` + `accounting.post` (Head Accountant only). Least privilege enforced and tested.
- Demo accounts `demo-accountant` and `demo-head-act` added to the idempotent seed
  (existing accounts, visits and packages were **not** touched — the seed skipped your own
  `DEMO-PKG-0003` because you had already created one).

### The workflow: HO → Accountant → Head Accountant → Bill Posted
- New package states after HO verification: `with_accounting → with_head_accountant →
  accounting_approved → bill_posted` (additive string values; nothing renamed).
- Server-side state machine (`POST /document-packages/{id}/accounting`, `GET /accounting/queue`):
  - `start_accounting` (Accountant, from `verified`)
  - `submit_to_head_accountant` (Accountant, confirmComplete required)
  - `return_to_accountant` (Head Accountant, reason required)
  - `approve_accounting` (Head Accountant)
  - `post_bill` (Head Accountant, bill reference typed exactly as-is; **duplicate posting refused**,
    terminal state)
  - `correct_accounting` (authorized fields only, reason mandatory)
- Every write: Idempotency-Key + If-Match (package version) + one transaction + hash-chained
  audit event + package history row. Failed writes roll back completely.
- Authorized corrections keep field-level before/after + reason in a new `AccountingCorrection`
  table **and** the append-only audit log. Only two non-financial fields are editable
  (`accountingRef` — opaque, stored byte-for-byte — and the working notes). **No amounts, tax or
  ledger fields were invented**; that remains a pending KPMPL decision (see DECISIONS.md D-A4).
- Internal "Bill Posted" is deliberately independent of the DataMan ERP milestones
  (plant head approval / voucher / posting), which Head Office keeps confirming manually.
  HO visibility was extended through the accounting chain so its ERP duties survive the handoff.

### Role-specific UI (frontend, http mode against the real API)
- **Accounting Queue** page with 5 stage tabs + live counts, and a **package accounting page**:
  stage guidance, authorized field rows with "Correct…" dialogs (reason required), stage actions
  ("Send to Head Accountant", "Approve accounting", "Return to Accountant", "Post bill…"),
  corrections audit table, documents checklist (read-only), linked trucks, DataMan milestones
  (read-only for accountants), and the full history timeline.
- **Role-specific dashboards**: the Accountant and Head Accountant get their own job cards with
  live counts; nav items are capability-filtered so each role sees only its work.
- **HO**: new "With Accounts" inbox tab; the HO package view shows the accounting panel read-only
  and keeps its DataMan milestone confirmations active.
- **Gate**: Document Packages gains a "With Accounts" tab (read-only visibility after handoff).
- **Admin**: Users & Access now shows all 7 demo accounts and the full 7-role × 18-capability matrix.
- Button placement follows the app's existing conventions (actions right-aligned in card footers,
  confirmed by dialogs), with the app's established accessibility patterns (labelled fields,
  `aria` roles, focus management, ≥44 px targets, `sr-only` table headers).
- Mock adapter mirrors all accounting rules, so demo/offline mode demonstrates the same workflow.

### Safe migration
- `20261103190000_accounting_roles_workflow` — **additive only**: two new tables
  (`AccountingRecord`, `AccountingCorrection`), new role/capability rows (`ON CONFLICT DO NOTHING`).
  No column altered or dropped, no row updated or deleted, safe to replay. Applied to the live
  local database via `prisma migrate deploy` in the compose `migrate` service. Migration history
  was not rewritten; no `prisma reset`, no `docker compose down -v`, no volume deletion.

## 2. What actually passed (all evidence in TEST_RESULTS.md)

| Check | Result |
|---|---|
| Backend typecheck (`tsc --noEmit`) + ESLint + `nest build` | ✅ clean |
| Backend tests (`vitest`, live Postgres/Redis/MinIO/ClamAV) | ✅ **60/60** (13 files), incl. the new `accounting.e2e-spec.ts` |
| Frontend typecheck (both configs) + ESLint | ✅ clean (0 errors; 13 pre-existing warnings) |
| Frontend tests (`vitest`) | ✅ **82/82**, incl. new mock-adapter accounting workflow test |
| Frontend production build (`npm run build`, `VITE_API_MODE=http`) | ✅ success; served by nginx on :5173 |
| Migration applied via compose `migrate` service | ✅ `20261103190000_accounting_roles_workflow` + idempotent seed ("7 users … 5 visits, 3 packages") |
| API health/readiness (direct :3000 and via nginx :5173) | ✅ database=up, redis=up, storage=up |
| All 7 demo logins via nginx with correct roles | ✅ |
| Live-deployment API walk (fresh package, through nginx) | ✅ **26/26 checks** (`node overnight-reports/api-walk-accounting.mjs`) |
| Browser E2E (in-app browser, real UI): full workflow on your DEMO-PKG-0003 | ✅ Start → correct (audited) → hand over → approve → **Bill posted**; duplicate-posting guard verified |
| Playwright suite (`--project=dev`, real backend) | ✅ **34 passed / 0 failed** (1 conditional skip) |
| Mobile 375 px + visual screenshots | ✅ 4 screenshots; layout adapts, contrast readable |

## 3. What was found and fixed along the way
- `test/security.e2e-spec.ts` was entirely broken and only "passed" by crashing in beforeAll
  (everything silently skipped): 9 latent bugs fixed (missing If-Match on uploads, wrong view
  field assumptions, invalid usernames, short passwords, missing CSRF/Origin/Idempotency headers,
  default-schema Prisma client, >5 concurrent sessions vs the global five-session cap, and a
  ClamAV build quirk with PDF-wrapped EICAR — the infected-file case is now asserted at the
  scanner boundary).
- **Real security gap in app code, fixed**: the mobile `refresh()` path enforced neither the 2 h
  idle window nor updated `lastSeenAt`, and no path rejected sessions whose lifetime exceeded the
  12 h absolute cap. Both caps now enforced on both client paths (brief §5.1), covered by tests.
- Playwright helper bug fixed: decision-success assertion expected "Accept with deduction" while
  the app renders the canonical "Accepted with deduction" (decision itself was always recorded).
- Local `.env` `WEB_ORIGIN` extended with `http://localhost:5174` for the Playwright dev server
  (local demo config only; :5173 remains the primary origin).

## 4. What is blocked / not done (truthful list)
- **No remote CI run, no push, no deployment** — local only, per instructions.
- Overview page counters don't yet include the accounting states (cosmetic; the Accounting Queue
  is the source of truth). Listed in ISSUES_FOUND.md as an open item.
- Editable *financial* accounting fields (amounts, tax, ledger codes), the PO/Purchase-Voucher
  distinction, and any coupling between internal bill posting and the external ERP final posting
  remain **pending KPMPL business decisions** — deliberately not invented (DECISIONS.md).
- The frontend `openapi.yaml` (1.2.0) is the hand-maintained contract snapshot; regenerating it
  from `backend/packages/contracts` remains the documented (pre-existing) process.
- One operational note: the login rate limit (5/min per IP+username) needs ~1 min cooldown
  between back-to-back full E2E runs.

## 5. Local git commits (branch `main`, no remote)
1. `59d75f2` — Checkpoint: pre-upgrade state (baseline safety commit)
2. `1c80b94` — Backend: roles, workflow, additive migration, seed, repaired security e2e (60/60)
3. `9b9301f` — Frontend: accounting UI + roles + contract 1.2.0 + mock parity (82/82, http build)
4. `92551d9` — Deploy: images rebuilt, migration + seed applied, 26/26 live walk checks
5. (final commit of the reports + E2E helper fix — see `git log`)

## 6. How to launch and test locally (morning review)
The stack is **already running**:
- Web UI: **http://localhost:5173** (nginx serving the new production build)
- API: http://localhost:3000/api/v1 (healthz/readyz green; also proxied at /api/v1 on 5173)

Demo sign-ins (password = the backend `DEMO_PASSWORD` from `backend/.env` — not reproduced here):
`demo-gate`, `demo-qc`, `demo-docs`, `demo-ho`, **`demo-accountant`**, **`demo-head-act`**, `demo-admin`.

To re-run the verification yourself:
```bash
# backend tests (from backend/, with live deps; specs use isolated temp schemas)
cd backend && set -a && . <(tr -d '\r' < .env) && set +a
export DATABASE_URL="${DATABASE_URL/postgres:/127.0.0.1:}" REDIS_URL=redis://127.0.0.1:6379 \
       S3_ENDPOINT="${S3_ENDPOINT/minio/127.0.0.1}" CLAMAV_HOST=127.0.0.1 REQUIRE_LIVE_DEPENDENCIES=true
cd apps/api && npx vitest run

# frontend tests + build (from frontend/kpmpl-frontend/)
npx vitest run && npm run build

# live-deployment walk (through nginx :5173; needs DEMO_PASSWORD in env)
node ../overnight-reports/api-walk-accounting.mjs

# Playwright E2E (starts its own Vite dev server on :5174)
E2E_BASE_URL=http://localhost:5174 npx playwright test --project=dev
```
To rebuild/redeploy the local stack after code changes: `docker compose build migrate api &&
docker compose up -d migrate && docker compose up -d api` (never with `-v`).

## 7. Suggested next steps (for you, not done overnight)
1. Review the workflow on your own package: sign in as `demo-accountant` / `demo-head-act` —
   the posted bill for DEMO-PKG-0003 (INV-8520-BILL) with its full audit trail is already visible.
2. Decide the open business questions in DECISIONS.md (financial fields, PO vs voucher,
   internal-vs-ERP posting coupling).
3. Human review of migration `20261103190000` SQL before any non-local use.
