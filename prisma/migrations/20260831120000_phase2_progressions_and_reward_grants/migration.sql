CREATE TYPE "ProgressionKind" AS ENUM ('LEVEL', 'RATING', 'BATTLE_PASS', 'SKILL', 'OTHER');
CREATE TYPE "ProgressionResetPolicy" AS ENUM ('NEVER', 'SEASON', 'MANUAL');
CREATE TYPE "ProgressionRewardType" AS ENUM ('PROGRESSION_POINTS', 'PROGRESSION_RESET', 'CURRENCY', 'ASSET', 'ENTITLEMENT');
CREATE TYPE "ProgressionEventSourceType" AS ENUM ('MATCH', 'AD', 'PURCHASE', 'ADMIN', 'SYSTEM');
CREATE TYPE "RewardGrantStatus" AS ENUM ('GRANTED', 'PENDING', 'REJECTED');
CREATE TYPE "WalletTransactionDirection" AS ENUM ('CREDIT', 'DEBIT', 'REVERSAL');
CREATE TYPE "WalletTransactionSourceType" AS ENUM ('SIGNUP', 'MATCH', 'AD', 'PURCHASE', 'REFUND', 'ADMIN', 'SYSTEM');
CREATE TYPE "IdempotencyStatus" AS ENUM ('PROCESSING', 'COMPLETED', 'FAILED');

CREATE TABLE "IdempotencyKey" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID,
    "scope" VARCHAR(100) NOT NULL,
    "key" VARCHAR(128) NOT NULL,
    "requestHash" CHAR(64) NOT NULL,
    "responseJson" JSONB,
    "status" "IdempotencyStatus" NOT NULL DEFAULT 'PROCESSING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProgressionDefinition" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "key" VARCHAR(64) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "kind" "ProgressionKind" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "allowNegative" BOOLEAN NOT NULL DEFAULT false,
    "resetPolicy" "ProgressionResetPolicy" NOT NULL DEFAULT 'NEVER',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProgressionDefinition_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProgressionTier" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "progressionId" UUID NOT NULL,
    "step" INTEGER NOT NULL,
    "pointsThreshold" BIGINT NOT NULL,
    "name" VARCHAR(100),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProgressionTier_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProgressionTierReward" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tierId" UUID NOT NULL,
    "rewardType" "ProgressionRewardType" NOT NULL,
    "targetProgressionId" UUID,
    "currencyId" UUID,
    "targetKey" VARCHAR(120),
    "amount" BIGINT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProgressionTierReward_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlayerProgression" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "progressionId" UUID NOT NULL,
    "points" BIGINT NOT NULL DEFAULT 0,
    "step" INTEGER NOT NULL DEFAULT 1,
    "previousThreshold" BIGINT NOT NULL DEFAULT 0,
    "nextThreshold" BIGINT,
    "lastLevelUpAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PlayerProgression_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProgressionEvent" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "progressionId" UUID NOT NULL,
    "playerRowId" UUID NOT NULL,
    "delta" BIGINT NOT NULL,
    "balanceBefore" BIGINT NOT NULL,
    "balanceAfter" BIGINT NOT NULL,
    "sourceType" "ProgressionEventSourceType" NOT NULL,
    "sourceId" VARCHAR(255) NOT NULL,
    "idempotencyKeyId" UUID,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProgressionEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RewardGrant" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "sourceType" "WalletTransactionSourceType" NOT NULL,
    "sourceId" VARCHAR(255) NOT NULL,
    "rewardType" "ProgressionRewardType" NOT NULL,
    "grantKey" VARCHAR(255) NOT NULL,
    "progressionDefinitionId" UUID,
    "currencyId" UUID,
    "amount" BIGINT,
    "targetKey" VARCHAR(120),
    "status" "RewardGrantStatus" NOT NULL DEFAULT 'GRANTED',
    "policyVersion" VARCHAR(32),
    "idempotencyKeyId" UUID,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RewardGrant_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WalletTransaction" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "walletId" UUID NOT NULL,
    "currencyId" UUID NOT NULL,
    "direction" "WalletTransactionDirection" NOT NULL,
    "amount" BIGINT NOT NULL,
    "balanceBefore" BIGINT NOT NULL,
    "balanceAfter" BIGINT NOT NULL,
    "sourceType" "WalletTransactionSourceType" NOT NULL,
    "sourceId" VARCHAR(255) NOT NULL,
    "grantKey" VARCHAR(255),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WalletTransaction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IdempotencyKey_scope_key_key" ON "IdempotencyKey"("scope", "key");
