-- Remove docs.prepare from gate role per A1
DELETE FROM "RoleCapability"
WHERE "roleId" IN (SELECT "id" FROM "Role" WHERE "code" = 'gate')
  AND "capabilityId" IN (SELECT "id" FROM "Capability" WHERE "code" = 'docs.prepare');
