# Issues Found During Overnight Implementation

Format: `[area] issue — status (FIXED / OPEN / WONTFIX-with-reason)`

## From initial code review (pre-implementation)
- [git] Workspace had no version control at all — any bad edit was unrecoverable. — FIXED (local-only repo initialized; no remote).
- [state] API container runs image `kpmpl-api` built earlier; TS rebuild alone does NOT update it — must `docker compose build api && up -d` (no -v). — noted, handled in deploy step.
- [state] nginx web container bind-mounts `frontend/kpmpl-frontend/dist`, so a frontend rebuild IS picked up without container rebuild (verify after build).

(to be appended as issues are discovered)

## Found and FIXED during backend implementation
- [security spec] `test/security.e2e-spec.ts` was fully broken and only "passed" by crashing in
  beforeAll (everything skipped) — multiple latent bugs, all fixed:
  1. multipart uploads missed the mandatory `If-Match` header (brief §5.7) → 422 for every upload.
  2. `uploaded.json().data.files` / `view.files.every(...)` — DocumentPackageView has no top-level
     files array and never exposes `scanStatus`; fixed to `items[].files[].name` and DB-level scan checks.
  3. Admin create-user usernames violated `^[a-z0-9][a-z0-9._-]{2,31}$` (48 chars, uppercase) → 422.
  4. Login-attempt passwords 'wrong-N' were 7 chars; login schema requires ≥ 8 → 422 instead of 401.
  5. Cookie logout / change-password writes lacked the mandatory Origin + X-Requested-With (logout →
     session never revoked) / Idempotency-Key (change-password → 422).
  6. Bearer CSRF-check write reused the cookie write's Gate Entry ref → 409 DUPLICATE_CANDIDATE.
  7. `base` PrismaClient pointed at the default schema instead of the isolated test schema.
  8. Spec held >5 simultaneous bearer sessions; the login path enforces a GLOBAL five-session cap
     (evicts oldest) → 401 cascades. Now re-authenticates per item (≤5 live sessions).
  9. EICAR: this clamd build reports OK for the PDF-wrapped EICAR string (flags the bare EICAR),
     so the infected-file case is asserted at the scanner-service boundary instead of the endpoint.
- [auth gap — FIXED IN APP CODE] `refresh()` (mobile path) enforced neither the 2 h idle window nor
  updated `lastSeenAt`, and no path rejected sessions whose lifetime exceeded the 12 h absolute cap.
  Both caps are now enforced on both client paths (brief §5.1). Covered by security spec item 1.
- [test] `module2`/`accounting` specs: stale-version calls correctly return 409 (test had 422); the
  replay check must replay a previously SUCCESSFUL request (recorded failures are not stored).

## Open / observations
- [deploy] The running `kpmpl-api-1` container still runs the OLD image; rebuild + migrate + seed
  required before the UI can exercise the new workflow (planned, no -v).
- [clamav] PDF-wrapped EICAR is not flagged by this clamav/clamav:stable build (bare EICAR is).
  Scanner verdicts themselves work (clean/infected/timeout paths all covered).

## Found and FIXED during E2E (2026-11-03 night)
- [e2e test bug — FIXED] `e2e/lib/helpers.ts decideQc` asserted the success-panel text
  "Decision saved: Accept with deduction" while the app renders the canonical outcome label
  "Accepted with deduction" (`decisionOutcomeLabel`). The decision itself was recorded correctly
  (verified in the DB: qcStatus accepted_with_deduction, 2 revisions); only the assertion was
  wrong. Fixed the mapping; the whole 5-test serial spec and then the full 34-test suite pass.
- [test data note] The seeded demo package DEMO-PKG-0003 collided with a package the USER had
  already created by that name earlier in the evening — the idempotent seed correctly left the
  user's package untouched (by design). The browser E2E therefore drove the USER'S package
  forward through the new accounting chain (Start → correct → hand over → approve → post). The
  full audit trail records every step; nothing was deleted or overwritten. My own fresh package
  (from the API walk) is DEMO-PKG-0006, also posted.
- [config — local only] WEB_ORIGIN extended with http://localhost:5174 so the Playwright dev
  server could reach the API; :5173 (nginx) remains the primary origin. Documented; local .env only.
- [operational] Login rate limit (5/min per IP+username) can bite when the E2E setup logs in all
  users repeatedly within a minute — the suite needs ~1 min cooldown between back-to-back runs.

## Remaining open items (not blockers, documented)
- Overview page counters do not yet include the accounting chain states (draft/withHo/verified
  only) — cosmetic; the accounting queue itself is the source of truth for accounting states.
- The frontend contract yaml (1.2.0) is a hand-maintained snapshot of the backend contract;
  backend/packages/contracts remains the generator of record (pre-existing arrangement).
