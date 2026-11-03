-- Phase 1 contract alignment (CONTRACT_DIFF rows #38/#73, #54, #77-#80, #146, #167, #175).
-- Additive; human review required before merge.

-- #38/#73: the UI sends and renders the truck's arrival time.
ALTER TABLE "ReceivingVisit" ADD COLUMN "arrivedAt" TIMESTAMP(3);

-- #77: the QC state machine uses the brief's status values (pending/in_progress/submitted/returned/accepted/accepted_with_deduction/rejected).
ALTER TABLE "QCInspection" DROP CONSTRAINT IF EXISTS "QCInspection_qcStatus_check";
UPDATE "QCInspection" SET "qcStatus" = 'in_progress' WHERE "qcStatus" = 'draft';
ALTER TABLE "QCInspection" ADD CONSTRAINT "QCInspection_qcStatus_check"
  CHECK ("qcStatus" IN ('pending','in_progress','submitted','returned','accepted','accepted_with_deduction','rejected'));

-- #52: revisions keep their resubmission reason under the contract field name.
-- The backfill below is a data migration, not a history rewrite: it copies the existing
-- reason into the new column, so the append-only trigger is suspended for its duration only.
ALTER TABLE "QCRevision" DISABLE TRIGGER "QCRevision_no_edit";
ALTER TABLE "QCRevision" ADD COLUMN "revisionReason" TEXT;
UPDATE "QCRevision" SET "revisionReason" = "reason";
ALTER TABLE "QCRevision" ENABLE TRIGGER "QCRevision_no_edit";
ALTER TABLE "QCRevision" ADD COLUMN "state" TEXT NOT NULL DEFAULT 'submitted' CHECK ("state" IN ('draft','submitted'));
-- A draft that supersedes a submitted revision may be saved before its revision reason exists;
-- only a submitted revision still requires one (R-07).
ALTER TABLE "QCRevision" DROP CONSTRAINT IF EXISTS "QCRevision_check";
ALTER TABLE "QCRevision" ADD CONSTRAINT "QCRevision_check"
  CHECK ("supersedesId" IS NULL OR ("supersedesId" <> "id" AND ("state" = 'draft' OR ("reason" IS NOT NULL AND length(trim("reason")) > 0))));

-- #80: QC review decisions (demonstration only, D-03) are stored history.
CREATE TABLE "QCReview" (
  "id" UUID PRIMARY KEY,
  "inspectionId" UUID NOT NULL REFERENCES "QCInspection"("id") ON DELETE RESTRICT,
  "outcome" TEXT NOT NULL CHECK ("outcome" IN ('returned','accepted','accepted_with_deduction','rejected')),
  "reason" TEXT NOT NULL,
  "demonstrationOnly" BOOLEAN NOT NULL DEFAULT true,
  "forRevision" INTEGER NOT NULL,
  "recordedBy" UUID NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "QCReview_inspectionId_idx" ON "QCReview"("inspectionId");

-- #54/#146: measurements are numeric rows with a fixed percent scale (brief §6 qc_measurement).
CREATE TABLE "QCMeasurement" (
  "id" UUID PRIMARY KEY,
  "revisionId" UUID NOT NULL REFERENCES "QCRevision"("id") ON DELETE RESTRICT,
  "code" TEXT NOT NULL,
  "value" DECIMAL(5,2) NOT NULL,
  "unit" TEXT NOT NULL DEFAULT 'percent',
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "QCMeasurement_revisionId_idx" ON "QCMeasurement"("revisionId");

-- Review notes are history: append-only, like the audit log. Measurement rows stay
-- rewritable because an unsaved draft (R-07) overwrites its readings until submitted.
CREATE FUNCTION kpmpl_qc_review_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'QC review history is append-only' USING ERRCODE = '55000';
END;
$$;
CREATE TRIGGER "QCReview_no_edit" BEFORE UPDATE OR DELETE ON "QCReview"
  FOR EACH ROW EXECUTE FUNCTION kpmpl_qc_review_immutable();

-- #167: a milestone's note (confirmation note, cleared on reversal; the reverse reason lives in reversalReason).
ALTER TABLE "ErpMilestone" ADD COLUMN "note" TEXT;

-- Brief §6 correction_request: who requested the correction (shown in the view).
ALTER TABLE "PackageCorrection" ADD COLUMN "requestedBy" UUID REFERENCES "User"("id") ON DELETE RESTRICT;

-- #175: admin-managed reference lists for the receiving form.
CREATE TABLE "ReferenceValue" (
  "id" UUID PRIMARY KEY,
  "kind" TEXT NOT NULL CHECK ("kind" IN ('supplier','material')),
  "value" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "ReferenceValue_kind_value_key" ON "ReferenceValue"("kind", "value");
