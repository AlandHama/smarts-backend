ALTER TABLE "MatchParticipant"
  ADD COLUMN IF NOT EXISTS "acceptedActionCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "acceptedScoringActionCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "verifiedPlayMilliseconds" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "firstAcceptedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastAcceptedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "completionState" VARCHAR(24) NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS "terminationReason" VARCHAR(48),
  ADD COLUMN IF NOT EXISTS "rewardEligibility" VARCHAR(16) NOT NULL DEFAULT 'NONE',
  ADD COLUMN IF NOT EXISTS "rewardHoldReason" VARCHAR(160);

CREATE INDEX IF NOT EXISTS "MatchParticipant_matchId_rewardEligibility_idx"
  ON "MatchParticipant"("matchId", "rewardEligibility");