CREATE INDEX "IdempotencyKey_userId_scope_idx" ON "IdempotencyKey"("userId", "scope");
CREATE UNIQUE INDEX "ProgressionDefinition_key_key" ON "ProgressionDefinition"("key");
CREATE UNIQUE INDEX "ProgressionTier_progressionId_step_key" ON "ProgressionTier"("progressionId", "step");
CREATE UNIQUE INDEX "ProgressionTier_progressionId_pointsThreshold_key" ON "ProgressionTier"("progressionId", "pointsThreshold");
CREATE INDEX "ProgressionTier_progressionId_pointsThreshold_idx" ON "ProgressionTier"("progressionId", "pointsThreshold");
CREATE INDEX "ProgressionTierReward_tierId_sortOrder_idx" ON "ProgressionTierReward"("tierId", "sortOrder");
CREATE INDEX "ProgressionTierReward_targetProgressionId_idx" ON "ProgressionTierReward"("targetProgressionId");
CREATE UNIQUE INDEX "PlayerProgression_userId_progressionId_key" ON "PlayerProgression"("userId", "progressionId");
CREATE INDEX "PlayerProgression_progressionId_points_idx" ON "PlayerProgression"("progressionId", "points");
CREATE INDEX "ProgressionEvent_userId_progressionId_createdAt_idx" ON "ProgressionEvent"("userId", "progressionId", "createdAt");
CREATE INDEX "ProgressionEvent_sourceType_sourceId_idx" ON "ProgressionEvent"("sourceType", "sourceId");
CREATE INDEX "ProgressionEvent_idempotencyKeyId_idx" ON "ProgressionEvent"("idempotencyKeyId");
CREATE UNIQUE INDEX "RewardGrant_grantKey_key" ON "RewardGrant"("grantKey");
CREATE INDEX "RewardGrant_userId_createdAt_idx" ON "RewardGrant"("userId", "createdAt");
CREATE INDEX "RewardGrant_sourceType_sourceId_idx" ON "RewardGrant"("sourceType", "sourceId");
CREATE UNIQUE INDEX "WalletTransaction_grantKey_key" ON "WalletTransaction"("grantKey");
CREATE INDEX "WalletTransaction_walletId_currencyId_createdAt_idx" ON "WalletTransaction"("walletId", "currencyId", "createdAt");
CREATE INDEX "WalletTransaction_sourceType_sourceId_idx" ON "WalletTransaction"("sourceType", "sourceId");

ALTER TABLE "IdempotencyKey" ADD CONSTRAINT "IdempotencyKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProgressionTier" ADD CONSTRAINT "ProgressionTier_progressionId_fkey" FOREIGN KEY ("progressionId") REFERENCES "ProgressionDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProgressionTierReward" ADD CONSTRAINT "ProgressionTierReward_tierId_fkey" FOREIGN KEY ("tierId") REFERENCES "ProgressionTier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProgressionTierReward" ADD CONSTRAINT "ProgressionTierReward_targetProgressionId_fkey" FOREIGN KEY ("targetProgressionId") REFERENCES "ProgressionDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProgressionTierReward" ADD CONSTRAINT "ProgressionTierReward_currencyId_fkey" FOREIGN KEY ("currencyId") REFERENCES "CurrencyDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlayerProgression" ADD CONSTRAINT "PlayerProgression_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlayerProgression" ADD CONSTRAINT "PlayerProgression_progressionId_fkey" FOREIGN KEY ("progressionId") REFERENCES "ProgressionDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProgressionEvent" ADD CONSTRAINT "ProgressionEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProgressionEvent" ADD CONSTRAINT "ProgressionEvent_progressionId_fkey" FOREIGN KEY ("progressionId") REFERENCES "ProgressionDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProgressionEvent" ADD CONSTRAINT "ProgressionEvent_playerRowId_fkey" FOREIGN KEY ("playerRowId") REFERENCES "PlayerProgression"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RewardGrant" ADD CONSTRAINT "RewardGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RewardGrant" ADD CONSTRAINT "RewardGrant_progressionDefinitionId_fkey" FOREIGN KEY ("progressionDefinitionId") REFERENCES "ProgressionDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RewardGrant" ADD CONSTRAINT "RewardGrant_currencyId_fkey" FOREIGN KEY ("currencyId") REFERENCES "CurrencyDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_currencyId_fkey" FOREIGN KEY ("currencyId") REFERENCES "CurrencyDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "ProgressionDefinition" ("key", "name", "kind", "active", "allowNegative", "resetPolicy", "updatedAt")
VALUES ('main', 'Main Level', 'LEVEL', true, false, 'NEVER', CURRENT_TIMESTAMP),
       ('elo', 'Rank Rating', 'RATING', true, true, 'MANUAL', CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "ProgressionTier" ("progressionId", "step", "pointsThreshold", "name", "updatedAt")
SELECT id, 1, 0, CASE WHEN "key" = 'main' THEN 'Beginner' ELSE 'Unranked' END, CURRENT_TIMESTAMP
FROM "ProgressionDefinition"
WHERE "key" IN ('main', 'elo')
  AND NOT EXISTS (SELECT 1 FROM "ProgressionTier" tier WHERE tier."progressionId" = "ProgressionDefinition"."id");

