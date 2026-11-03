# P1 identity and platform review

Date: 1 November 2026. Synthetic prototype implementation; human review pending.

P0 passed GitHub CI run 41306514628 on foundation commit b44e90c. Draft PR #1
remains unmerged. P1 is stacked on that branch; no main-branch merge occurred.

## Implemented

- Argon2id login; ES256 access JWTs with issuer/audience/expiry checks and
  database session validation on every authenticated request.
- One global five-session cap serialized under concurrent logins. Expired,
  revoked or inactive sessions cannot use access or refresh credentials.
- Refresh-token hash history and reuse revocation committed in the same
  transaction as audit. Browser refresh uses httpOnly/SameSite=Strict cookies
  with session-bound double-submit CSRF proof. Production cookies default Secure.
- Redis login limits and exponential account lockout; explicit connect/command
  deadlines. Nest initialization awaits the first connection attempt, fixing a
  readiness race observed during verification.
- Deny-by-default route capabilities, demo-admin account listing, fresh role
  reads and record visibility policy without an administrator bypass.
- A synthetic access-change use case revokes all of the target user's sessions
  and audits the old/new role and activity state. Production roster remains
  not_configured; this is not a production account-provisioning UI.
- Hash-chained audit appends under a serialized head lock, verification endpoint
  for demo admin, daily verifier and database rejection of UPDATE/DELETE/TRUNCATE.
  Hash format: SHA-256 of sorted canonical JSON including prevHash, opaque entity
  ID, event sequence ID, DB timestamp and before/after values. This records the
  engineering encoding of the section 9.4 chain without rewriting history.
- Authenticated feature flags keep M2, QC decisions, deduction calculations and
  production roster inactive.
- Web sign-in/sign-out, in-memory access credentials, refresh after reload,
  serialized refresh across tabs and honest failed-request feedback. Static CSS
  permits removal of unsafe-inline styles from CSP.
- Five synthetic accounts bootstrap with separately generated passwords saved
  only to ignored .demo-credentials.json. Signing keys stay in ignored .env.
  Both files are excluded from Docker contexts. No password appears in audit.

## Verification

- Backend security suite: 20 tests, including real transactions in a temporary
  migrated schema which is removed after the run. Web: 3 component tests.
- Two Chrome journeys passed through Caddy, covering sign-in, cookie flags,
  reload, second tab, sign-out, wrong password and narrow viewport. No page
  errors were observed. Access credentials were absent from localStorage.
- Live readiness/SPA/asset smoke passed. High/critical audit gate passes; low
  and moderate upstream advisories remain visible rather than suppressed.
- SQL migration is additive, revokes legacy sessions and adds refresh history
  and immutable-audit triggers. Human SQL review is still required before merge.
- Docker build caching now separates manifests from source files. Final image
  and remote P1 CI evidence are recorded after those checks finish.

## Acceptance boundary

This proves the identity/platform slice. AT-01's complete Gate workspace and
AT-11's actual QC-write route will be exercised with P2/P3; they are not claimed
complete from a login screen or a missing QC endpoint. Production duties,
client sign-off, deployment acceptance and UAT remain separate requirements.

The local HTTP demo explicitly disables Secure cookies only while DEMO_MODE is
true; live configuration rejects that combination. The production runtime must
use a restricted DB role distinct from the migration owner, TLS, protected
signing keys and approved real-person permissions before activation.
