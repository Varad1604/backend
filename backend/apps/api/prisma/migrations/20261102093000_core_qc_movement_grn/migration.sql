-- Additive synthetic core workflow. Human review required before merge.
CREATE TABLE "QCInspection" (
 "id" UUID PRIMARY KEY, "visitId" UUID NOT NULL REFERENCES "ReceivingVisit"("id") ON DELETE RESTRICT,
 "qcStatus" TEXT NOT NULL DEFAULT 'submitted' CHECK ("qcStatus" IN ('draft','submitted','returned','accepted','accepted_with_deduction','rejected')),
 "currentRevisionId" UUID, "createdBy" UUID NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "QCRevision" (
 "id" UUID PRIMARY KEY, "inspectionId" UUID NOT NULL REFERENCES "QCInspection"("id") ON DELETE RESTRICT,
 "revisionNo" INTEGER NOT NULL CHECK ("revisionNo" >= 1), "measurements" JSONB NOT NULL CHECK (jsonb_typeof("measurements") = 'array'),
 "remarks" TEXT, "reason" TEXT, "submittedBy" UUID NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
 "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "supersedesId" UUID REFERENCES "QCRevision"("id") ON DELETE RESTRICT,
 CHECK ("supersedesId" IS NULL OR ("supersedesId" <> "id" AND "reason" IS NOT NULL AND length(trim("reason")) > 0))
);
ALTER TABLE "QCInspection" ADD CONSTRAINT "QCInspection_currentRevisionId_fkey" FOREIGN KEY ("currentRevisionId") REFERENCES "QCRevision"("id") ON DELETE RESTRICT;
CREATE UNIQUE INDEX "QCInspection_currentRevisionId_key" ON "QCInspection"("currentRevisionId");
CREATE UNIQUE INDEX "QCRevision_supersedesId_key" ON "QCRevision"("supersedesId");
CREATE UNIQUE INDEX "QCRevision_inspectionId_revisionNo_key" ON "QCRevision"("inspectionId", "revisionNo");
CREATE INDEX "QCInspection_visitId_idx" ON "QCInspection"("visitId");
CREATE TABLE "VehicleExit" (
 "id" UUID PRIMARY KEY, "visitId" UUID NOT NULL UNIQUE REFERENCES "ReceivingVisit"("id") ON DELETE RESTRICT,
 "physicalExitAt" TIMESTAMP(3) NOT NULL, "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "recordedBy" UUID NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT, "remarks" TEXT
);
CREATE TABLE "GRNReference" (
 "id" UUID PRIMARY KEY, "officialGrnRef" TEXT NOT NULL,
 "verifiedBy" UUID NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
 "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "source" TEXT NOT NULL DEFAULT 'manual_staff_confirmation' CHECK ("source" = 'manual_staff_confirmation')
);
CREATE INDEX "GRNReference_officialGrnRef_idx" ON "GRNReference"("officialGrnRef");
CREATE TABLE "GRNLink" (
 "id" UUID PRIMARY KEY, "visitId" UUID NOT NULL REFERENCES "ReceivingVisit"("id") ON DELETE RESTRICT,
 "grnReferenceId" UUID NOT NULL REFERENCES "GRNReference"("id") ON DELETE RESTRICT,
 "createdBy" UUID NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "GRNLink_visitId_grnReferenceId_key" ON "GRNLink"("visitId", "grnReferenceId");
CREATE FUNCTION kpmpl_core_history_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Core event history is append-only' USING ERRCODE = '55000'; END;
$$;
CREATE TRIGGER "QCRevision_no_edit" BEFORE UPDATE OR DELETE ON "QCRevision" FOR EACH ROW EXECUTE FUNCTION kpmpl_core_history_immutable();
CREATE TRIGGER "QCRevision_no_truncate" BEFORE TRUNCATE ON "QCRevision" FOR EACH STATEMENT EXECUTE FUNCTION kpmpl_core_history_immutable();
CREATE TRIGGER "VehicleExit_no_edit" BEFORE UPDATE OR DELETE ON "VehicleExit" FOR EACH ROW EXECUTE FUNCTION kpmpl_core_history_immutable();
CREATE TRIGGER "GRNReference_no_edit" BEFORE UPDATE OR DELETE ON "GRNReference" FOR EACH ROW EXECUTE FUNCTION kpmpl_core_history_immutable();
CREATE TRIGGER "GRNLink_no_edit" BEFORE UPDATE OR DELETE ON "GRNLink" FOR EACH ROW EXECUTE FUNCTION kpmpl_core_history_immutable();

CREATE TRIGGER "VehicleExit_no_truncate" BEFORE TRUNCATE ON "VehicleExit" FOR EACH STATEMENT EXECUTE FUNCTION kpmpl_core_history_immutable();
CREATE TRIGGER "GRNReference_no_truncate" BEFORE TRUNCATE ON "GRNReference" FOR EACH STATEMENT EXECUTE FUNCTION kpmpl_core_history_immutable();
CREATE TRIGGER "GRNLink_no_truncate" BEFORE TRUNCATE ON "GRNLink" FOR EACH STATEMENT EXECUTE FUNCTION kpmpl_core_history_immutable();
