-- Phase 5: server-authoritative game matches, versioned reward configuration,
-- accepted event history, settlement proofs, stats projections, and outbox rows.
CREATE TYPE "GameMode" AS ENUM ('SINGLE_PLAYER', 'BOT', 'RANKED', 'CASUAL');
CREATE TYPE "MatchStatus" AS ENUM ('CREATED', 'STARTED', 'FINISHED', 'REVIEW', 'CANCELLED', 'SETTLED');
CREATE TYPE "MatchParticipantType" AS ENUM ('PLAYER', 'BOT');
CREATE TYPE "MatchParticipantResult" AS ENUM ('PENDING', 'WIN', 'LOSS', 'DRAW', 'COMPLETED', 'FORFEIT');
CREATE TYPE "MatchEventType" AS ENUM ('READY', 'HEARTBEAT', 'ANSWER', 'SCORE_UPDATE', 'FINISH', 'LEAVE', 'FORFEIT');
CREATE TYPE "OutboxEventStatus" AS ENUM ('PENDING', 'PROCESSING', 'PUBLISHED', 'FAILED');

CREATE TABLE "GameDefinition" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "key" VARCHAR(64) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "modePolicy" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GameDefinition_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GameConfig" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "gameDefinitionId" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "mainProgressionKey" VARCHAR(64) NOT NULL,
    "eloProgressionKey" VARCHAR(64) NOT NULL,
    "rewardCurrencyCode" VARCHAR(32) NOT NULL,
    "scoreMultiplierForXp" DECIMAL(20,8) NOT NULL,
    "maxEloDelta" INTEGER NOT NULL,
    "soloEloScoreDivisor" INTEGER NOT NULL,
    "soloEloMaxDelta" INTEGER NOT NULL,
    "winnerBaseReward" BIGINT NOT NULL,
    "loserBaseReward" BIGINT NOT NULL,
    "drawReward" BIGINT NOT NULL,
    "scoreRewardDivisor" INTEGER NOT NULL,
    "scoreRewardCap" BIGINT NOT NULL,
    "winnerRewardBonusMax" BIGINT NOT NULL,
    "loserRewardBonusMax" BIGINT NOT NULL,
    "multiplayerRewardReference" BIGINT NOT NULL,
    "correctAnswerPoints" JSONB NOT NULL,
    "wrongAnswerPenaltyPercent" INTEGER NOT NULL,
    "maxAnswerTimeSeconds" INTEGER NOT NULL,
    "maxMatchDurationSeconds" INTEGER NOT NULL,
    "maxQuestions" INTEGER NOT NULL,
    "rankingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "rankingEloMultiplier" DECIMAL(20,8) NOT NULL,
    "rankingLevelMultiplier" DECIMAL(20,8) NOT NULL,
    "rankingCoinMultiplier" DECIMAL(20,8) NOT NULL,
    "settings" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GameConfig_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Match" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "gameDefinitionId" UUID NOT NULL,
    "gameConfigId" UUID NOT NULL,
    "mode" "GameMode" NOT NULL,
    "status" "MatchStatus" NOT NULL DEFAULT 'CREATED',
    "serverNonce" VARCHAR(128) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "settledAt" TIMESTAMP(3),
    "createdByUserId" UUID NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Match_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MatchParticipant" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "matchId" UUID NOT NULL,
    "userId" UUID,
    "participantType" "MatchParticipantType" NOT NULL,
    "finalScore" INTEGER,
    "answeredCount" INTEGER NOT NULL DEFAULT 0,
    "result" "MatchParticipantResult" NOT NULL DEFAULT 'PENDING',
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MatchParticipant_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MatchEvent" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "matchId" UUID NOT NULL,
    "participantId" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "eventType" "MatchEventType" NOT NULL,
    "clientEventId" VARCHAR(128) NOT NULL,
    "payload" JSONB,
    "clientOccurredAt" TIMESTAMP(3),
    "serverReceivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accepted" BOOLEAN NOT NULL DEFAULT false,
    "rejectionReason" VARCHAR(160),
    CONSTRAINT "MatchEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MatchSettlement" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "matchId" UUID NOT NULL,
    "policyVersion" VARCHAR(32) NOT NULL,
    "winnerParticipantId" UUID,
    "settlementJson" JSONB NOT NULL,
    "idempotencyKeyId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MatchSettlement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GameContentItem" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "gameDefinitionId" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "contentType" VARCHAR(40) NOT NULL,
    "prompt" JSONB NOT NULL,
    "options" JSONB NOT NULL,
    "difficulty" INTEGER NOT NULL DEFAULT 1,
    "category" VARCHAR(80),
    "answerHash" CHAR(64) NOT NULL,
    "answerIndex" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GameContentItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MatchContentAssignment" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "matchId" UUID NOT NULL,
    "participantId" UUID NOT NULL,
    "contentItemId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "assignmentTokenHash" CHAR(64) NOT NULL,
    "servedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "answeredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MatchContentAssignment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlayerGameStats" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "gameDefinitionId" UUID NOT NULL,
    "gamesPlayed" INTEGER NOT NULL DEFAULT 0,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "draws" INTEGER NOT NULL DEFAULT 0,
    "forfeits" INTEGER NOT NULL DEFAULT 0,
    "totalCorrect" INTEGER NOT NULL DEFAULT 0,
    "totalQuestions" INTEGER NOT NULL DEFAULT 0,
    "totalTimeMs" BIGINT NOT NULL DEFAULT 0,
    "totalScore" BIGINT NOT NULL DEFAULT 0,
    "bestScore" BIGINT NOT NULL DEFAULT 0,
    "lastPlayedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PlayerGameStats_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OutboxEvent" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "eventType" VARCHAR(120) NOT NULL,
    "aggregateType" VARCHAR(80) NOT NULL,
    "aggregateId" UUID NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "OutboxEventStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GameDefinition_key_key" ON "GameDefinition"("key");
