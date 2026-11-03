# KPMPL Gate-to-Bill — 03 Final Audit Report

- Audit cycle: 2026-11-03/04 (independent re-verification → remediation → full re-audit)
- Baseline checkpoint: git `b67df5c` · Fix commit: see `git log` (audit cycle)
- Companion documents: `00_AUDIT_SUMMARY.md`, `01_INITIAL_AUDIT_REPORT.md`, `02_REMEDIATION_REPORT.md`, `ISSUE_TRACKER.md`, `TEST_EVIDENCE.md`, screenshots in `audit-reports/screenshots/`

## 1. Initial findings by severity
- **Critical:** 0
- **High:** 0
- **Medium:** 1 — KPMPL-001 (server accepted characters outside the brief's safe charset in refs/names)
- **Low-Medium:** 1 — KPMPL-002 (Operations Overview blind to the accounting chain)
- **Low:** 1 — KPMPL-003 (SPA served without security headers; local web config in %TEMP%)
- Cleared suspicions: 6 (S-1…S-6 — verified design behaviors, not defects; see ISSUE_TRACKER.md)

## 2. Issues fixed and independently verified
All three confirmed defects were fixed and verified — details, root causes and changed files in
`02_REMEDIATION_REPORT.md`; per-check evidence in `TEST_EVIDENCE.md`:
- **KPMPL-001** — safe-charset validation added server-side + regression test. Backend suite **61/61**; live audit: unsafe refs → 422.
- **KPMPL-002** — `withAccounting`/`billPosted` overview counters across backend, contract, types, page and mock. Frontend **82/82**; live checks OVER-001…003; browser screenshot shows "In accounting 1 / Bills posted 6".
- **KPMPL-003** — hardened local web config (headers, cache policy, body-size guard) deployed via `nginx -s reload`; verified with `curl -D`; durable copy committed to the workspace.

## 3. Remaining issues and blockers
- **No open defects.** Deferred/open items: D-1…D-4 (business decisions — financial fields, PO vs voucher, internal-vs-ERP posting coupling, overview layout), O-1…O-3 (style warnings, hand-maintained contract snapshot, no remote CI) — see ISSUE_TRACKER.md.

## 4. Final role-permission matrix (server-enforced, verified live for all 7 roles)

| Capability | Gate | QC | Doc Authority | Head Office | Accountant | Head Accountant | Admin |
|---|---|---|---|---|---|---|---|
| receiving.view / register | ● | ● | ● | ● | ● | ● | ● |
| receiving.create / edit | ● | — | — | — | — | — | — |
| gate.followup (tare, exit, GRN) | ● | — | — | — | — | — | — |
| qc.queue.view | ● | ● | — | — | — | — | — |
| qc.measure + qc.decide (D-03) | — | ● | — | — | — | — | — |
| docs.prepare / docs.submit | ● (prepare) | — | ● (both) | — | — | — | — |
| ho.inbox / ho.review / erp.confirm | — | — | — | ● | — | — | ● (inbox only) |
| accounting.inbox | — | — | — | — | ● | ● | — |
| accounting.review | — | — | — | — | ● | ● | — |
| accounting.approve / accounting.post | — | — | — | — | — | ● | — |
| overview.view (incl. CSV) | ● | ● | ● | ● | ● | ● | ● |
| admin.users | — | — | — | — | — | — | ● |

Live checks: every GET matrix entry, forbidden writes as every role (403), record-level visibility
(HO↔draft 404, accountant↔draft 404, QC no package access, posted packages readable by gate/finance).

## 5. Complete business workflow verification (live, real data)
Gate entry → loaded weighment → QC readings + decision (D-03) → tare → truck exit → GRN follow-up
(recorded after exit: the three domains are independent by design) → document package → PDF
upload (magic bytes + ClamAV) → checklist resolution → authority send → HO review → verify →
**start accounting → correction with reason → hand over → (return loop) → approve → post bill**.
Verified by: backend suite (61), live audit script (WF-001…WF-022), Playwright journeys (34),
and interactive browser runs on both a fresh package and the user's own DEMO-PKG-0003.

## 6. Accountant and Head Accountant verification
- Accountant receives verified cases (queue), reviews documents (read-only), edits **only** the
  authorized fields (`accountingRef`, own notes — head note blocked), every correction persisted
  with before/after + reason in `AccountingCorrection` **and** the append-only audit log.
- Forwarding requires explicit confirmation; incomplete/unreviewed cases cannot be posted
  (post from `verified`/`with_accounting`/`with_head_accountant` → 422).
- Head Accountant approves (or returns with reason) and posts; posting requires
  `accounting_approved` + a typed bill reference; **duplicate posting → 422**; correction after
  posting → 422; concurrent same-version approval → exactly one success + one 409; failed writes
  roll back and never mark the bill posted (WF-010…020, OVER-003).
- Unauthorized users (gate/qc/docs/ho/admin) are 403 on every accounting action (WRITE-003/005/006).

## 7. UI/UX and accessibility results
Browser-verified (not code-only) at 1440/1024/768/390: role dashboards, accounting queue and
package page, correction dialog (aria-labelled, ESC-closable, focus moved on open, labelled
fields), gate follow-up, HO inbox tables, QC queue, admin matrix. Text contrast and touch
targets read well; tables and tabs scroll on small screens; loading/empty/error states present.
Screenshots: `audit-reports/screenshots/` (initial `*.png`, fixed overview `overview-ho-fixed-1440.png`,
re-audit `rea-*.png`).

## 8. Security and database integrity findings
- Sessions: 401 without cookie; identical generic wording for wrong user/password; 5-session
  global capacity; 2h-idle and 12h-absolute caps enforced on both cookie and refresh paths.
- Audit: append-only enforced by DB triggers + REVOKE (live UPDATE probe rejected), hash-chained rows.
- Uploads: %PDF- magic bytes, ClamAV scan, size caps; infected files never land (suite item 6).
- Writes: Idempotency-Key required (+422 on key reuse with a different body), If-Match optimistic
  locking, single-transaction commands, advisory-locked idempotency records.
- Fixed this cycle: KPMPL-001 (input charset), KPMPL-003 (SPA headers).
- Known accepted limitations: no CSP on the local SPA (HSTS/TLS is a front-proxy concern in
  production); the app runs behind nginx without TLS locally.

## 9. Actual test commands and results
See `TEST_EVIDENCE.md` — summary: backend **61/61**, frontend **82/82**, live audit script
**113/113**, Playwright **34/34**, plus migration/audit-immutability/headers probes.

## 10. Frontend/backend integration
The served build was verified to be the latest build (asset hash equality before AND after the
fix cycle), running in real HTTP mode against the live API through nginx; every workflow was
exercised through that origin.

## 11. Remaining business ambiguities
See ISSUE_TRACKER D-1…D-4. Nothing was invented to fill these gaps; the system keeps internal
posting and external ERP milestones explicitly separate, with audit evidence on both.

## 12. Local startup instructions
```
cd backend
docker compose up -d            # postgres, redis, minio, clamav, migrate (+seed), api
# web: the local nginx container serves frontend/kpmpl-frontend/dist on :5173, or:
cd frontend/kpmpl-frontend && npm ci && npm run build   # then serve dist (bind-mounted)
# app: http://localhost:5173  (API health: /api/v1/healthz, /readyz)
# tests: see TEST_EVIDENCE.md sections A–C
```

## 13. Deployment and rollback considerations
- Rollback = `git checkout b67df5c` + `docker compose build api migrate && docker compose up -d migrate api`
  (the audit fixes are code-only: **no new migrations** were needed; migration history untouched).
- KPMPL-001 changes write-time validation only — existing rows (including any pre-fix rows with
  unusual characters) remain readable; only new writes are validated.
- The hardened local web config is documented in `frontend/kpmpl-frontend/nginx-local.conf`; the
  container's mount still points at the %TEMP% copy — keep them in sync or recreate the container
  with the workspace path.
- Production deployment remains out of scope for this audit (local-only work; no pushes).

## 14. Readiness verdict
**Ready for controlled client UAT** — with the following explicit caveats:
1. The four pending business decisions (D-1…D-4) must be resolved before any production use;
   the accounting workflow intentionally stops at the internal "Bill Posted" state.
2. TLS termination, real hostnames and the production nginx template (not the local config) are
   deployment prerequisites — not exercised here.
3. No remote CI has run on the audit-fix commit; the verification above is local but complete.
"Ready for UAT" is not a production-readiness claim.
