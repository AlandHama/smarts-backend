INSERT INTO "GameDefinition" ("id", "key", "name", "active", "modePolicy", "createdAt", "updatedAt")
VALUES (gen_random_uuid(), 'gem_blitz', 'Gem Blitz', true,
  '{"boardSize":7,"durationSeconds":75,"rulesVersion":"gem-blitz.v1","authoritative":true}'::jsonb,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO UPDATE SET "name" = EXCLUDED."name", "active" = true, "modePolicy" = EXCLUDED."modePolicy", "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "GameConfig" (
  "id", "gameDefinitionId", "version", "active", "mainProgressionKey", "eloProgressionKey", "rewardCurrencyCode",
  "scoreMultiplierForXp", "maxEloDelta", "soloEloScoreDivisor", "soloEloMaxDelta", "winnerBaseReward", "loserBaseReward",
  "drawReward", "scoreRewardDivisor", "scoreRewardCap", "winnerRewardBonusMax", "loserRewardBonusMax", "multiplayerRewardReference",
  "correctAnswerPoints", "wrongAnswerPenaltyPercent", "maxAnswerTimeSeconds", "maxMatchDurationSeconds", "maxQuestions",
  "instantSkipPriceGld", "rankingEnabled", "rankingEloMultiplier", "rankingLevelMultiplier", "rankingCoinMultiplier", "settings",
  "createdAt", "updatedAt"
)
SELECT gen_random_uuid(), "id", 1, true, 'gem_blitz_xp', 'gem_blitz_elo', 'GLD',
  1.0, 100, 1000, 50, 0, 0, 0, 1, 0, 0, 0, 0,
  '{}'::jsonb, 0, 75, 75, 0, 0, true, 1.0, 1.0, 1.0,
  '{"authoritative":true,"boardSize":7,"durationSeconds":75,"rulesVersion":"gem-blitz.v1"}'::jsonb,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "GameDefinition" WHERE "key" = 'gem_blitz'
ON CONFLICT ("gameDefinitionId", "version") DO UPDATE SET "active" = true, "maxMatchDurationSeconds" = 75, "maxQuestions" = 0, "rankingEnabled" = true, "settings" = EXCLUDED."settings", "updatedAt" = CURRENT_TIMESTAMP;
