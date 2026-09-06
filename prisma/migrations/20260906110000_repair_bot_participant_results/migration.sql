-- Completed bot matches from the first server settlement implementation could
-- leave the bot participant as PENDING even though the match was settled.
-- Repair only terminal matches; active matches are completed by the runtime
-- bot gameplay transaction.
UPDATE "MatchParticipant" bot
SET
  "result" = CASE human."result"::text
    WHEN 'WIN' THEN 'LOSS'::"MatchParticipantResult"
    WHEN 'LOSS' THEN 'WIN'::"MatchParticipantResult"
    WHEN 'DRAW' THEN 'DRAW'::"MatchParticipantResult"
    ELSE 'COMPLETED'::"MatchParticipantResult"
  END,
  "finalScore" = COALESCE(bot."finalScore", 0),
  "submittedAt" = COALESCE(bot."submittedAt", match."endedAt", match."settledAt", CURRENT_TIMESTAMP)
FROM "Match" match
JOIN "MatchParticipant" human
  ON human."matchId" = match."id"
 AND human."participantType" = 'PLAYER'::"MatchParticipantType"
WHERE bot."matchId" = match."id"
  AND bot."participantType" = 'BOT'::"MatchParticipantType"
  AND bot."result" = 'PENDING'::"MatchParticipantResult"
  AND match."status" IN (
    'FINISHED'::"MatchStatus",
    'SETTLED'::"MatchStatus",
    'REVIEW'::"MatchStatus"
  );
