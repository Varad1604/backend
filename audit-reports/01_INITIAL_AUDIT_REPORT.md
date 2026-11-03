# KPMPL Gate-to-Bill — 01 Initial Independent Audit Report

- Auditor: independent re-verification pass (no reliance on prior completion claims)
- Date: 2026-11-03/04 (local)
- Workspace: `C:\Users\Varad Deshpande\Downloads\KPMPL-Latest`
- Checkpoint before any fix: git `b67df5c` (clean working tree)
- Running stack at audit time: kpmpl-local-web (nginx, :5173), kpmpl-api-1 (:3000, healthy), postgres/redis/minio/clamav healthy

## 1. Scope and method

Everything below was verified with real execution, not code reading alone:
- Container/health checks; `prisma` migration table inspection; served-asset hash vs `dist/`.
- Backend: `tsc --noEmit` (pass), `vitest run` with live dependencies (**60/60 passed**, 13 files).
- Frontend: `tsc` both configs (pass), ESLint (0 errors / 13 pre-existing warnings), `vitest run` (**82/82 passed**), `npm run build` (success, deterministic hash `index-CxmyRXVJ.js` — byte-identical to what nginx serves, so the served frontend IS the latest build talking HTTP mode to the live API).
- Live API audit script `audit-reports/role-permission-audit.mjs` — **110 checks**: auth (401s, generic credential wording), 7-role GET matrix, CSV export, record-level visibility, forbidden-write matrix, full workflow on a fresh package (gate → QC → tare → exit → GRN → package → verify → accounting → post), concurrent same-version writes, duplicate posting, idempotent replay, stale-version conflict, validation probes.
- Database inspection: roles, active users (9), audit events (431), role assignments for all 7 demo users.
- Audit immutability: live `UPDATE` on `AuditEvent` blocked by DB trigger (`AuditEvent is append-only`, errcode 55000) + `REVOKE UPDATE, DELETE, TRUNCATE … FROM PUBLIC` (migration `20261102123000`).
- Browser UI/UX (ZCode in-app browser, real interactions): login, accountant home, accounting queue, posted-package accounting page, correction dialog, gate home + follow-up, HO overview + inbox, admin users, QC queue — screenshots in `audit-reports/screenshots/` at 1440/1024/768/390.
- Security headers: API responses (Helmet) vs SPA responses (nginx).

## 2. Verified-strong areas (no action needed)

| Area | Evidence |
|---|---|
| Role/capability matrix matches policy on every probed endpoint | live matrix: all GET/POST expectations pass for 7 roles |
| Record-level visibility (HO↔drafts 404, accountant↔drafts 404, QC no package access, gate sees posted read-only) | VIS-001…007 |
| Accounting authorization: only accountant/head-accountant reach `/accounting`; accountant blocked from post/approve; HO/admin/others 403 | WRITE-003…006 |
| Bill posting guards: post before start/approval → 422; duplicate post → 422; correction after posting → 422; concurrent same-version approve → exactly one 200 + one 409; stale If-Match → 409 with state unchanged | WF-010…020 |
| Idempotent replay of a successful write returns the stored response (`Idempotent-Replay: true`) | WF-019 |
| Audit trail: append-only at DB level (triggers + REVOKE), corrections carry before/after/reason, visit timeline records bill_posted | DB probe + WF-012/021/022 |
| Session security: 401 without cookie, generic identical wrong-user/wrong-password wording, global 5-session capacity rule, 2h-idle/12h-absolute caps (enforced both client paths) | AUTH-001…004 + suite |
| Input validation: float weights rejected, zero weight rejected, duplicate gate entry → 409 with `meta.existingId`, missing Idempotency-Key → 422, cookie write without Origin → 403 | VAL-002…006 |
| Upload security: magic-byte + scan + size checks (suite item 6), clean PDF accepted live | WF-008 |
| API security headers (Helmet): COOP, CORP, Referrer-Policy, HSTS, nosniff, no-store | curl -D check |
| Frontend↔backend integration: served build == latest build; real API mode; all workflows exercised through nginx | hash check + live walk |
| UI/UX: all audited pages render correctly at 1440/1024/768/390; dialogs are aria-labelled, ESC-closable, focus managed; contrast and touch targets good; tables scroll on mobile | screenshots |

## 3. Confirmed defects

### KPMPL-001 — Server accepts characters outside the brief's safe charset in refs and names
- **Severity:** Medium (contract conformance + input hardening; no direct XSS — React escapes output — and CSV formula injection is guarded separately)
- **Affected:** `backend/apps/api/src/modules/receiving/receiving.schemas.ts` — `text()` / `optionalRef()` used by `officialGateEntryRef`, `vehicleNumber`, `supplierDisplayName`, `materialDisplayName`, `challanRef`, `poRef` (create + correct paths)
- **Expected:** Brief §3 requires the safe charset `^[\p{L}\p{N} .,/&()'_#:-]*$` for refs and names (control characters already rejected).
- **Actual:** Only control characters are rejected. Live evidence: `POST /receiving-visits` with `officialGateEntryRef: "AUD<BAD>&="` → **201 created**; the row persisted (a retry returned 409 DUPLICATE_CANDIDATE for the same unsafe ref). The frontend **mock adapter** already enforces the charset (`SAFE_TEXT` in `mockAdapter.ts`) — the adapters disagree.
- **Reproduction:** `node audit-reports/role-permission-audit.mjs` → VAL-001; or curl the create endpoint with the payload above.
- **Root cause:** the charset refinement was implemented in the mock but never ported to the server schema.
- **Recommended correction:** add the charset refinement to `text()` and `optionalRef()`; keep the control-character rule; add a regression test (unsafe chars → 422); re-run suites. Write-time-only validation, so existing rows are unaffected.

