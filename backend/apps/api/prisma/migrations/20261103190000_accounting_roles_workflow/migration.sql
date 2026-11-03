-- Accounting upgrade 2026-11-03: Accountant and Head Accountant roles, the
-- HO → Accountant → Head Accountant → Bill Posted workflow tables, and the
-- role/capability rows that power them. Additive only: no existing column is
-- altered or dropped, no row is updated or deleted, and every insert is
-- idempotent (safe to replay against an already-migrated database).

-- 1) New roles (ON CONFLICT DO NOTHING: existing roles and users are untouched).
INSERT INTO "Role" ("code", "createdAt") VALUES
  ('accountant', CURRENT_TIMESTAMP), ('head_accountant', CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

-- 2) New capabilities.
INSERT INTO "Capability" ("code", "createdAt") VALUES
  ('accounting.inbox', CURRENT_TIMESTAMP), ('accounting.review', CURRENT_TIMESTAMP),
  ('accounting.approve', CURRENT_TIMESTAMP), ('accounting.post', CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

-- 3) Grants: accountant = view + review; head_accountant = those + approve + post.
WITH matrix(role_code, capability_code) AS (VALUES
  ('accountant','receiving.view'),('accountant','overview.view'),
  ('accountant','accounting.inbox'),('accountant','accounting.review'),
  ('head_accountant','receiving.view'),('head_accountant','overview.view'),
  ('head_accountant','accounting.inbox'),('head_accountant','accounting.review'),
  ('head_accountant','accounting.approve'),('head_accountant','accounting.post')
)
INSERT INTO "RoleCapability" ("roleId", "capabilityId")
SELECT r."id", c."id" FROM matrix m JOIN "Role" r ON r."code" = m.role_code JOIN "Capability" c ON c."code" = m.capability_code
ON CONFLICT ("roleId", "capabilityId") DO NOTHING;

-- 4) Accounting workflow tables (Prisma models AccountingRecord / AccountingCorrection).
CREATE TABLE "AccountingRecord" ("id" UUID NOT NULL,"packageId" UUID NOT NULL,"stage" TEXT NOT NULL DEFAULT 'with_accountant',"accountingRef" TEXT,"accountantNote" TEXT,"headAccountantNote" TEXT,"startedBy" UUID NOT NULL,"startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"submittedBy" UUID,"submittedAt" TIMESTAMP(3),"approvedBy" UUID,"approvedAt" TIMESTAMP(3),"postedBy" UUID,"postedAt" TIMESTAMP(3),CONSTRAINT "AccountingRecord_pkey" PRIMARY KEY ("id"));
CREATE TABLE "AccountingCorrection" ("id" UUID NOT NULL,"packageId" UUID NOT NULL,"field" TEXT NOT NULL,"oldValue" TEXT,"newValue" TEXT,"reason" TEXT NOT NULL,"correctedBy" UUID NOT NULL,"correctedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,CONSTRAINT "AccountingCorrection_pkey" PRIMARY KEY ("id"));

CREATE UNIQUE INDEX "AccountingRecord_packageId_key" ON "AccountingRecord"("packageId");
CREATE INDEX "AccountingCorrection_packageId_correctedAt_idx" ON "AccountingCorrection"("packageId","correctedAt");

ALTER TABLE "AccountingRecord" ADD CONSTRAINT "AccountingRecord_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "DocumentPackage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AccountingRecord" ADD CONSTRAINT "AccountingRecord_startedBy_fkey" FOREIGN KEY ("startedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AccountingRecord" ADD CONSTRAINT "AccountingRecord_submittedBy_fkey" FOREIGN KEY ("submittedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AccountingRecord" ADD CONSTRAINT "AccountingRecord_approvedBy_fkey" FOREIGN KEY ("approvedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AccountingRecord" ADD CONSTRAINT "AccountingRecord_postedBy_fkey" FOREIGN KEY ("postedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AccountingCorrection" ADD CONSTRAINT "AccountingCorrection_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "DocumentPackage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AccountingCorrection" ADD CONSTRAINT "AccountingCorrection_correctedBy_fkey" FOREIGN KEY ("correctedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
