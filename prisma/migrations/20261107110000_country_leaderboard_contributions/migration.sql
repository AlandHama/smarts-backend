-- Keep the country that owned each player leaderboard score event. This
-- prevents a later country change from moving the player's old contribution
-- into the new country's detail leaderboard.
ALTER TABLE "LeaderboardScoreEvent" ADD COLUMN "countryCode" VARCHAR(16);

-- Best-effort attribution for historical events. New events are stamped by
-- the score transaction; audit history is preferred when it contains a
-- country change, otherwise the current profile is used as a fallback.
UPDATE "LeaderboardScoreEvent" event
SET "countryCode" = COALESCE(
  (
    SELECT audit."changes"->'countryCode'->>'new'
    FROM "PlayerAuditEvent" audit
    WHERE audit."userId" = event."playerId"
      AND audit."createdAt" <= event."createdAt"
      AND audit."changes" IS NOT NULL
      AND audit."changes"->'countryCode'->>'new' IS NOT NULL
    ORDER BY audit."createdAt" DESC
    LIMIT 1
  ),
  (
    SELECT audit."changes"->'countryCode'->>'old'
    FROM "PlayerAuditEvent" audit
    WHERE audit."userId" = event."playerId"
      AND audit."changes" IS NOT NULL
      AND audit."changes"->'countryCode'->>'old' IS NOT NULL
    ORDER BY audit."createdAt" ASC
    LIMIT 1
  ),
  profile."countryCode"
)
FROM "PlayerProfile" profile
WHERE profile."userId" = event."playerId"
  AND event."playerId" IS NOT NULL
  AND event."countryCode" IS NULL;

CREATE INDEX "LeaderboardScoreEvent_countryCode_idx"
  ON "LeaderboardScoreEvent"("countryCode");
