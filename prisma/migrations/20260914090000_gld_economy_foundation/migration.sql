-- GLD-1: database foundation for the server-owned GLD economy.

CREATE TYPE "GldEconomyHealth" AS ENUM ('VERY_HEALTHY', 'HEALTHY', 'CAUTION', 'RESTRICTED', 'CRITICAL');
CREATE TYPE "GldRevenueRecognitionStatus" AS ENUM ('PENDING', 'RECOGNIZED', 'RESTATED', 'REJECTED');
CREATE TYPE "GldTreasuryEntryType" AS ENUM ('REWARD_BACKING', 'RESERVE', 'COMPANY', 'COST', 'ADJUSTMENT');

CREATE TABLE "GldEconomyState" (
  "id" UUID NOT NULL,
  "currencyId" UUID NOT NULL,
  "displayedValueUsdMicros" BIGINT NOT NULL,
  "targetValueUsdMicros" BIGINT NOT NULL,
  "treasuryReserveUsdMicros" BIGINT NOT NULL,
  "circulatingSupply" BIGINT NOT NULL,
  "reserveRatioBps" INTEGER NOT NULL,
  "smoothingFactorBps" INTEGER NOT NULL,
  "minPriceUsdMicros" BIGINT,
  "maxPriceUsdMicros" BIGINT,
  "dailyEmissionBudget" BIGINT NOT NULL,
  "dailyEmissionUsed" BIGINT NOT NULL,
  "lastRevenueSnapshotAt" TIMESTAMP(3),
  "lastRecalculatedAt" TIMESTAMP(3),
  "health" "GldEconomyHealth" NOT NULL DEFAULT 'CRITICAL',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GldEconomyState_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GldRevenueSnapshot" (
  "id" UUID NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "grossAdRevenueUsdMicros" BIGINT NOT NULL,
  "adCostsUsdMicros" BIGINT NOT NULL,
  "eligibleProfitUsdMicros" BIGINT NOT NULL,
  "playerRewardAllocationBps" INTEGER NOT NULL,
  "reserveAllocationBps" INTEGER NOT NULL,
  "companyAllocationBps" INTEGER NOT NULL,
  "rewardBackingUsdMicros" BIGINT NOT NULL,
  "reserveAddedUsdMicros" BIGINT NOT NULL,
  "companyShareUsdMicros" BIGINT NOT NULL,
  "source" VARCHAR(80) NOT NULL,
  "sourceReference" VARCHAR(255),
  "recognitionStatus" "GldRevenueRecognitionStatus" NOT NULL DEFAULT 'PENDING',
  "recognitionHaircutBps" INTEGER NOT NULL DEFAULT 8000,
  "metadata" JSONB,
  "createdById" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GldRevenueSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GldEconomySnapshot" (
  "id" UUID NOT NULL,
  "displayedValueUsdMicros" BIGINT NOT NULL,
  "targetValueUsdMicros" BIGINT NOT NULL,
  "treasuryReserveUsdMicros" BIGINT NOT NULL,
  "circulatingSupply" BIGINT NOT NULL,
  "reserveRatioBps" INTEGER NOT NULL,
  "dailyEmissionBudget" BIGINT NOT NULL,
  "dailyEmissionUsed" BIGINT NOT NULL,
  "reason" VARCHAR(120) NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GldEconomySnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GldEmissionDay" (
  "id" UUID NOT NULL,
  "dateKey" CHAR(10) NOT NULL,
  "emissionBudget" BIGINT NOT NULL,
  "emittedAmount" BIGINT NOT NULL DEFAULT 0,
  "burnedAmount" BIGINT NOT NULL DEFAULT 0,
  "adRewardAmount" BIGINT NOT NULL DEFAULT 0,
  "gameplayRewardAmount" BIGINT NOT NULL DEFAULT 0,
  "promotionalAmount" BIGINT NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GldEmissionDay_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GldBurnEvent" (
  "id" UUID NOT NULL,
  "userId" UUID,
  "amount" BIGINT NOT NULL,
  "sourceType" VARCHAR(60) NOT NULL,
  "sourceId" VARCHAR(255),
  "reason" VARCHAR(255) NOT NULL,
  "ledgerEntryId" UUID,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GldBurnEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GldPlayerDailyAdState" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "dateKey" CHAR(10) NOT NULL,
  "validatedAds" INTEGER NOT NULL DEFAULT 0,
  "rewardedAds" INTEGER NOT NULL DEFAULT 0,
  "gldEarned" BIGINT NOT NULL DEFAULT 0,
  "rewardValueUsdMicros" BIGINT NOT NULL DEFAULT 0,
  "lastRewardedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GldPlayerDailyAdState_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GldTreasuryEntry" (
  "id" UUID NOT NULL,
  "revenueSnapshotId" UUID NOT NULL,
  "entryType" "GldTreasuryEntryType" NOT NULL,
  "amountUsdMicros" BIGINT NOT NULL,
  "currencyCode" CHAR(3) NOT NULL DEFAULT 'USD',
  "idempotencyKey" VARCHAR(160) NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GldTreasuryEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlayerGift" (
  "id" UUID NOT NULL,
  "senderUserId" UUID NOT NULL,
  "recipientUserId" UUID NOT NULL,
  "catalogItemId" UUID NOT NULL,
  "gldPrice" BIGINT NOT NULL,
  "burnedAmount" BIGINT NOT NULL,
  "retainedAmount" BIGINT NOT NULL,
  "idempotencyKeyId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlayerGift_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GldEconomyState_currencyId_key" ON "GldEconomyState"("currencyId");
CREATE INDEX "GldEconomyState_health_idx" ON "GldEconomyState"("health");
CREATE INDEX "GldEconomyState_lastRecalculatedAt_idx" ON "GldEconomyState"("lastRecalculatedAt");
CREATE UNIQUE INDEX "GldRevenueSnapshot_source_periodStart_periodEnd_key" ON "GldRevenueSnapshot"("source", "periodStart", "periodEnd");
CREATE INDEX "GldRevenueSnapshot_periodStart_periodEnd_idx" ON "GldRevenueSnapshot"("periodStart", "periodEnd");
CREATE INDEX "GldRevenueSnapshot_recognitionStatus_periodEnd_idx" ON "GldRevenueSnapshot"("recognitionStatus", "periodEnd");
CREATE INDEX "GldEconomySnapshot_createdAt_idx" ON "GldEconomySnapshot"("createdAt");
CREATE UNIQUE INDEX "GldEmissionDay_dateKey_key" ON "GldEmissionDay"("dateKey");
CREATE INDEX "GldBurnEvent_userId_createdAt_idx" ON "GldBurnEvent"("userId", "createdAt");
CREATE INDEX "GldBurnEvent_sourceType_sourceId_idx" ON "GldBurnEvent"("sourceType", "sourceId");
CREATE UNIQUE INDEX "GldPlayerDailyAdState_userId_dateKey_key" ON "GldPlayerDailyAdState"("userId", "dateKey");
CREATE INDEX "GldPlayerDailyAdState_dateKey_idx" ON "GldPlayerDailyAdState"("dateKey");
CREATE UNIQUE INDEX "GldTreasuryEntry_idempotencyKey_key" ON "GldTreasuryEntry"("idempotencyKey");
CREATE INDEX "GldTreasuryEntry_revenueSnapshotId_entryType_idx" ON "GldTreasuryEntry"("revenueSnapshotId", "entryType");
CREATE INDEX "GldTreasuryEntry_createdAt_idx" ON "GldTreasuryEntry"("createdAt");
CREATE UNIQUE INDEX "PlayerGift_idempotencyKeyId_key" ON "PlayerGift"("idempotencyKeyId");
CREATE INDEX "PlayerGift_senderUserId_createdAt_idx" ON "PlayerGift"("senderUserId", "createdAt");
CREATE INDEX "PlayerGift_recipientUserId_createdAt_idx" ON "PlayerGift"("recipientUserId", "createdAt");

ALTER TABLE "GldEconomyState" ADD CONSTRAINT "GldEconomyState_currencyId_fkey" FOREIGN KEY ("currencyId") REFERENCES "CurrencyDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GldRevenueSnapshot" ADD CONSTRAINT "GldRevenueSnapshot_period_check" CHECK ("periodEnd" > "periodStart");
ALTER TABLE "GldBurnEvent" ADD CONSTRAINT "GldBurnEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GldPlayerDailyAdState" ADD CONSTRAINT "GldPlayerDailyAdState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GldTreasuryEntry" ADD CONSTRAINT "GldTreasuryEntry_revenueSnapshotId_fkey" FOREIGN KEY ("revenueSnapshotId") REFERENCES "GldRevenueSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlayerGift" ADD CONSTRAINT "PlayerGift_senderUserId_fkey" FOREIGN KEY ("senderUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlayerGift" ADD CONSTRAINT "PlayerGift_recipientUserId_fkey" FOREIGN KEY ("recipientUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlayerGift" ADD CONSTRAINT "PlayerGift_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "CatalogItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlayerGift" ADD CONSTRAINT "PlayerGift_idempotencyKeyId_fkey" FOREIGN KEY ("idempotencyKeyId") REFERENCES "IdempotencyKey"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
