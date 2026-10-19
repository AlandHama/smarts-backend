-- Perfect Timing phases 0-3: deterministic schedule, authoritative tap
-- journal, participant score state, game policy, and game registration.

CREATE TABLE IF NOT EXISTS "PerfectTimingMatch" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "matchId" UUID NOT NULL,
  "seed" VARCHAR(128) NOT NULL,
  "scheduleCommitment" CHAR(64) NOT NULL,
  "rulesVersion" VARCHAR(64) NOT NULL,
  "policyVersion" VARCHAR(64) NOT NULL,
  "roundCount" INTEGER NOT NULL,
  "currentRoundIndex" INTEGER NOT NULL DEFAULT 0,
  "currentRoundStatus" VARCHAR(32) NOT NULL DEFAULT 'CREATED',
  "nextSequence" INTEGER NOT NULL DEFAULT 1,
  "schedule" JSONB NOT NULL,
  "roundResults" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "stateHash" CHAR(64) NOT NULL,
  "startedAt" TIMESTAMP(3),
  "roundStartedAt" TIMESTAMP(3),
  "roundDeadlineAt" TIMESTAMP(3),
  "nextRoundAt" TIMESTAMP(3),
  "endedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PerfectTimingMatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PerfectTimingParticipantState" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "perfectTimingMatchId" UUID NOT NULL,
  "matchParticipantId" UUID NOT NULL,
  "score" INTEGER NOT NULL DEFAULT 0,
  "perfectCount" INTEGER NOT NULL DEFAULT 0,
  "greatCount" INTEGER NOT NULL DEFAULT 0,
  "goodCount" INTEGER NOT NULL DEFAULT 0,
  "missCount" INTEGER NOT NULL DEFAULT 0,
  "nextSequence" INTEGER NOT NULL DEFAULT 1,
  "lastTapAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PerfectTimingParticipantState_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PerfectTimingAction" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "matchId" UUID NOT NULL,
  "perfectTimingMatchId" UUID NOT NULL,
  "matchParticipantId" UUID NOT NULL,
  "roundIndex" INTEGER NOT NULL,
  "sequence" INTEGER NOT NULL,
  "clientActionId" VARCHAR(128) NOT NULL,
  "actionType" VARCHAR(32) NOT NULL,
  "accepted" BOOLEAN NOT NULL DEFAULT false,
  "rejectionReason" VARCHAR(160),
  "judgement" VARCHAR(16),
  "timingErrorMs" INTEGER,
  "scoreDelta" INTEGER NOT NULL DEFAULT 0,
  "estimatedTapAtServerMs" BIGINT,
  "payload" JSONB,
  "serverReceivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "clientOccurredAt" TIMESTAMP(3),
  CONSTRAINT "PerfectTimingAction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PerfectTimingMatch_matchId_key" ON "PerfectTimingMatch"("matchId");
CREATE INDEX IF NOT EXISTS "PerfectTimingMatch_endedAt_createdAt_idx" ON "PerfectTimingMatch"("endedAt", "createdAt");
CREATE INDEX IF NOT EXISTS "PerfectTimingMatch_roundDeadlineAt_currentRoundStatus_idx" ON "PerfectTimingMatch"("roundDeadlineAt", "currentRoundStatus");
CREATE UNIQUE INDEX IF NOT EXISTS "PerfectTimingParticipantState_matchParticipantId_key" ON "PerfectTimingParticipantState"("matchParticipantId");
CREATE INDEX IF NOT EXISTS "PerfectTimingParticipantState_perfectTimingMatchId_score_idx" ON "PerfectTimingParticipantState"("perfectTimingMatchId", "score");
CREATE UNIQUE INDEX IF NOT EXISTS "PerfectTimingAction_matchId_matchParticipantId_clientActionId_key" ON "PerfectTimingAction"("matchId", "matchParticipantId", "clientActionId");
CREATE UNIQUE INDEX IF NOT EXISTS "PerfectTimingAction_matchId_matchParticipantId_sequence_key" ON "PerfectTimingAction"("matchId", "matchParticipantId", "sequence");
CREATE INDEX IF NOT EXISTS "PerfectTimingAction_matchId_roundIndex_accepted_idx" ON "PerfectTimingAction"("matchId", "roundIndex", "accepted");
CREATE INDEX IF NOT EXISTS "PerfectTimingAction_perfectTimingMatchId_serverReceivedAt_idx" ON "PerfectTimingAction"("perfectTimingMatchId", "serverReceivedAt");

