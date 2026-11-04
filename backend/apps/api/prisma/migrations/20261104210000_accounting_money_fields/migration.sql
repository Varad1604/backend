-- B-11: optional money fields on the accounting case (KPMPL to confirm the field set —
-- see OPEN_QUESTIONS.md OQ-2). All four are nullable decimals with no computations.
ALTER TABLE "AccountingRecord" ADD COLUMN "invoiceAmount" DECIMAL(12,2),
ADD COLUMN "gstAmount" DECIMAL(12,2),
ADD COLUMN "tdsAmount" DECIMAL(12,2),
ADD COLUMN "netAmount" DECIMAL(12,2);
