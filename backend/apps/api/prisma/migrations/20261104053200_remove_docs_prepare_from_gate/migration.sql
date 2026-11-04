-- Remove docs.prepare from the Gate Operator role (Part A).
-- Gate operators must not prepare or send document packages.
-- The Document Authority (gate_doc / gate_doc_authority) keeps docs.prepare + docs.submit.
DELETE FROM "RoleCapability"
WHERE "roleId" = (SELECT "id" FROM "Role" WHERE "code" = 'gate')
  AND "capabilityId" = (SELECT "id" FROM "Capability" WHERE "code" = 'docs.prepare');