CREATE UNIQUE INDEX "GameConfig_gameDefinitionId_version_key" ON "GameConfig"("gameDefinitionId", "version");
CREATE UNIQUE INDEX "GameConfig_one_active_per_game_key" ON "GameConfig"("gameDefinitionId") WHERE "active" = true;
CREATE UNIQUE INDEX "Match_serverNonce_key" ON "Match"("serverNonce");
CREATE UNIQUE INDEX "MatchParticipant_matchId_userId_key" ON "MatchParticipant"("matchId", "userId");
CREATE UNIQUE INDEX "MatchEvent_matchId_participantId_clientEventId_key" ON "MatchEvent"("matchId", "participantId", "clientEventId");
CREATE UNIQUE INDEX "MatchEvent_matchId_participantId_sequence_key" ON "MatchEvent"("matchId", "participantId", "sequence");
CREATE UNIQUE INDEX "MatchSettlement_matchId_key" ON "MatchSettlement"("matchId");
CREATE UNIQUE INDEX "MatchSettlement_winnerParticipantId_key" ON "MatchSettlement"("winnerParticipantId");
CREATE UNIQUE INDEX "MatchSettlement_idempotencyKeyId_key" ON "MatchSettlement"("idempotencyKeyId");
CREATE UNIQUE INDEX "MatchContentAssignment_matchId_participantId_position_key" ON "MatchContentAssignment"("matchId", "participantId", "position");
CREATE INDEX "MatchContentAssignment_participantId_contentItemId_idx" ON "MatchContentAssignment"("participantId", "contentItemId");
CREATE UNIQUE INDEX "PlayerGameStats_userId_gameDefinitionId_key" ON "PlayerGameStats"("userId", "gameDefinitionId");
CREATE INDEX "Match_status_createdAt_idx" ON "Match"("status", "createdAt");
CREATE INDEX "Match_createdByUserId_status_idx" ON "Match"("createdByUserId", "status");
CREATE INDEX "MatchParticipant_matchId_result_idx" ON "MatchParticipant"("matchId", "result");
CREATE INDEX "MatchParticipant_userId_createdAt_idx" ON "MatchParticipant"("userId", "createdAt");
CREATE INDEX "MatchEvent_matchId_participantId_serverReceivedAt_idx" ON "MatchEvent"("matchId", "participantId", "serverReceivedAt");
CREATE INDEX "GameContentItem_gameDefinitionId_active_version_idx" ON "GameContentItem"("gameDefinitionId", "active", "version");
CREATE INDEX "MatchContentAssignment_matchId_participantId_answeredAt_idx" ON "MatchContentAssignment"("matchId", "participantId", "answeredAt");
CREATE INDEX "PlayerGameStats_gameDefinitionId_totalScore_idx" ON "PlayerGameStats"("gameDefinitionId", "totalScore");
CREATE INDEX "OutboxEvent_status_availableAt_idx" ON "OutboxEvent"("status", "availableAt");
CREATE INDEX "OutboxEvent_aggregateType_aggregateId_idx" ON "OutboxEvent"("aggregateType", "aggregateId");

