-- Additive prototype migration. Human SQL review required before merge.
CREATE TABLE "ReceivingVisit" (
  "id" UUID PRIMARY KEY, "officialGateEntryRef" TEXT NOT NULL,
  "vehicleNumber" TEXT NOT NULL, "supplierDisplayName" TEXT NOT NULL,
  "materialDisplayName" TEXT NOT NULL, "challanRef" TEXT, "poRef" TEXT, "notes" TEXT,
  "isDemo" BOOLEAN NOT NULL DEFAULT true, "visitStatus" TEXT NOT NULL DEFAULT 'created',
  "version" INTEGER NOT NULL DEFAULT 1 CHECK ("version" >= 1),
  "createdBy" UUID NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "ReceivingVisit_officialGateEntryRef_idx" ON "ReceivingVisit"("officialGateEntryRef");
CREATE INDEX "ReceivingVisit_createdAt_id_idx" ON "ReceivingVisit"("createdAt", "id");
CREATE TABLE "Weighment" (
  "id" UUID PRIMARY KEY,
  "visitId" UUID NOT NULL REFERENCES "ReceivingVisit"("id") ON DELETE RESTRICT,
  "kind" TEXT NOT NULL CHECK ("kind" IN ('gross','tare')),
  "value" NUMERIC(12,3) NOT NULL CHECK ("value" > 0),
  "unit" TEXT NOT NULL CHECK ("unit" IN ('kg','mt')),
  "recordedBy" UUID NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "correctsId" UUID REFERENCES "Weighment"("id") ON DELETE RESTRICT,
  "reason" TEXT,
  CHECK ("correctsId" IS NULL OR ("correctsId" <> "id" AND length(trim("reason")) > 0 AND "reason" IS NOT NULL))
);
CREATE UNIQUE INDEX "Weighment_correctsId_key" ON "Weighment"("correctsId");
-- One initial reading per kind, followed by a linear correction chain.
CREATE UNIQUE INDEX "Weighment_initial_kind_idx" ON "Weighment"("visitId", "kind") WHERE "correctsId" IS NULL;
CREATE INDEX "Weighment_visitId_recordedAt_idx" ON "Weighment"("visitId", "recordedAt");
CREATE FUNCTION kpmpl_weighment_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Weighment history is append-only' USING ERRCODE = '55000'; END;
$$;
CREATE TRIGGER "Weighment_no_edit" BEFORE UPDATE OR DELETE ON "Weighment" FOR EACH ROW EXECUTE FUNCTION kpmpl_weighment_immutable();
CREATE TRIGGER "Weighment_no_truncate" BEFORE TRUNCATE ON "Weighment" FOR EACH STATEMENT EXECUTE FUNCTION kpmpl_weighment_immutable();
