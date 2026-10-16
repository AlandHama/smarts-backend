CREATE TABLE IF NOT EXISTS "DominoMatchState" (
  "id" UUID NOT NULL,
  "matchId" UUID NOT NULL,
  "rulesVersion" VARCHAR(64) NOT NULL,
  "policyVersion" VARCHAR(64) NOT NULL,
  "seed" VARCHAR(128) NOT NULL,
  "roundNumber" INTEGER NOT NULL DEFAULT 1,
  "currentSeat" INTEGER NOT NULL DEFAULT 0,
  "nextSequence" INTEGER NOT NULL DEFAULT 1,
  "leftOpenValue" INTEGER NOT NULL,
  "rightOpenValue" INTEGER NOT NULL,
  "chainHash" CHAR(64) NOT NULL,
  "boneyardCount" INTEGER NOT NULL DEFAULT 0,
  "state" JSONB NOT NULL,
  "replay" JSONB NOT NULL,
  "startedAt" TIMESTAMP(3),
  "roundEndsAt" TIMESTAMP(3),
  "matchEndsAt" TIMESTAMP(3),
  "endedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DominoMatchState_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "DominoAction" (
  "id" UUID NOT NULL,
  "matchId" UUID NOT NULL,
  "dominoMatchStateId" UUID NOT NULL,
  "matchParticipantId" UUID NOT NULL,
  "sequence" INTEGER NOT NULL,
  "clientActionId" VARCHAR(128) NOT NULL,
  "actionType" VARCHAR(32) NOT NULL,
  "accepted" BOOLEAN NOT NULL DEFAULT false,
  "rejectionReason" VARCHAR(160),
  "payload" JSONB,
  "serverReceivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "clientOccurredAt" TIMESTAMP(3),
  CONSTRAINT "DominoAction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DominoMatchState_matchId_key" ON "DominoMatchState"("matchId");
CREATE INDEX IF NOT EXISTS "DominoMatchState_endedAt_createdAt_idx" ON "DominoMatchState"("endedAt", "createdAt");
CREATE INDEX IF NOT EXISTS "DominoMatchState_matchEndsAt_currentSeat_idx" ON "DominoMatchState"("matchEndsAt", "currentSeat");
CREATE UNIQUE INDEX IF NOT EXISTS "DominoAction_matchId_matchParticipantId_clientActionId_key" ON "DominoAction"("matchId", "matchParticipantId", "clientActionId");
CREATE UNIQUE INDEX IF NOT EXISTS "DominoAction_matchId_matchParticipantId_sequence_key" ON "DominoAction"("matchId", "matchParticipantId", "sequence");
CREATE INDEX IF NOT EXISTS "DominoAction_matchId_serverReceivedAt_idx" ON "DominoAction"("matchId", "serverReceivedAt");
CREATE INDEX IF NOT EXISTS "DominoAction_dominoMatchStateId_sequence_idx" ON "DominoAction"("dominoMatchStateId", "sequence");

DO $$ BEGIN
  ALTER TABLE "DominoMatchState" ADD CONSTRAINT "DominoMatchState_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "DominoAction" ADD CONSTRAINT "DominoAction_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "DominoAction" ADD CONSTRAINT "DominoAction_dominoMatchStateId_fkey" FOREIGN KEY ("dominoMatchStateId") REFERENCES "DominoMatchState"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "DominoAction" ADD CONSTRAINT "DominoAction_matchParticipantId_fkey" FOREIGN KEY ("matchParticipantId") REFERENCES "MatchParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

INSERT INTO "GameDefinition" ("id", "key", "name", "active", "createdAt", "updatedAt", "modePolicy")
SELECT gen_random_uuid(), 'domino', 'Domino Duel', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP,
  '{"authoritative":true,"seatCount":4,"handSize":5,"boneyardSize":8,"targetScore":100,"maxRounds":10,"roundDurationSeconds":300,"matchDurationSeconds":900,"casualEnabled":true,"rankedEnabled":false,"practiceEnabled":true,"botFillEnabled":true,"botFallbackDelaySeconds":20,"rankedBotFallback":false,"rulesVersion":"domino.v1","scoreVersion":"domino-score.v1"}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM "GameDefinition" WHERE "key" = 'domino');

INSERT INTO "GameConfig" ("id", "gameDefinitionId", "version", "active", "minimumPlayerLevel", "maxQuestions", "maxMatchDurationSeconds", "rankingEnabled", "mainProgressionKey", "eloProgressionKey", "rewardCurrencyCode", "scoreMultiplierForXp", "maxEloDelta", "soloEloScoreDivisor", "soloEloMaxDelta", "winnerBaseReward", "loserBaseReward", "drawReward", "scoreRewardDivisor", "scoreRewardCap", "winnerRewardBonusMax", "loserRewardBonusMax", "multiplayerRewardReference", "correctAnswerPoints", "wrongAnswerPenaltyPercent", "maxAnswerTimeSeconds", "instantSkipPriceGld", "rankingEloMultiplier", "rankingLevelMultiplier", "rankingCoinMultiplier", "settings", "createdAt", "updatedAt")
SELECT gen_random_uuid(), gd."id", 1, true, 1, 0, 900, false, 'domino_xp', 'domino_elo', 'GLD', 1, 100, 1000, 50, 0, 0, 0, 1, 0, 0, 0, 0, '{}'::jsonb, 0, 300, 0, 1, 1, 1,
  '{"authoritative":true,"dominoPolicy":{"rulesVersion":"domino.v1","scoreVersion":"domino-score.v1","seatCount":4,"handSize":5,"boneyardSize":8,"targetScore":100,"maxRounds":10,"roundDurationSeconds":300,"matchDurationSeconds":900,"casualEnabled":true,"rankedEnabled":false,"practiceEnabled":true,"botFillEnabled":true,"botFallbackDelaySeconds":20,"rankedBotFallback":false}}'::jsonb,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "GameDefinition" gd
WHERE gd."key" = 'domino' AND NOT EXISTS (SELECT 1 FROM "GameConfig" gc WHERE gc."gameDefinitionId" = gd."id" AND gc."version" = 1);
