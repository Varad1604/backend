# ADR-012: P1 identity/session implementation

P0 baseline b44e90c: GitHub run 41306514628 passed all three jobs, including full
Compose routing; local routing also passed. P0 PR #1 remains unmerged for review.

P1 contract 0.2.0 is recorded before handler implementation, as a reviewable draft.
No human contract sign-off or client production authorization is inferred.

Retain the foundation's openapi-typescript/openapi-fetch generator for this
iteration: it already generates the sole web/mobile contract client and passes
the complete foundation build. This explicitly records the engineering deviation
from @hey-api/openapi-ts; changing generators adds no P1 security behavior.

Use Argon2id, jsonwebtoken with ES256/issuer/audience enforcement, one global
five-session registry, refresh-history hashes and per-session CSRF proof.
Cookie refresh is httpOnly/SameSite=Strict; cookies are Secure by default in
production. Explicit synthetic HTTP demo configuration is allowed; live roster
and client approval duties remain blocked. Browser sessions keep access tokens
in memory; mobile refresh tokens use secure storage in P7.

Serialize session changes and the audit-chain head with transaction-scoped
Postgres advisory locks. Audit events and session changes commit atomically.
Enforce append-only audit through database triggers as well as code discipline.
DB-owner privileges must remain separate from the production runtime role.
Raw SQL is limited to these reviewed locks, sequence/timestamp allocation and
migration DDL. No business references or user SQL are interpolated into queries.

Bootstrap only synthetic DEMO- identities through an explicit CLI command, with
operator-provided passwords. No password or signing key is committed. D-07
production provisioning is not implemented. All future domain routes deny by
default until annotated with an explicit capability; record visibility has no
administrator bypass. Auth-token issuance is a security protocol: refresh reuse
revokes instead of replaying issued secrets into idempotency snapshots.
