-- Client decision 2026-11-03 (Kaygaon Paper Mills, brief D-03 "who decides QC outcomes"):
-- there is no QC reviewer. The QC operator (role `qc`) records the readings AND makes the
-- final QC decision. Safe on a fresh database (nothing seeded yet) and on an existing one
-- that already holds demo data. Earlier migrations are left untouched.

-- 1. The decision capability is a real step now: `qc.review.demo` becomes `qc.decide`.
--    Renamed in place so every existing grant keeps pointing at the same row.
UPDATE "Capability" SET "code" = 'qc.decide', "description" = 'Record the final QC decision (D-03: QC operator)'
WHERE "code" = 'qc.review.demo'
  AND NOT EXISTS (SELECT 1 FROM "Capability" WHERE "code" = 'qc.decide');
INSERT INTO "Capability" ("code", "description", "createdAt")
VALUES ('qc.decide', 'Record the final QC decision (D-03: QC operator)', CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;
-- If both rows existed, drop the old one (its grants cascade away; `qc` is granted below).
DELETE FROM "Capability" WHERE "code" = 'qc.review.demo';

-- 2. Grant it to the QC operator role (and the historical qc_operator row, which mirrors `qc`).
INSERT INTO "RoleCapability" ("roleId", "capabilityId")
SELECT r."id", c."id" FROM "Role" r JOIN "Capability" c ON c."code" = 'qc.decide'
WHERE r."code" IN ('qc', 'qc_operator')
ON CONFLICT ("roleId", "capabilityId") DO NOTHING;
-- Only the QC operator decides: the historical qc_manager row loses the inherited grant.
DELETE FROM "RoleCapability"
WHERE "capabilityId" IN (SELECT "id" FROM "Capability" WHERE "code" = 'qc.decide')
  AND "roleId" NOT IN (SELECT "id" FROM "Role" WHERE "code" IN ('qc', 'qc_operator'));

-- 3. Retire the reviewer role: its capability rows and user assignments go first, then the
--    role itself (RoleCapability/UserRole also cascade, this is explicit for readability).
DELETE FROM "RoleCapability" WHERE "roleId" IN (SELECT "id" FROM "Role" WHERE "code" = 'qc_reviewer');
DELETE FROM "UserRole" WHERE "roleId" IN (SELECT "id" FROM "Role" WHERE "code" = 'qc_reviewer');
DELETE FROM "Role" WHERE "code" = 'qc_reviewer';

-- 4. Retire the demo-review account. Its sessions are revoked. A hard delete is attempted;
--    when history references the user (QCReview.recordedBy and other RESTRICT foreign keys;
--    AuditEvent rows are immutable and keep the actor id), it is deactivated instead so the
--    stored decisions and the hash-chained audit trail stay intact.
UPDATE "Session" SET "revokedAt" = CURRENT_TIMESTAMP
WHERE "revokedAt" IS NULL AND "userId" IN (SELECT "id" FROM "User" WHERE "employeeCode" = 'demo-review');
DO $$
BEGIN
  BEGIN
    DELETE FROM "User" WHERE "employeeCode" = 'demo-review'
      AND NOT EXISTS (SELECT 1 FROM "AuditEvent" a JOIN "User" u ON a."actorId" = u."id" WHERE u."employeeCode" = 'demo-review');
  EXCEPTION WHEN foreign_key_violation OR restrict_violation OR object_not_in_prerequisite_state THEN
    NULL;
  END;
  UPDATE "User" SET "isActive" = false, "updatedAt" = CURRENT_TIMESTAMP
  WHERE "employeeCode" = 'demo-review' AND "isActive" = true;
END $$;

-- 5. New decisions are real, not demonstration records. Existing QCReview rows are
--    append-only history and keep their stored demonstrationOnly = true.
ALTER TABLE "QCReview" ALTER COLUMN "demonstrationOnly" SET DEFAULT false;
