-- Seed the brief role/capability matrix for both upgraded and fresh databases.
INSERT INTO "Role" ("code", "createdAt") VALUES
  ('gate', CURRENT_TIMESTAMP), ('gate_doc', CURRENT_TIMESTAMP), ('qc', CURRENT_TIMESTAMP),
  ('qc_reviewer', CURRENT_TIMESTAMP), ('ho', CURRENT_TIMESTAMP), ('admin', CURRENT_TIMESTAMP),
  ('qc_operator', CURRENT_TIMESTAMP), ('qc_manager', CURRENT_TIMESTAMP),
  ('gate_doc_authority', CURRENT_TIMESTAMP), ('ho_accounts', CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "Capability" ("code", "createdAt") VALUES
  ('receiving.view', CURRENT_TIMESTAMP), ('receiving.create', CURRENT_TIMESTAMP), ('receiving.edit', CURRENT_TIMESTAMP),
  ('gate.followup', CURRENT_TIMESTAMP), ('qc.queue.view', CURRENT_TIMESTAMP), ('qc.measure', CURRENT_TIMESTAMP),
  ('qc.review.demo', CURRENT_TIMESTAMP), ('overview.view', CURRENT_TIMESTAMP), ('docs.prepare', CURRENT_TIMESTAMP),
  ('docs.submit', CURRENT_TIMESTAMP), ('ho.inbox', CURRENT_TIMESTAMP), ('ho.review', CURRENT_TIMESTAMP),
  ('erp.confirm', CURRENT_TIMESTAMP), ('admin.users', CURRENT_TIMESTAMP), ('auth.self', CURRENT_TIMESTAMP),
  ('platform.read', CURRENT_TIMESTAMP), ('identity.manage', CURRENT_TIMESTAMP), ('audit.verify', CURRENT_TIMESTAMP),
  ('receiving.read', CURRENT_TIMESTAMP), ('weighment.record', CURRENT_TIMESTAMP), ('qc.queue', CURRENT_TIMESTAMP),
  ('qc.submit', CURRENT_TIMESTAMP), ('movement.exit', CURRENT_TIMESTAMP), ('grn.record', CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

WITH matrix(role_code, capability_code) AS (VALUES
  ('gate','receiving.view'),('gate','receiving.create'),('gate','receiving.edit'),('gate','gate.followup'),('gate','qc.queue.view'),('gate','overview.view'),('gate','docs.prepare'),
  ('gate','receiving.read'),('gate','weighment.record'),('gate','movement.exit'),('gate','grn.record'),
  ('gate_doc','receiving.view'),('gate_doc','overview.view'),('gate_doc','docs.prepare'),('gate_doc','docs.submit'),
  ('gate_doc_authority','receiving.view'),('gate_doc_authority','overview.view'),('gate_doc_authority','docs.prepare'),('gate_doc_authority','docs.submit'),
  ('qc','receiving.view'),('qc','qc.queue.view'),('qc','qc.measure'),('qc','overview.view'),('qc','receiving.read'),('qc','qc.queue'),('qc','qc.submit'),
  ('qc_operator','receiving.view'),('qc_operator','qc.queue.view'),('qc_operator','qc.measure'),('qc_operator','overview.view'),('qc_operator','receiving.read'),('qc_operator','qc.queue'),('qc_operator','qc.submit'),
  ('qc_reviewer','receiving.view'),('qc_reviewer','qc.queue.view'),('qc_reviewer','qc.review.demo'),('qc_reviewer','overview.view'),('qc_reviewer','receiving.read'),('qc_reviewer','qc.queue'),
  ('qc_manager','receiving.view'),('qc_manager','qc.queue.view'),('qc_manager','qc.review.demo'),('qc_manager','overview.view'),('qc_manager','receiving.read'),('qc_manager','qc.queue'),
  ('ho','receiving.view'),('ho','overview.view'),('ho','ho.inbox'),('ho','ho.review'),('ho','erp.confirm'),
  ('ho_accounts','receiving.view'),('ho_accounts','overview.view'),('ho_accounts','ho.inbox'),('ho_accounts','ho.review'),('ho_accounts','erp.confirm'),
  ('admin','receiving.view'),('admin','overview.view'),('admin','ho.inbox'),('admin','admin.users'),('admin','identity.manage'),('admin','audit.verify')
)
INSERT INTO "RoleCapability" ("roleId", "capabilityId")
SELECT r."id", c."id" FROM matrix m JOIN "Role" r ON r."code" = m.role_code JOIN "Capability" c ON c."code" = m.capability_code
ON CONFLICT ("roleId", "capabilityId") DO NOTHING;
