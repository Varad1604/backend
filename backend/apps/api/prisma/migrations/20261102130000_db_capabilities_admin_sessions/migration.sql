-- Backend brief Milestone 1: database-backed capabilities and account/session state.
ALTER TABLE "User"
  ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "synthetic" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "failedLogins" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lockedUntil" TIMESTAMP(3);

ALTER TABLE "Session" ADD COLUMN "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE "Capability" (
  "id" SERIAL NOT NULL,
  "code" TEXT NOT NULL,
  "description" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Capability_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RoleCapability" (
  "roleId" INTEGER NOT NULL,
  "capabilityId" INTEGER NOT NULL,
  CONSTRAINT "RoleCapability_pkey" PRIMARY KEY ("roleId", "capabilityId")
);

CREATE UNIQUE INDEX "Capability_code_key" ON "Capability"("code");
CREATE INDEX "RoleCapability_capabilityId_idx" ON "RoleCapability"("capabilityId");
ALTER TABLE "RoleCapability" ADD CONSTRAINT "RoleCapability_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RoleCapability" ADD CONSTRAINT "RoleCapability_capabilityId_fkey" FOREIGN KEY ("capabilityId") REFERENCES "Capability"("id") ON DELETE CASCADE ON UPDATE CASCADE;
