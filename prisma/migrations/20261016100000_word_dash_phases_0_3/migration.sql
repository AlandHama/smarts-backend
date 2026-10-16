-- Word Dash phases 0-3: immutable board state, participant counters,
-- normalized found words, compact submission idempotency, and game seed.

CREATE TABLE IF NOT EXISTS "WordDashMatch" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "matchId" UUID NOT NULL,
  "seed" VARCHAR(64) NOT NULL,
  "boardLetters" CHAR(25) NOT NULL,
  "boardHash" CHAR(64) NOT NULL,
  "rulesVersion" VARCHAR(64) NOT NULL,
  "dictionaryVersion" VARCHAR(64) NOT NULL,
  "dictionarySha256" CHAR(64) NOT NULL,
  "durationSeconds" INTEGER NOT NULL,
  "startedAt" TIMESTAMP(3),
  "endsAt" TIMESTAMP(3),
  "endedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WordDashMatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "WordDashParticipantState" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "wordDashMatchId" UUID NOT NULL,
  "matchParticipantId" UUID NOT NULL,
  "score" INTEGER NOT NULL DEFAULT 0,
  "combo" INTEGER NOT NULL DEFAULT 0,
  "bestCombo" INTEGER NOT NULL DEFAULT 0,
  "acceptedWordCount" INTEGER NOT NULL DEFAULT 0,
  "longestWordLength" INTEGER NOT NULL DEFAULT 0,
  "lastAcceptedAt" TIMESTAMP(3),
  "nextSequence" INTEGER NOT NULL DEFAULT 1,
  "lastSubmissionAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WordDashParticipantState_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "WordDashFoundWord" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "matchParticipantId" UUID NOT NULL,
  "word" VARCHAR(25) NOT NULL,
  "firstSequence" INTEGER NOT NULL,
  "scoreDelta" INTEGER NOT NULL DEFAULT 0,
  "path" JSONB NOT NULL,
  "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WordDashFoundWord_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "WordDashSubmission" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "matchId" UUID NOT NULL,
  "matchParticipantId" UUID NOT NULL,
  "sequence" INTEGER NOT NULL,
  "clientSubmissionId" VARCHAR(128) NOT NULL,
  "tileIndexes" JSONB NOT NULL,
  "reconstructedWord" VARCHAR(25),
  "accepted" BOOLEAN NOT NULL DEFAULT false,
  "rejectionReason" VARCHAR(160),
  "scoreDelta" INTEGER NOT NULL DEFAULT 0,
  "comboAfter" INTEGER NOT NULL DEFAULT 0,
  "serverReceivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "clientReleasedAt" TIMESTAMP(3),
  CONSTRAINT "WordDashSubmission_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "WordDashMatch_matchId_key" ON "WordDashMatch"("matchId");
CREATE INDEX IF NOT EXISTS "WordDashMatch_endedAt_createdAt_idx" ON "WordDashMatch"("endedAt", "createdAt");
CREATE INDEX IF NOT EXISTS "WordDashMatch_dictionaryVersion_rulesVersion_idx" ON "WordDashMatch"("dictionaryVersion", "rulesVersion");

CREATE UNIQUE INDEX IF NOT EXISTS "WordDashParticipantState_matchParticipantId_key" ON "WordDashParticipantState"("matchParticipantId");
CREATE INDEX IF NOT EXISTS "WordDashParticipantState_wordDashMatchId_score_idx" ON "WordDashParticipantState"("wordDashMatchId", "score");

CREATE UNIQUE INDEX IF NOT EXISTS "WordDashFoundWord_matchParticipantId_word_key" ON "WordDashFoundWord"("matchParticipantId", "word");
CREATE INDEX IF NOT EXISTS "WordDashFoundWord_matchParticipantId_acceptedAt_idx" ON "WordDashFoundWord"("matchParticipantId", "acceptedAt");
CREATE INDEX IF NOT EXISTS "WordDashFoundWord_matchParticipantId_word_idx" ON "WordDashFoundWord"("matchParticipantId", "word");

CREATE UNIQUE INDEX IF NOT EXISTS "WordDashSubmission_matchId_matchParticipantId_clientSubmissionId_key"
  ON "WordDashSubmission"("matchId", "matchParticipantId", "clientSubmissionId");
