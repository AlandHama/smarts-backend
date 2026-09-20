ALTER TYPE "WalletTransactionSourceType" ADD VALUE IF NOT EXISTS 'RANKING_MATCH_ENTRY';
ALTER TYPE "WalletTransactionSourceType" ADD VALUE IF NOT EXISTS 'RANKING_MATCH_PAYOUT';
ALTER TYPE "WalletTransactionSourceType" ADD VALUE IF NOT EXISTS 'RANKING_MATCH_REFUND';

CREATE TYPE "RankingMatchStatus" AS ENUM ('QUEUED', 'ACTIVE', 'SETTLED', 'REFUNDED', 'CANCELLED');

CREATE TABLE "RankingMatchConfig" (
    "id" UUID NOT NULL,
    "key" VARCHAR(64) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "stakeAmountGld" BIGINT NOT NULL,
    "entryFeeGld" BIGINT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RankingMatchConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RankingMatchConfig_key_key" ON "RankingMatchConfig"("key");
CREATE INDEX "RankingMatchConfig_enabled_sortOrder_idx" ON "RankingMatchConfig"("enabled", "sortOrder");

CREATE TABLE "RankingMatch" (
    "id" UUID NOT NULL,
    "matchId" UUID NOT NULL,
    "configId" UUID NOT NULL,
    "stakeAmountGld" BIGINT NOT NULL,
    "entryFeeGld" BIGINT NOT NULL,
    "payoutAmountGld" BIGINT NOT NULL,
    "status" "RankingMatchStatus" NOT NULL DEFAULT 'ACTIVE',
    "winnerUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" TIMESTAMP(3),
    CONSTRAINT "RankingMatch_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RankingMatch_matchId_key" ON "RankingMatch"("matchId");
CREATE INDEX "RankingMatch_status_createdAt_idx" ON "RankingMatch"("status", "createdAt");
CREATE INDEX "RankingMatch_configId_createdAt_idx" ON "RankingMatch"("configId", "createdAt");
CREATE INDEX "RankingMatch_winnerUserId_settledAt_idx" ON "RankingMatch"("winnerUserId", "settledAt");

ALTER TABLE "RankingMatch"
  ADD CONSTRAINT "RankingMatch_matchId_fkey"
  FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "RankingMatch_configId_fkey"
  FOREIGN KEY ("configId") REFERENCES "RankingMatchConfig"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "RankingMatch_winnerUserId_fkey"
  FOREIGN KEY ("winnerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MatchmakingTicket"
  ADD COLUMN "rankingConfigId" UUID,
  ADD COLUMN "rankingStakeAmount" BIGINT,
  ADD COLUMN "rankingEntryFee" BIGINT,
  ADD COLUMN "rankingRefundedAt" TIMESTAMP(3);

CREATE INDEX "MatchmakingTicket_rankingConfigId_idx" ON "MatchmakingTicket"("rankingConfigId");
ALTER TABLE "MatchmakingTicket"
  ADD CONSTRAINT "MatchmakingTicket_rankingConfigId_fkey"
  FOREIGN KEY ("rankingConfigId") REFERENCES "RankingMatchConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed the initial public entry tiers. Values are GLD units, and the winner
-- receives the two-player pot minus both entry fees.
INSERT INTO "RankingMatchConfig" ("id", "key", "name", "stakeAmountGld", "entryFeeGld", "sortOrder", "updatedAt")
VALUES
  (gen_random_uuid(), 'ranked-5', '5 GLD Arena', 5, 1, 10, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'ranked-10', '10 GLD Arena', 10, 2, 20, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'ranked-15', '15 GLD Arena', 15, 3, 30, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
