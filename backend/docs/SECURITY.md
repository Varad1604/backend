# Security controls

- Argon2id password hashing, generic login failure messages, progressive lockout and revocable server-side sessions.
- HttpOnly SameSite=Lax web cookie; exact Origin plus `X-Requested-With: kpmpl-web` for cookie-authenticated writes. Bearer access remains available for mobile clients.
- Database-backed capability union for multiple roles. Every route is checked by the route-coverage test and every business command authorises again in its transaction.
- `Idempotency-Key` replay protection and root-version concurrency checks. Domain change, audit event and retry record commit atomically.
- Append-only, hash-chained audit rows with database-level UPDATE/DELETE denial.
- Private S3-compatible bucket, public-access block, AES-256 server-side encryption, versioning, authenticated streaming and no returned storage URLs.
- PDF MIME and magic-byte validation, 10 MB default limit, filename sanitisation and fail-closed ClamAV scanning.
- Helmet, credentialed origin allowlist, request IDs, no-store API responses, 100 KB JSON limit and structured redacted logs.
- Demo startup is rejected when `NODE_ENV=production`; test data and accounts use synthetic `DEMO-` identifiers.
- CI runs lint, strict typecheck, live migrations/tests, deployment builds, dependency audit, secret scan and Trivy high/critical image scan.

Open KPMPL policy decisions remain visible through `/api/v1/config/policies`; no QC formula, deduction, DataMan connection or outbound reminder channel is implemented.
