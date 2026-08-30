-- Phase 4: server-owned player/country leaderboards with UTC seasons.
-- The installation is greenfield: only definitions and current empty seasons
-- are seeded; no player entries or historical scores are imported.
CREATE TYPE "LeaderboardMemberType" AS ENUM ('PLAYER', 'COUNTRY', 'GENERIC');
CREATE TYPE "LeaderboardPeriod" AS ENUM ('ALL_TIME', 'WEEKLY', 'MONTHLY', 'SEASONAL');
CREATE TYPE "LeaderboardDirection" AS ENUM ('DESCENDING', 'ASCENDING');
CREATE TYPE "LeaderboardWritePolicy" AS ENUM ('SERVER_ONLY', 'AUTHENTICATED_COMMAND');
CREATE TYPE "LeaderboardSeasonStatus" AS ENUM ('SCHEDULED', 'ACTIVE', 'CLOSED');
CREATE TYPE "LeaderboardScoreSourceType" AS ENUM ('MATCH', 'ADMIN', 'SYSTEM');

CREATE TABLE "Leaderboard" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "key" VARCHAR(80) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "memberType" "LeaderboardMemberType" NOT NULL,
    "period" "LeaderboardPeriod" NOT NULL,
    "direction" "LeaderboardDirection" NOT NULL DEFAULT 'DESCENDING',
    "writePolicy" "LeaderboardWritePolicy" NOT NULL DEFAULT 'SERVER_ONLY',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Leaderboard_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LeaderboardSeason" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "leaderboardId" UUID NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" "LeaderboardSeasonStatus" NOT NULL DEFAULT 'SCHEDULED',
    "resetAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LeaderboardSeason_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LeaderboardEntry" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "leaderboardId" UUID NOT NULL,
    "seasonId" UUID NOT NULL,
    "playerId" UUID,
    "memberKey" VARCHAR(128) NOT NULL,
    "score" BIGINT NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LeaderboardEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LeaderboardScoreEvent" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "entryId" UUID,
    "leaderboardId" UUID NOT NULL,
    "seasonId" UUID NOT NULL,
    "memberKey" VARCHAR(128) NOT NULL,
    "playerId" UUID,
    "delta" BIGINT NOT NULL,
    "scoreBefore" BIGINT NOT NULL,
    "scoreAfter" BIGINT NOT NULL,
    "sourceType" "LeaderboardScoreSourceType" NOT NULL,
    "sourceId" VARCHAR(255) NOT NULL,
    "idempotencyKeyId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LeaderboardScoreEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Leaderboard_key_key" ON "Leaderboard"("key");
CREATE UNIQUE INDEX "LeaderboardSeason_leaderboardId_startsAt_key" ON "LeaderboardSeason"("leaderboardId", "startsAt");
CREATE INDEX "LeaderboardSeason_leaderboardId_status_startsAt_endsAt_idx" ON "LeaderboardSeason"("leaderboardId", "status", "startsAt", "endsAt");
CREATE UNIQUE INDEX "LeaderboardEntry_leaderboardId_seasonId_memberKey_key" ON "LeaderboardEntry"("leaderboardId", "seasonId", "memberKey");
CREATE INDEX "LeaderboardEntry_leaderboardId_seasonId_score_idx" ON "LeaderboardEntry"("leaderboardId", "seasonId", "score");
CREATE INDEX "LeaderboardEntry_playerId_idx" ON "LeaderboardEntry"("playerId");
CREATE UNIQUE INDEX "LeaderboardScoreEvent_entryId_sourceType_sourceId_key" ON "LeaderboardScoreEvent"("entryId", "sourceType", "sourceId");
CREATE INDEX "LeaderboardScoreEvent_entryId_createdAt_idx" ON "LeaderboardScoreEvent"("entryId", "createdAt");
CREATE INDEX "LeaderboardScoreEvent_sourceType_sourceId_idx" ON "LeaderboardScoreEvent"("sourceType", "sourceId");
CREATE INDEX "LeaderboardScoreEvent_idempotencyKeyId_idx" ON "LeaderboardScoreEvent"("idempotencyKeyId");

ALTER TABLE "LeaderboardSeason" ADD CONSTRAINT "LeaderboardSeason_leaderboardId_fkey" FOREIGN KEY ("leaderboardId") REFERENCES "Leaderboard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeaderboardEntry" ADD CONSTRAINT "LeaderboardEntry_leaderboardId_fkey" FOREIGN KEY ("leaderboardId") REFERENCES "Leaderboard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeaderboardEntry" ADD CONSTRAINT "LeaderboardEntry_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "LeaderboardSeason"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeaderboardEntry" ADD CONSTRAINT "LeaderboardEntry_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeaderboardScoreEvent" ADD CONSTRAINT "LeaderboardScoreEvent_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "LeaderboardEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LeaderboardScoreEvent" ADD CONSTRAINT "LeaderboardScoreEvent_leaderboardId_fkey" FOREIGN KEY ("leaderboardId") REFERENCES "Leaderboard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeaderboardScoreEvent" ADD CONSTRAINT "LeaderboardScoreEvent_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "LeaderboardSeason"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeaderboardScoreEvent" ADD CONSTRAINT "LeaderboardScoreEvent_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "Leaderboard" ("key", "name", "memberType", "period", "direction", "writePolicy", "active", "updatedAt") VALUES
  ('countryweekly', 'Countries · Weekly', 'COUNTRY', 'WEEKLY', 'DESCENDING', 'SERVER_ONLY', true, CURRENT_TIMESTAMP),
  ('countrymonthly', 'Countries · Monthly', 'COUNTRY', 'MONTHLY', 'DESCENDING', 'SERVER_ONLY', true, CURRENT_TIMESTAMP),
  ('players_weekly', 'Players · Weekly', 'PLAYER', 'WEEKLY', 'DESCENDING', 'SERVER_ONLY', true, CURRENT_TIMESTAMP),
  ('players_monthly', 'Players · Monthly', 'PLAYER', 'MONTHLY', 'DESCENDING', 'SERVER_ONLY', true, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "LeaderboardSeason" ("leaderboardId", "startsAt", "endsAt", "status")
SELECT id, date_trunc('week', CURRENT_TIMESTAMP AT TIME ZONE 'UTC') AT TIME ZONE 'UTC', (date_trunc('week', CURRENT_TIMESTAMP AT TIME ZONE 'UTC') + INTERVAL '7 days') AT TIME ZONE 'UTC', 'ACTIVE'
FROM "Leaderboard" WHERE "period" = 'WEEKLY'
ON CONFLICT ("leaderboardId", "startsAt") DO NOTHING;

INSERT INTO "LeaderboardSeason" ("leaderboardId", "startsAt", "endsAt", "status")
SELECT id, date_trunc('month', CURRENT_TIMESTAMP AT TIME ZONE 'UTC') AT TIME ZONE 'UTC', (date_trunc('month', CURRENT_TIMESTAMP AT TIME ZONE 'UTC') + INTERVAL '1 month') AT TIME ZONE 'UTC', 'ACTIVE'
FROM "Leaderboard" WHERE "period" = 'MONTHLY'
ON CONFLICT ("leaderboardId", "startsAt") DO NOTHING;
