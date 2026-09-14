-- GLD-7: administrator-supplied reserve backing kept separate from AdMob revenue.
CREATE TABLE "GldManualBacking" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "amountUsdMicros" BIGINT NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "idempotencyKey" VARCHAR(160) NOT NULL,
  "createdById" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GldManualBacking_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GldManualBacking_idempotencyKey_key" ON "GldManualBacking"("idempotencyKey");

ALTER TABLE "GldTreasuryEntry" ALTER COLUMN "revenueSnapshotId" DROP NOT NULL;
ALTER TABLE "GldTreasuryEntry" ADD COLUMN "manualBackingId" UUID;

CREATE UNIQUE INDEX "GldTreasuryEntry_manualBackingId_key" ON "GldTreasuryEntry"("manualBackingId");
CREATE INDEX "GldManualBacking_createdAt_idx" ON "GldManualBacking"("createdAt");
CREATE INDEX "GldManualBacking_createdById_createdAt_idx" ON "GldManualBacking"("createdById", "createdAt");

ALTER TABLE "GldManualBacking" ADD CONSTRAINT "GldManualBacking_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GldTreasuryEntry" ADD CONSTRAINT "GldTreasuryEntry_manualBackingId_fkey"
  FOREIGN KEY ("manualBackingId") REFERENCES "GldManualBacking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
