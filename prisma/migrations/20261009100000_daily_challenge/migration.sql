CREATE TYPE "DailyChallengeStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'CLOSED');
CREATE TYPE "DailyChallengeAttemptStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'EXPIRED', 'DISQUALIFIED');

CREATE TABLE "DailyChallengeConfiguration" (
  "id" UUID NOT NULL,
  "key" VARCHAR(40) NOT NULL DEFAULT 'default',
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "gameKey" VARCHAR(64) NOT NULL DEFAULT 'trivia',
  "timezone" VARCHAR(64) NOT NULL DEFAULT 'UTC',
  "questionsPerDay" INTEGER NOT NULL DEFAULT 10,
  "durationSeconds" INTEGER NOT NULL DEFAULT 60,
  "maxAttempts" INTEGER NOT NULL DEFAULT 1,
  "pointsPerCorrect" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DailyChallengeConfiguration_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DailyChallengeConfiguration_key_key" ON "DailyChallengeConfiguration"("key");

CREATE TABLE "DailyChallenge" (
  "id" UUID NOT NULL,
  "dateKey" VARCHAR(10) NOT NULL,
  "gameDefinitionId" UUID NOT NULL,
  "status" "DailyChallengeStatus" NOT NULL DEFAULT 'DRAFT',
  "title" VARCHAR(160) NOT NULL DEFAULT 'Today''s SMARTS Challenge',
  "subtitle" VARCHAR(300) NOT NULL DEFAULT 'One global challenge. One attempt.',
  "questionCount" INTEGER NOT NULL,
  "durationSeconds" INTEGER NOT NULL,
  "pointsPerCorrect" INTEGER NOT NULL DEFAULT 1,
  "publishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DailyChallenge_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DailyChallenge_dateKey_key" ON "DailyChallenge"("dateKey");
CREATE INDEX "DailyChallenge_status_dateKey_idx" ON "DailyChallenge"("status", "dateKey");
ALTER TABLE "DailyChallenge" ADD CONSTRAINT "DailyChallenge_gameDefinitionId_fkey" FOREIGN KEY ("gameDefinitionId") REFERENCES "GameDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "DailyChallengeQuestion" (
  "id" UUID NOT NULL,
  "challengeId" UUID NOT NULL,
  "contentItemId" UUID NOT NULL,
  "position" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DailyChallengeQuestion_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DailyChallengeQuestion_challengeId_position_key" ON "DailyChallengeQuestion"("challengeId", "position");
CREATE UNIQUE INDEX "DailyChallengeQuestion_challengeId_contentItemId_key" ON "DailyChallengeQuestion"("challengeId", "contentItemId");
CREATE INDEX "DailyChallengeQuestion_contentItemId_idx" ON "DailyChallengeQuestion"("contentItemId");
ALTER TABLE "DailyChallengeQuestion" ADD CONSTRAINT "DailyChallengeQuestion_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "DailyChallenge"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DailyChallengeQuestion" ADD CONSTRAINT "DailyChallengeQuestion_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "GameContentItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "DailyChallengeAttempt" (
  "id" UUID NOT NULL,
  "challengeId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "status" "DailyChallengeAttemptStatus" NOT NULL DEFAULT 'IN_PROGRESS',
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "submittedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "score" INTEGER NOT NULL DEFAULT 0,
  "correctAnswers" INTEGER NOT NULL DEFAULT 0,
  "answeredQuestions" INTEGER NOT NULL DEFAULT 0,
  "elapsedMs" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DailyChallengeAttempt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DailyChallengeAttempt_challengeId_userId_key" UNIQUE ("challengeId", "userId")
);
CREATE INDEX "DailyChallengeAttempt_challengeId_status_score_elapsedMs_idx" ON "DailyChallengeAttempt"("challengeId", "status", "score", "elapsedMs");
CREATE INDEX "DailyChallengeAttempt_userId_createdAt_idx" ON "DailyChallengeAttempt"("userId", "createdAt");
ALTER TABLE "DailyChallengeAttempt" ADD CONSTRAINT "DailyChallengeAttempt_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "DailyChallenge"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DailyChallengeAttempt" ADD CONSTRAINT "DailyChallengeAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "DailyChallengeAnswer" (
  "id" UUID NOT NULL,
  "attemptId" UUID NOT NULL,
  "position" INTEGER NOT NULL,
  "selectedIndex" INTEGER NOT NULL,
  "isCorrect" BOOLEAN NOT NULL,
  "timeTakenMs" INTEGER,
  "answeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DailyChallengeAnswer_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DailyChallengeAnswer_attemptId_position_key" UNIQUE ("attemptId", "position")
);
CREATE INDEX "DailyChallengeAnswer_attemptId_answeredAt_idx" ON "DailyChallengeAnswer"("attemptId", "answeredAt");
ALTER TABLE "DailyChallengeAnswer" ADD CONSTRAINT "DailyChallengeAnswer_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "DailyChallengeAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "DailyChallengeConfiguration" ("id", "key", "enabled", "gameKey", "timezone", "questionsPerDay", "durationSeconds", "maxAttempts", "pointsPerCorrect", "createdAt", "updatedAt")
VALUES (gen_random_uuid(), 'default', true, 'trivia', 'UTC', 10, 60, 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
