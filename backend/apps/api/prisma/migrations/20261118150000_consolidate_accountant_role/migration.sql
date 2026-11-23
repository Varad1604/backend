-- Retire active Head Accountant role without removing audit actors or historical approvals.
-- Run in controlled deployment ONLY after new backend is ready; do NOT run against DataMan.
DO $migration$
DECLARE
  old_role_id integer;
  accountant_role_id integer;
BEGIN
  SELECT id INTO old_role_id FROM "Role" WHERE code = 'head_accountant';
  SELECT id INTO accountant_role_id FROM "Role" WHERE code = 'accountant';
  IF old_role_id IS NOT NULL AND accountant_role_id IS NULL THEN
    RAISE EXCEPTION 'Accountant role must exist before consolidating Head Accountant';
  END IF;

  -- Former in-flight Head Accountant packets return to Accountant review, not fake approval.
  UPDATE "DocumentPackage"
     SET status = 'with_accounting', version = version + 1, "updatedAt" = now()
   WHERE status IN ('with_head_accountant', 'forwarded_to_head_accountant', 'returned_to_accountant');
  UPDATE "AccountingRecord" SET stage = 'with_accountant' WHERE stage = 'with_head_accountant';

  IF accountant_role_id IS NOT NULL THEN
  -- Existing authorization reads database-backed grants, not the TypeScript policy.
  -- Grant the retired role's exact three elevated capabilities to Accountant.
  INSERT INTO "Capability" (code)
    VALUES ('accounting.approve'), ('accounting.post'), ('erp.final_posting')
    ON CONFLICT (code) DO NOTHING;
  INSERT INTO "RoleCapability" ("roleId", "capabilityId")
    SELECT accountant_role_id, c.id FROM "Capability" c
     WHERE c.code IN ('accounting.approve', 'accounting.post', 'erp.final_posting')
    ON CONFLICT ("roleId", "capabilityId") DO NOTHING;
  END IF;

  IF old_role_id IS NOT NULL THEN
    INSERT INTO "UserRole" ("userId", "roleId", "grantedBy", "grantedAt")
    SELECT ur."userId", accountant_role_id, ur."grantedBy", now()
      FROM "UserRole" ur JOIN "User" u ON u.id = ur."userId"
     WHERE ur."roleId" = old_role_id
       AND NOT (u.synthetic = TRUE AND u."fullName" = 'Demo Head Accountant')
    ON CONFLICT ("userId", "roleId") DO NOTHING;

    UPDATE "Session" s SET "revokedAt" = now()
      FROM "UserRole" ur
     WHERE s."userId" = ur."userId" AND ur."roleId" = old_role_id AND s."revokedAt" IS NULL;

    UPDATE "User" u SET "isActive" = FALSE, "updatedAt" = now()
     WHERE u.synthetic = TRUE AND u."fullName" = 'Demo Head Accountant'
       AND EXISTS (SELECT 1 FROM "UserRole" ur WHERE ur."userId" = u.id AND ur."roleId" = old_role_id);

    DELETE FROM "UserRole" WHERE "roleId" = old_role_id;
    DELETE FROM "RoleCapability" WHERE "roleId" = old_role_id;
    DELETE FROM "Role" WHERE id = old_role_id;
  END IF;
END
$migration$;