ALTER TABLE "GameConfig" ADD CONSTRAINT "GameConfig_gameDefinitionId_fkey" FOREIGN KEY ("gameDefinitionId") REFERENCES "GameDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Match" ADD CONSTRAINT "Match_gameDefinitionId_fkey" FOREIGN KEY ("gameDefinitionId") REFERENCES "GameDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Match" ADD CONSTRAINT "Match_gameConfigId_fkey" FOREIGN KEY ("gameConfigId") REFERENCES "GameConfig"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Match" ADD CONSTRAINT "Match_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MatchParticipant" ADD CONSTRAINT "MatchParticipant_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MatchParticipant" ADD CONSTRAINT "MatchParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MatchEvent" ADD CONSTRAINT "MatchEvent_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MatchEvent" ADD CONSTRAINT "MatchEvent_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "MatchParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MatchSettlement" ADD CONSTRAINT "MatchSettlement_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MatchSettlement" ADD CONSTRAINT "MatchSettlement_winnerParticipantId_fkey" FOREIGN KEY ("winnerParticipantId") REFERENCES "MatchParticipant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MatchSettlement" ADD CONSTRAINT "MatchSettlement_idempotencyKeyId_fkey" FOREIGN KEY ("idempotencyKeyId") REFERENCES "IdempotencyKey"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GameContentItem" ADD CONSTRAINT "GameContentItem_gameDefinitionId_fkey" FOREIGN KEY ("gameDefinitionId") REFERENCES "GameDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MatchContentAssignment" ADD CONSTRAINT "MatchContentAssignment_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MatchContentAssignment" ADD CONSTRAINT "MatchContentAssignment_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "MatchParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MatchContentAssignment" ADD CONSTRAINT "MatchContentAssignment_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "GameContentItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlayerGameStats" ADD CONSTRAINT "PlayerGameStats_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlayerGameStats" ADD CONSTRAINT "PlayerGameStats_gameDefinitionId_fkey" FOREIGN KEY ("gameDefinitionId") REFERENCES "GameDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "GameDefinition" ("key", "name", "active", "updatedAt") VALUES
  ('trivia', 'Trivia', true, CURRENT_TIMESTAMP),
  ('math', 'Math', true, CURRENT_TIMESTAMP),
  ('flick_master', 'Flick Master', true, CURRENT_TIMESTAMP),
  ('high_low', 'High Low', true, CURRENT_TIMESTAMP),
  ('stacking', 'Stacking', true, CURRENT_TIMESTAMP),
  ('similarities', 'Similarities', true, CURRENT_TIMESTAMP),
  ('follow_the_lead', 'Follow the Lead', true, CURRENT_TIMESTAMP),
  ('memorize_cards', 'Memorize Cards', true, CURRENT_TIMESTAMP),
  ('bird_watching', 'Bird Watching', true, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "GameConfig" ("gameDefinitionId", "mainProgressionKey", "eloProgressionKey", "rewardCurrencyCode", "scoreMultiplierForXp", "maxEloDelta", "soloEloScoreDivisor", "soloEloMaxDelta", "winnerBaseReward", "loserBaseReward", "drawReward", "scoreRewardDivisor", "scoreRewardCap", "winnerRewardBonusMax", "loserRewardBonusMax", "multiplayerRewardReference", "correctAnswerPoints", "wrongAnswerPenaltyPercent", "maxAnswerTimeSeconds", "maxMatchDurationSeconds", "maxQuestions", "rankingEloMultiplier", "rankingLevelMultiplier", "rankingCoinMultiplier", "settings", "updatedAt")
SELECT "id", 'main', 'elo', 'MCN', 1.0, 500, 100, 200, 300, 100, 250, 10, 200, 200, 100, 1000, '{"1":100,"2":120,"3":150,"4":180,"5":200}'::jsonb, 50, 30, 30, 10, 1.5, 1.5, 1.5, '{"leaderboardKeys":{"playerWeekly":"players_weekly","playerMonthly":"players_monthly","countryWeekly":"countryweekly","countryMonthly":"countrymonthly"}}'::jsonb, CURRENT_TIMESTAMP
FROM "GameDefinition"
ON CONFLICT ("gameDefinitionId") DO NOTHING;
