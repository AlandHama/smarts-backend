CREATE TABLE "Ally" (
  "id" UUID NOT NULL,
  "name" VARCHAR(80) NOT NULL,
  "tag" VARCHAR(12) NOT NULL,
  "description" VARCHAR(240),
  "emblemKey" VARCHAR(32) NOT NULL DEFAULT 'spark',
  "ownerId" UUID NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Ally_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AllyMember" (
  "id" UUID NOT NULL,
  "allyId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "role" VARCHAR(16) NOT NULL DEFAULT 'MEMBER',
  "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AllyMember_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AllyScoreEvent" (
  "id" UUID NOT NULL,
  "allyId" UUID NOT NULL,
  "seasonId" UUID NOT NULL,
  "matchId" UUID NOT NULL,
  "points" INTEGER NOT NULL,
  "mode" VARCHAR(16) NOT NULL,
  "reason" VARCHAR(64) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AllyScoreEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AllyRewardPayout" (
  "id" UUID NOT NULL,
  "allyId" UUID NOT NULL,
  "seasonId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "rank" INTEGER NOT NULL,
  "amount" BIGINT NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'GRANTED',
  "grantKey" VARCHAR(180) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AllyRewardPayout_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Ally_name_key" ON "Ally"("name");
CREATE UNIQUE INDEX "Ally_tag_key" ON "Ally"("tag");
CREATE INDEX "Ally_ownerId_status_idx" ON "Ally"("ownerId", "status");
CREATE INDEX "Ally_status_createdAt_idx" ON "Ally"("status", "createdAt");
CREATE UNIQUE INDEX "AllyMember_userId_key" ON "AllyMember"("userId");
CREATE INDEX "AllyMember_allyId_joinedAt_idx" ON "AllyMember"("allyId", "joinedAt");
CREATE UNIQUE INDEX "AllyScoreEvent_allyId_seasonId_matchId_key" ON "AllyScoreEvent"("allyId", "seasonId", "matchId");
CREATE INDEX "AllyScoreEvent_seasonId_points_idx" ON "AllyScoreEvent"("seasonId", "points");
CREATE INDEX "AllyScoreEvent_matchId_idx" ON "AllyScoreEvent"("matchId");
CREATE UNIQUE INDEX "AllyRewardPayout_grantKey_key" ON "AllyRewardPayout"("grantKey");
CREATE UNIQUE INDEX "AllyRewardPayout_allyId_seasonId_userId_key" ON "AllyRewardPayout"("allyId", "seasonId", "userId");
CREATE INDEX "AllyRewardPayout_seasonId_rank_idx" ON "AllyRewardPayout"("seasonId", "rank");

ALTER TABLE "Ally" ADD CONSTRAINT "Ally_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AllyMember" ADD CONSTRAINT "AllyMember_allyId_fkey" FOREIGN KEY ("allyId") REFERENCES "Ally"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AllyMember" ADD CONSTRAINT "AllyMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AllyScoreEvent" ADD CONSTRAINT "AllyScoreEvent_allyId_fkey" FOREIGN KEY ("allyId") REFERENCES "Ally"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AllyScoreEvent" ADD CONSTRAINT "AllyScoreEvent_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "LeaderboardSeason"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AllyScoreEvent" ADD CONSTRAINT "AllyScoreEvent_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AllyRewardPayout" ADD CONSTRAINT "AllyRewardPayout_allyId_fkey" FOREIGN KEY ("allyId") REFERENCES "Ally"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AllyRewardPayout" ADD CONSTRAINT "AllyRewardPayout_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "LeaderboardSeason"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AllyRewardPayout" ADD CONSTRAINT "AllyRewardPayout_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CooperativeConfiguration"
  ADD COLUMN "allyRankingEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "allyRewardsEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "allyRewardCurrencyCode" VARCHAR(32) NOT NULL DEFAULT 'GLD',
  ADD COLUMN "allyFirstRewardGld" INTEGER NOT NULL DEFAULT 500,
  ADD COLUMN "allySecondRewardGld" INTEGER NOT NULL DEFAULT 300,
  ADD COLUMN "allyThirdRewardGld" INTEGER NOT NULL DEFAULT 200,
  ADD COLUMN "allyMinimumQualifyingMatches" INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN "allyRankedWinPoints" INTEGER NOT NULL DEFAULT 12,
  ADD COLUMN "allyRankedDrawPoints" INTEGER NOT NULL DEFAULT 7,
  ADD COLUMN "allyRankedLossPoints" INTEGER NOT NULL DEFAULT 4,
  ADD COLUMN "allyCasualWinPoints" INTEGER NOT NULL DEFAULT 6,
  ADD COLUMN "allyCasualDrawPoints" INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN "allyCasualLossPoints" INTEGER NOT NULL DEFAULT 2;
