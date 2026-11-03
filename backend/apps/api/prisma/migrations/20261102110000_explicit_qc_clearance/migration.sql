-- User explicitly requires QC Cleared + tare before departure.
-- Legacy observations are pending, never automatically cleared. SQL needs human review before merge.
ALTER TABLE "QCRevision" ADD COLUMN "clearance" TEXT NOT NULL DEFAULT 'pending'
 CHECK ("clearance" IN ('pending','cleared','hold'));
ALTER TABLE "QCRevision" ADD COLUMN "visitVersion" INTEGER
 CHECK ("visitVersion" IS NULL OR "visitVersion" >= 1);