CREATE UNIQUE INDEX IF NOT EXISTS "WordDashSubmission_matchId_matchParticipantId_sequence_key"
  ON "WordDashSubmission"("matchId", "matchParticipantId", "sequence");
CREATE INDEX IF NOT EXISTS "WordDashSubmission_matchId_matchParticipantId_serverReceivedAt_idx"
  ON "WordDashSubmission"("matchId", "matchParticipantId", "serverReceivedAt");

DO $$ BEGIN
  ALTER TABLE "WordDashMatch" ADD CONSTRAINT "WordDashMatch_matchId_fkey"
    FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "WordDashParticipantState" ADD CONSTRAINT "WordDashParticipantState_wordDashMatchId_fkey"
    FOREIGN KEY ("wordDashMatchId") REFERENCES "WordDashMatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "WordDashParticipantState" ADD CONSTRAINT "WordDashParticipantState_matchParticipantId_fkey"
    FOREIGN KEY ("matchParticipantId") REFERENCES "MatchParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "WordDashFoundWord" ADD CONSTRAINT "WordDashFoundWord_matchParticipantId_fkey"
    FOREIGN KEY ("matchParticipantId") REFERENCES "MatchParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "WordDashSubmission" ADD CONSTRAINT "WordDashSubmission_matchId_fkey"
    FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "WordDashSubmission" ADD CONSTRAINT "WordDashSubmission_matchParticipantId_fkey"
    FOREIGN KEY ("matchParticipantId") REFERENCES "MatchParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

INSERT INTO "GameDefinition" ("id", "key", "name", "active", "modePolicy", "createdAt", "updatedAt")
VALUES (
  gen_random_uuid(),
  'word_dash',
  'Word Dash',
  true,
  '{"boardSize":5,"durationSeconds":60,"minimumWordLength":3,"allowDiagonal":true,"rulesVersion":"word-dash.v1","dictionaryVersion":"english.v1","casualEnabled":true,"rankedEnabled":false,"practiceEnabled":true,"casualBotEnabled":true,"rankedBotFallback":false,"authoritative":true}'::jsonb,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("key") DO UPDATE SET
  "name" = EXCLUDED."name",
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
  gen_random_uuid(), "id", 1, true, 'word_dash_xp', 'word_dash_elo', 'GLD',
  1.0, 100, 1000, 50, 0, 0, 0, 1, 250000, 0, 0, 0,
  '{}'::jsonb, 0, 60, 60, 0, 0, false, 1.0, 1.0, 1.0,
  '{"authoritative":true,"wordDashPolicy":{"enabled":true,"visibleName":"Word Dash","description":"Find words fast.","rulesVersion":"word-dash.v1","dictionaryVersion":"english.v1","boardSize":5,"durationSeconds":60,"minimumWordLength":3,"allowDiagonal":true,"casualEnabled":true,"rankedEnabled":false,"practiceEnabled":true,"casualBotEnabled":true,"rankedBotFallback":false,"comboWindowMs":4000,"maxSubmissionsPerSecond":12,"maxAcceptedWordsPerPlayer":250,"wordScoreCap":20000,"matchScoreCap":250000,"scoreTable":{"3":100,"4":200,"5":350,"6":550,"7":800,"8":1100,"extraLetterAfter8":150},"comboBonuses":{"three":0.1,"five":0.18,"eight":0.25,"max":0.25},"bot":{"enabled":true,"reactionDelayMs":1800,"jitterMs":850,"skill":0.35,"maxWords":35,"maxWordLength":7}}}'::jsonb,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "GameDefinition"
WHERE "key" = 'word_dash'
  AND NOT EXISTS (SELECT 1 FROM "GameConfig" WHERE "gameDefinitionId" = "GameDefinition"."id" AND "version" = 1);

UPDATE "GameConfig" config
SET "active" = true,
    "maxAnswerTimeSeconds" = 60,
    "maxMatchDurationSeconds" = 60,
    "maxQuestions" = 0,
    "rankingEnabled" = false,
    "updatedAt" = CURRENT_TIMESTAMP
FROM "GameDefinition" definition
WHERE config."gameDefinitionId" = definition."id"
  AND definition."key" = 'word_dash'
  AND config."version" = 1;
