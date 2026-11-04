-- CreateTable
CREATE TABLE "accounting_checks" (
    "id" UUID NOT NULL,
    "packageId" UUID NOT NULL,
    "bill_passed" BOOLEAN NOT NULL DEFAULT false,
    "gst_checked" BOOLEAN NOT NULL DEFAULT false,
    "tds_checked" BOOLEAN NOT NULL DEFAULT false,
    "checked_by" UUID NOT NULL,
    "checked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounting_checks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "accounting_checks_packageId_key" ON "accounting_checks"("packageId");

-- AddForeignKey
ALTER TABLE "accounting_checks" ADD CONSTRAINT "accounting_checks_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "DocumentPackage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_checks" ADD CONSTRAINT "accounting_checks_checked_by_fkey" FOREIGN KEY ("checked_by") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
