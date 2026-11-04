-- Add accounting roles and capabilities
INSERT INTO "Role" ("code", "createdAt") VALUES
  ('accountant', CURRENT_TIMESTAMP),
  ('head_accountant', CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "Capability" ("code", "createdAt") VALUES
  ('accounting.inbox', CURRENT_TIMESTAMP),
  ('accounting.review', CURRENT_TIMESTAMP),
  ('accounting.approve', CURRENT_TIMESTAMP),
  ('accounting.post', CURRENT_TIMESTAMP),
  ('erp.plant_head_approval', CURRENT_TIMESTAMP),
  ('erp.final_posting', CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

WITH matrix(role_code, capability_code) AS (VALUES
  ('accountant','receiving.view'),('accountant','overview.view'),('accountant','accounting.inbox'),('accountant','accounting.review'),
  ('head_accountant','receiving.view'),('head_accountant','overview.view'),('head_accountant','accounting.inbox'),('head_accountant','accounting.review'),
  ('head_accountant','accounting.approve'),('head_accountant','accounting.post'),('head_accountant','erp.final_posting')
)
INSERT INTO "RoleCapability" ("roleId", "capabilityId")
SELECT r."id", c."id" FROM matrix m JOIN "Role" r ON r."code" = m.role_code JOIN "Capability" c ON c."code" = m.capability_code
ON CONFLICT ("roleId", "capabilityId") DO NOTHING;
