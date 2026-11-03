-- User requested a three-input arrival. Missing details stay NULL, never fabricated.
-- No rows or existing values are changed. Human SQL review required before merge.
ALTER TABLE "ReceivingVisit" ALTER COLUMN "supplierDisplayName" DROP NOT NULL;
ALTER TABLE "ReceivingVisit" ALTER COLUMN "materialDisplayName" DROP NOT NULL;
