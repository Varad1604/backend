# KPMPL backend runbook

## Start and verify

1. Copy `.env.example` to `.env`, replace every example credential, and keep the file outside version control.
2. Run `docker compose up -d --build`.
3. Apply migrations as a separate release step with `pnpm migrate:deploy` (the local API image also performs this before start).
4. Check `/api/v1/healthz` and `/api/v1/readyz`. Readiness must report database, Redis and private storage as `up`.
5. Sign in as an administrator and download `/api/v1/docs`; execute the Gate → QC → Gate and Package → HO smoke journeys with synthetic data.

## Backup and restore drill

PostgreSQL backups and object-store versioning are both required. RPO/RTO remain pending client agreement and are not claimed here.

For a staging restore drill:

1. Create an isolated staging database and private bucket. Never overwrite production.
2. Restore the latest database backup, then replay WAL to the chosen recovery point when PITR is available.
3. Restore one known synthetic PDF object version into the staging bucket.
4. start the staging API with the restored database/bucket and run readiness, audit verification, authorised PDF download and denied cross-role download.
5. Record the backup identifiers, timestamps, operator, results and observed duration in the deployment evidence. Delete the isolated restore only after evidence review.

No successful client-cloud restore drill is claimed until this procedure is executed against client-owned staging.

## Failure handling

- Database or storage down: readiness returns 503; do not route traffic.
- ClamAV down: uploads fail closed; existing clean documents remain readable.
- Failed migration: stop deployment, retain the old application, inspect the failed migration and use Prisma's documented resolve process only after database review.
- Audit verification failure: stop write traffic, preserve logs and database snapshots, and escalate. Never repair audit rows in place.
- Orphan object: compare private bucket keys with active `DocumentFile` rows and quarantine unmatched objects before deletion.

## Secrets and logs

Rotate database, Redis, bucket and signing credentials at handover. Logs must never contain passwords, tokens, cookies or file contents. Use `X-Request-Id` to correlate failures.
