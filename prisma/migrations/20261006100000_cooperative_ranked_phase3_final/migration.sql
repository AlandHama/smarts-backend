ALTER TABLE "CooperativeConfiguration"
  ADD COLUMN "cooperativePartyEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "cooperativeRandomEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "cooperativeBotFillEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "cooperativeRankedEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "cooperativeVoiceEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "cooperativeRewardsEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "rankedStakeAmountGld" DECIMAL(20,6) NOT NULL DEFAULT 2,
  ADD COLUMN "rankedPayoutPercent" INTEGER NOT NULL DEFAULT 90,
  ADD COLUMN "rankedEloBaseDelta" INTEGER NOT NULL DEFAULT 25,
  ADD COLUMN "rankedEloMaxDelta" INTEGER NOT NULL DEFAULT 50,
  ADD COLUMN "rankedTeamRatingWeightPercent" INTEGER NOT NULL DEFAULT 50,
  ADD COLUMN "rankedPartyRatingSpread" INTEGER NOT NULL DEFAULT 500,
  ADD COLUMN "rankedBotFillEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "rewardsEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "hardeningAlertsEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "settlementRetryLimit" INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN "botAccuracyPercent" INTEGER NOT NULL DEFAULT 65,
  ADD COLUMN "botPaceMultiplier" DECIMAL(8,4) NOT NULL DEFAULT 1;

ALTER TABLE "CooperativeMatch"
  ADD COLUMN "policyVersion" VARCHAR(64) NOT NULL DEFAULT 'cooperative.v2',
  ADD COLUMN "rankingPolicyVersion" VARCHAR(64),
  ADD COLUMN "entryFeeGld" DECIMAL(20,6) NOT NULL DEFAULT 0,
  ADD COLUMN "stakeAmountGld" DECIMAL(20,6) NOT NULL DEFAULT 0,
  ADD COLUMN "payoutAmountGld" DECIMAL(20,6) NOT NULL DEFAULT 0,
  ADD COLUMN "commitmentAt" TIMESTAMP(3),
  ADD COLUMN "settledAt" TIMESTAMP(3);

ALTER TABLE "CooperativeParticipant"
  ADD COLUMN "confirmedAt" TIMESTAMP(3),
  ADD COLUMN "abandonmentPenaltyApplied" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "CooperativeLedgerOperation" (
  "id" UUID NOT NULL,
  "cooperativeMatchId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "operationType" VARCHAR(32) NOT NULL,
  "amount" DECIMAL(20,6) NOT NULL,
  "currencyCode" VARCHAR(16) NOT NULL DEFAULT 'GLD',
  "walletTransactionId" UUID,
  "idempotencyKey" VARCHAR(180) NOT NULL,
  "status" VARCHAR(24) NOT NULL DEFAULT 'PENDING',
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CooperativeLedgerOperation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CooperativeLedgerOperation_idempotencyKey_key" UNIQUE ("idempotencyKey"),
  CONSTRAINT "CooperativeLedgerOperation_cooperativeMatchId_userId_operationType_key" UNIQUE ("cooperativeMatchId", "userId", "operationType"),
  CONSTRAINT "CooperativeLedgerOperation_cooperativeMatchId_fkey" FOREIGN KEY ("cooperativeMatchId") REFERENCES "CooperativeMatch"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CooperativeLedgerOperation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "CooperativeLedgerOperation_userId_createdAt_idx" ON "CooperativeLedgerOperation"("userId", "createdAt");
CREATE INDEX "CooperativeLedgerOperation_cooperativeMatchId_status_idx" ON "CooperativeLedgerOperation"("cooperativeMatchId", "status");

CREATE TABLE "CooperativeSettlementAttempt" (
  "id" UUID NOT NULL,
  "cooperativeMatchId" UUID NOT NULL,
  "attempt" INTEGER NOT NULL,
  "status" VARCHAR(24) NOT NULL DEFAULT 'PENDING',
  "error" VARCHAR(1000),
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "CooperativeSettlementAttempt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CooperativeSettlementAttempt_cooperativeMatchId_attempt_key" UNIQUE ("cooperativeMatchId", "attempt"),
  CONSTRAINT "CooperativeSettlementAttempt_cooperativeMatchId_fkey" FOREIGN KEY ("cooperativeMatchId") REFERENCES "CooperativeMatch"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "CooperativeSettlementAttempt_status_nextAttemptAt_idx" ON "CooperativeSettlementAttempt"("status", "nextAttemptAt");