### KPMPL-002 — Operations Overview is blind to the accounting chain
- **Severity:** Low-Medium (management visibility; no data risk)
- **Affected:** `backend/apps/api/src/modules/reports/reports.service.ts` (`documents` counters stop at `verified`), contract snapshot `frontend/kpmpl-frontend/src/api/contract/openapi.yaml` (OverviewData), `frontend/kpmpl-frontend/src/features/overview/OverviewPage.tsx` ("Documents and ERP" stat group)
- **Expected:** Management overview should show packages now in accounting (`with_accounting`, `with_head_accountant`, `accounting_approved`) and completed (`bill_posted`) — the workflow the system now owns end-to-end.
- **Actual:** Counters end at "Plant Head approval pending". Live evidence: 5 posted bills + 2 in-flight accounting packages existed; overview showed none (screenshot `overview-ho-1440.png`).
- **Root cause:** the accounting upgrade added new states but did not extend the overview aggregation or its UI.
- **Recommended correction:** add `withAccounting` and `billPosted` counters server-side; extend the contract types/snapshot; add two stat rows with capability-gated links (`accounting.inbox` → /accounting).

### KPMPL-003 — SPA served without security headers; local web config lives in %TEMP%
- **Severity:** Low (hardening + operational fragility in the local stack; the repo's production nginx template is already hardened, so this is a local-deployment gap)
- **Affected:** `%TEMP%\kpmpl-local-nginx.conf` (the config bind-mounted into `kpmpl-local-web`); SPA responses carry no `X-Content-Type-Options`, no `X-Frame-Options`/frame-ancestors, no cache-control on `index.html`
- **Expected:** Header parity with the backend's hardening posture; config stored in the workspace, not %TEMP% (a %TEMP% cleanup breaks container restart).
- **Actual:** verified via `curl -D` — API responses carry Helmet headers; SPA responses carry none. The mounted config is a minimal 15-line server block.
- **Recommended correction:** harden the mounted conf in place (security headers on SPA responses, `client_max_body_size`, no-cache for index) and `nginx -s reload`; save a copy in the workspace (`frontend/kpmpl-frontend/nginx-local.conf`) as the durable source.

## 4. Suspicions investigated and cleared (not defects)

- QC can download `reports/receiving.csv`: **by design** — the brief §4 gives `qc` `overview.view` (policy.ts, frontend grants, security e2e matrix all agree).
- Admin gets 403 on `GET /document-packages`: **by design** — admin holds `ho.inbox`, not `docs.prepare` (brief §4).
- Weighment/exit/GRN writes return **201** (not 200): Nest default for POST; consistent and harmless.
- QC decision writes require the **visit** version; a submit bumps it — clients must re-read (documented contract; UI does this).
- Global 5-session eviction: documented capacity rule (brief); UI handles the resulting 401 with the session-expired flow.
- Login rate limit (5/min per IP+username) can throttle back-to-back full E2E runs — operational note, not a defect.
- Synthetic audit packages `DEMO-PKG-0006…0008` and `AUD-…` visits were created by this audit's own scripts; all carry complete audit trails and were left in place (no deletion policy).

## 5. Unresolved business decisions (not defects — documented, not invented)
- Editable *financial* accounting fields (amounts, tax, ledger codes) — pending KPMPL.
- PO vs Purchase-Voucher distinction — pending KPMPL.
- Coupling between internal "Bill Posted" and the external DataMan "final posting" milestone — pending KPMPL. The system keeps them deliberately independent.
- Overview report layout itself is marked "pending KPMPL confirmation" in the UI.

## 6. Initial test results (commands and outcomes)

| Command (where) | Result |
|---|---|
| `docker ps` | 6/6 containers up/healthy |
| `curl :5173/api/v1/healthz` + `/readyz` | ok; database/redis/storage up |
| served asset hash vs `dist/` | identical (`index-CxmyRXVJ.js`) |
| `psql _prisma_migrations` | 13/13 applied |
| `UPDATE AuditEvent …` (probe, rolled back) | blocked by trigger |
| backend `tsc --noEmit` | pass |
| backend `vitest run` (live deps) | 60/60 |
| frontend `tsc` ×2 | pass |
| frontend `eslint src` | 0 errors, 13 warnings (pre-existing) |
| frontend `vitest run` | 82/82 |
| frontend `npm run build` | success; hash unchanged |
| `node audit-reports/role-permission-audit.mjs` | 109/110 (the one "fail" was this script's own stale-ref probe; corrected evidence in §3-KPMPL-001) |
| browser screenshots (9 files) | `audit-reports/screenshots/` |

## 7. Verdict at initial audit
No critical or high-severity defects found. Three confirmed, safely actionable issues (1 Medium, 1 Low-Medium, 1 Low) plus cleared suspicions. Remediation proceeds per the priority order.
