ALTER TABLE "CooperativeConfiguration"
  ADD COLUMN "botFallbackDelaySeconds" INTEGER NOT NULL DEFAULT 20,
  ADD COLUMN "initialRatingWindow" INTEGER NOT NULL DEFAULT 250,
  ADD COLUMN "maxRatingWindow" INTEGER NOT NULL DEFAULT 1000,
  ADD COLUMN "ratingWidenIntervalSeconds" INTEGER NOT NULL DEFAULT 15,
  ADD COLUMN "confirmationTimeoutSeconds" INTEGER NOT NULL DEFAULT 15,
  ADD COLUMN "disconnectGraceSeconds" INTEGER NOT NULL DEFAULT 30;

CREATE TABLE "CooperativeMatch" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "matchId" UUID NOT NULL,
  "gameDefinitionId" UUID NOT NULL,
  "format" VARCHAR(32) NOT NULL DEFAULT 'TWO_V_TWO',
  "mode" VARCHAR(16) NOT NULL DEFAULT 'RANDOM',
  "status" VARCHAR(32) NOT NULL DEFAULT 'FOUND',
  "botFilled" BOOLEAN NOT NULL DEFAULT false,
  "confirmationDeadline" TIMESTAMP(3),
  "disconnectGraceSeconds" INTEGER NOT NULL DEFAULT 30,
  "startedAt" TIMESTAMP(3),
  "endedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CooperativeMatch_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CooperativeMatch_matchId_key" ON "CooperativeMatch"("matchId");
CREATE INDEX "CooperativeMatch_status_createdAt_idx" ON "CooperativeMatch"("status", "createdAt");
CREATE INDEX "CooperativeMatch_gameDefinitionId_createdAt_idx" ON "CooperativeMatch"("gameDefinitionId", "createdAt");
ALTER TABLE "CooperativeMatch" ADD CONSTRAINT "CooperativeMatch_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CooperativeMatch" ADD CONSTRAINT "CooperativeMatch_gameDefinitionId_fkey" FOREIGN KEY ("gameDefinitionId") REFERENCES "GameDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "CooperativeTeam" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "cooperativeMatchId" UUID NOT NULL,
  "teamNumber" INTEGER NOT NULL,
  "name" VARCHAR(80) NOT NULL DEFAULT 'Team',
  "score" INTEGER NOT NULL DEFAULT 0,
  "correctAnswers" INTEGER NOT NULL DEFAULT 0,
  "answeredQuestions" INTEGER NOT NULL DEFAULT 0,
  "result" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CooperativeTeam_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CooperativeTeam_cooperativeMatchId_teamNumber_key" ON "CooperativeTeam"("cooperativeMatchId", "teamNumber");
CREATE INDEX "CooperativeTeam_cooperativeMatchId_result_idx" ON "CooperativeTeam"("cooperativeMatchId", "result");
ALTER TABLE "CooperativeTeam" ADD CONSTRAINT "CooperativeTeam_cooperativeMatchId_fkey" FOREIGN KEY ("cooperativeMatchId") REFERENCES "CooperativeMatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "CooperativeParticipant" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "cooperativeMatchId" UUID NOT NULL,
  "teamId" UUID NOT NULL,
  "matchParticipantId" UUID NOT NULL,
  "userId" UUID,
  "participantType" "MatchParticipantType" NOT NULL,
  "displayName" VARCHAR(120) NOT NULL,
  "avatarUrl" TEXT,
  "levelSnapshot" INTEGER NOT NULL DEFAULT 1,
  "eloSnapshot" INTEGER NOT NULL DEFAULT 0,
  "finalScore" INTEGER NOT NULL DEFAULT 0,
  "correctAnswers" INTEGER NOT NULL DEFAULT 0,
  "answeredQuestions" INTEGER NOT NULL DEFAULT 0,
  "connectedAt" TIMESTAMP(3),
  "disconnectedAt" TIMESTAMP(3),
  "forfeitAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CooperativeParticipant_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CooperativeParticipant_matchParticipantId_key" ON "CooperativeParticipant"("matchParticipantId");
CREATE INDEX "CooperativeParticipant_cooperativeMatchId_teamId_idx" ON "CooperativeParticipant"("cooperativeMatchId", "teamId");
CREATE INDEX "CooperativeParticipant_userId_createdAt_idx" ON "CooperativeParticipant"("userId", "createdAt");
ALTER TABLE "CooperativeParticipant" ADD CONSTRAINT "CooperativeParticipant_cooperativeMatchId_fkey" FOREIGN KEY ("cooperativeMatchId") REFERENCES "CooperativeMatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CooperativeParticipant" ADD CONSTRAINT "CooperativeParticipant_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "CooperativeTeam"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CooperativeParticipant" ADD CONSTRAINT "CooperativeParticipant_matchParticipantId_fkey" FOREIGN KEY ("matchParticipantId") REFERENCES "MatchParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CooperativeParticipant" ADD CONSTRAINT "CooperativeParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
