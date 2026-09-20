ALTER TABLE "MatchParticipant" ADD COLUMN "readyAt" TIMESTAMP(3);

-- Matches created directly by the server are already in progress. Preserve
-- their current behaviour while queue/friend matches use the readiness gate.
UPDATE "MatchParticipant" participant
SET "readyAt" = "Match"."startedAt"
FROM "Match"
WHERE participant."matchId" = "Match"."id"
  AND "Match"."status" = 'STARTED';
