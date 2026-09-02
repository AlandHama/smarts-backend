-- Phase 9.2: bind match events and content assignments to their server round,
-- and retain a request fingerprint for safe replay/idempotency handling.
ALTER TABLE "MatchEvent" ADD COLUMN IF NOT EXISTS "roundId" UUID;
ALTER TABLE "MatchEvent" ADD COLUMN IF NOT EXISTS "requestHash" CHAR(64);
ALTER TABLE "MatchContentAssignment" ADD COLUMN IF NOT EXISTS "roundId" UUID;

-- Bind legacy Phase 5 matches to a first round so existing active matches do
-- not become unreadable after round validation is enabled. This is safe for
-- the fresh-install case and leaves the serverNonce private.
INSERT INTO "MatchRound" ("matchId", "roundIndex", "gameDefinitionId", "status", "challengeSeedHash", "startedAt", "endedAt", "updatedAt")
SELECT match."id", 1, match."gameDefinitionId",
  CASE match."status"::text
    WHEN 'CREATED' THEN 'CREATED'::"MatchRoundStatus"
    WHEN 'STARTED' THEN 'STARTED'::"MatchRoundStatus"
    WHEN 'CANCELLED' THEN 'CANCELLED'::"MatchRoundStatus"
    ELSE 'FINISHED'::"MatchRoundStatus"
  END,
  md5(match."serverNonce" || ':1') || md5(':phase9:' || match."serverNonce"),
  match."startedAt", match."endedAt", CURRENT_TIMESTAMP
FROM "Match" match
WHERE NOT EXISTS (
  SELECT 1 FROM "MatchRound" round
  WHERE round."matchId" = match."id" AND round."roundIndex" = 1
);

UPDATE "MatchEvent" event
SET "roundId" = round."id"
FROM "MatchRound" round
WHERE event."roundId" IS NULL AND round."matchId" = event."matchId" AND round."roundIndex" = 1;

UPDATE "MatchContentAssignment" assignment
SET "roundId" = round."id"
FROM "MatchRound" round
WHERE assignment."roundId" IS NULL AND round."matchId" = assignment."matchId" AND round."roundIndex" = 1;

DO $$ BEGIN
  ALTER TABLE "MatchEvent" ADD CONSTRAINT "MatchEvent_roundId_fkey"
    FOREIGN KEY ("roundId") REFERENCES "MatchRound"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "MatchContentAssignment" ADD CONSTRAINT "MatchContentAssignment_roundId_fkey"
    FOREIGN KEY ("roundId") REFERENCES "MatchRound"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "MatchEvent_roundId_participantId_sequence_idx"
  ON "MatchEvent"("roundId", "participantId", "sequence");
CREATE INDEX IF NOT EXISTS "MatchContentAssignment_roundId_participantId_position_idx"
  ON "MatchContentAssignment"("roundId", "participantId", "position");
