-- P1 additive migration: human SQL review required before merge.
ALTER TABLE "Session" ADD COLUMN "csrfTokenHash" TEXT, ADD COLUMN "clientType" TEXT NOT NULL DEFAULT 'web';
UPDATE "Session" SET "revokedAt" = CURRENT_TIMESTAMP WHERE "revokedAt" IS NULL;
CREATE TABLE "RefreshTokenHistory" (
  "tokenHash" TEXT PRIMARY KEY,
  "sessionId" UUID NOT NULL REFERENCES "Session"("id") ON DELETE RESTRICT,
  "expiresAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "RefreshTokenHistory_sessionId_idx" ON "RefreshTokenHistory"("sessionId");
CREATE FUNCTION kpmpl_audit_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'AuditEvent is append-only' USING ERRCODE = '55000';
END;
$$;
CREATE TRIGGER "AuditEvent_no_edit" BEFORE UPDATE OR DELETE ON "AuditEvent"
FOR EACH ROW EXECUTE FUNCTION kpmpl_audit_immutable();
CREATE TRIGGER "AuditEvent_no_truncate" BEFORE TRUNCATE ON "AuditEvent"
FOR EACH STATEMENT EXECUTE FUNCTION kpmpl_audit_immutable();
REVOKE UPDATE, DELETE, TRUNCATE ON "AuditEvent" FROM PUBLIC;
