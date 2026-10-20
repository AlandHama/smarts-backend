ALTER TABLE "MatchParticipant"
  ADD COLUMN "lastActivityAt" TIMESTAMP(3),
  ADD COLUMN "disconnectGraceUntil" TIMESTAMP(3);

CREATE TABLE "MatchRewardDailyLedger" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "gameDefinitionId" UUID NOT NULL,
  "dayKey" DATE NOT NULL,
  "xpAwarded" BIGINT NOT NULL DEFAULT 0,
  "gldAwarded" BIGINT NOT NULL DEFAULT 0,
  "matchCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MatchRewardDailyLedger_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MatchRewardDailyLedger_userId_gameDefinitionId_dayKey_key"
  ON "MatchRewardDailyLedger"("userId", "gameDefinitionId", "dayKey");
CREATE INDEX "MatchRewardDailyLedger_userId_dayKey_idx"
  ON "MatchRewardDailyLedger"("userId", "dayKey");

ALTER TABLE "MatchRewardDailyLedger"
  ADD CONSTRAINT "MatchRewardDailyLedger_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "MatchRewardDailyLedger_gameDefinitionId_fkey"
  FOREIGN KEY ("gameDefinitionId") REFERENCES "GameDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