DO $$ BEGIN
  ALTER TABLE "PerfectTimingMatch" ADD CONSTRAINT "PerfectTimingMatch_matchId_fkey"
    FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "PerfectTimingParticipantState" ADD CONSTRAINT "PerfectTimingParticipantState_perfectTimingMatchId_fkey"
    FOREIGN KEY ("perfectTimingMatchId") REFERENCES "PerfectTimingMatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "PerfectTimingParticipantState" ADD CONSTRAINT "PerfectTimingParticipantState_matchParticipantId_fkey"
    FOREIGN KEY ("matchParticipantId") REFERENCES "MatchParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "PerfectTimingAction" ADD CONSTRAINT "PerfectTimingAction_matchId_fkey"
    FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "PerfectTimingAction" ADD CONSTRAINT "PerfectTimingAction_perfectTimingMatchId_fkey"
    FOREIGN KEY ("perfectTimingMatchId") REFERENCES "PerfectTimingMatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "PerfectTimingAction" ADD CONSTRAINT "PerfectTimingAction_matchParticipantId_fkey"
    FOREIGN KEY ("matchParticipantId") REFERENCES "MatchParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

INSERT INTO "GameDefinition" ("id", "key", "name", "active", "modePolicy", "createdAt", "updatedAt")
VALUES (
  gen_random_uuid(),
  'perfect_timing',
  'Perfect Timing',
  true,
  '{"rulesVersion":"perfect-timing.v1","standardRounds":10,"practiceRounds":5,"rankedRoundMin":10,"rankedRoundMax":15,"casualEnabled":true,"rankedEnabled":false,"practiceEnabled":true,"casualBotEnabled":true,"rankedBotFallback":false,"killSwitch":false,"rolloutPercentage":100,"authoritative":true}'::jsonb,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("key") DO UPDATE SET
  "name" = EXCLUDED."name",
  "active" = true,
  "modePolicy" = EXCLUDED."modePolicy",
  "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "GameConfig" (
  "id", "gameDefinitionId", "version", "active", "mainProgressionKey", "eloProgressionKey", "rewardCurrencyCode",
  "scoreMultiplierForXp", "maxEloDelta", "soloEloScoreDivisor", "soloEloMaxDelta", "winnerBaseReward", "loserBaseReward",
  "drawReward", "scoreRewardDivisor", "scoreRewardCap", "winnerRewardBonusMax", "loserRewardBonusMax", "multiplayerRewardReference",
  "correctAnswerPoints", "wrongAnswerPenaltyPercent", "maxAnswerTimeSeconds", "maxMatchDurationSeconds", "maxQuestions",
  "instantSkipPriceGld", "rankingEnabled", "rankingEloMultiplier", "rankingLevelMultiplier", "rankingCoinMultiplier", "settings",
  "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(), "id", 1, true, 'perfect_timing_xp', 'perfect_timing_elo', 'GLD',
  1.0, 100, 1000, 50, 0, 0, 0, 1, 250000, 0, 0, 0,
  '{"PERFECT":100,"GREAT":75,"GOOD":40,"MISS":0}'::jsonb, 0, 5, 75, 0,
  0, false, 1.0, 1.0, 1.0,
  '{"authoritative":true,"perfectTimingPolicy":{"enabled":true,"visibleName":"Perfect Timing","rulesVersion":"perfect-timing.v1","policyVersion":"perfect-timing-policy.v1","standardRounds":10,"practiceRounds":5,"rankedRoundMin":10,"rankedRoundMax":15,"roundDurationMs":3000,"interRoundDurationMs":650,"perfectWindowMs":40,"greatWindowMs":100,"goodWindowMs":180,"targetWidthEarly":0.16,"targetWidthMiddle":0.11,"targetWidthLate":0.07,"casualEnabled":true,"rankedEnabled":false,"practiceEnabled":true,"casualBotEnabled":true,"rankedBotFallback":false,"killSwitch":false,"rolloutPercentage":100,"clockOffsetLimitMs":1500,"maxTapAgeMs":2500,"maxTapLeadMs":150,"movementModels":["LINEAR_PING_PONG","EASED_PING_PONG","ACCELERATE_AND_REVERSE","TARGET_DRIFT","FAKE_SLOWDOWN"],"bot":{"enabled":true,"reactionDelayMs":700,"jitterMs":80,"skill":0.55}}}'::jsonb,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "GameDefinition"
WHERE "key" = 'perfect_timing'
  AND NOT EXISTS (SELECT 1 FROM "GameConfig" WHERE "gameDefinitionId" = "GameDefinition"."id" AND "version" = 1);

UPDATE "GameConfig" config
SET "active" = true,
    "maxAnswerTimeSeconds" = 5,
    "maxMatchDurationSeconds" = 75,
    "maxQuestions" = 0,
    "rankingEnabled" = false,
    "updatedAt" = CURRENT_TIMESTAMP
FROM "GameDefinition" definition
WHERE config."gameDefinitionId" = definition."id"
  AND definition."key" = 'perfect_timing'
  AND config."version" = 1;
