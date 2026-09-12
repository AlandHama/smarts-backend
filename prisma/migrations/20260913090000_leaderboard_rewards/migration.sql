-- Leaderboard reward schedules are server-owned and intentionally separate
-- from score history so administrators can edit future payouts safely.
CREATE TABLE "LeaderboardReward" (
    "id" UUID NOT NULL,
    "leaderboardId" UUID NOT NULL,
    "rank" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "rewardType" "ProgressionRewardType" NOT NULL,
    "currencyId" UUID,
    "assetDefinitionId" UUID,
    "assetVariationId" UUID,
    "progressionDefinitionId" UUID,
    "amount" BIGINT,
    "targetKey" VARCHAR(160),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LeaderboardReward_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LeaderboardReward_leaderboardId_rank_sortOrder_key"
    ON "LeaderboardReward"("leaderboardId", "rank", "sortOrder");
CREATE INDEX "LeaderboardReward_leaderboardId_rank_idx"
    ON "LeaderboardReward"("leaderboardId", "rank");

ALTER TABLE "LeaderboardReward"
    ADD CONSTRAINT "LeaderboardReward_leaderboardId_fkey"
    FOREIGN KEY ("leaderboardId") REFERENCES "Leaderboard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeaderboardReward"
    ADD CONSTRAINT "LeaderboardReward_currencyId_fkey"
    FOREIGN KEY ("currencyId") REFERENCES "CurrencyDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LeaderboardReward"
    ADD CONSTRAINT "LeaderboardReward_assetDefinitionId_fkey"
    FOREIGN KEY ("assetDefinitionId") REFERENCES "AssetDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LeaderboardReward"
    ADD CONSTRAINT "LeaderboardReward_assetVariationId_fkey"
    FOREIGN KEY ("assetVariationId") REFERENCES "AssetVariation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LeaderboardReward"
    ADD CONSTRAINT "LeaderboardReward_progressionDefinitionId_fkey"
    FOREIGN KEY ("progressionDefinitionId") REFERENCES "ProgressionDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
