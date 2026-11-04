-- B-16/F-12: the AccountingCheck model declares per-check JSON detail columns
-- (status + note for each of the three checks) that were missing from the table
-- the earlier check-table migration created. Additive only; nullable.
ALTER TABLE "accounting_checks" ADD COLUMN "bill_check" JSONB,
ADD COLUMN "gst_check" JSONB,
ADD COLUMN "tds_check" JSONB;
