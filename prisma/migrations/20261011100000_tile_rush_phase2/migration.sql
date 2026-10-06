INSERT INTO "GameDefinition" ("id", "key", "name", "active", "modePolicy", "createdAt", "updatedAt")
VALUES (
  gen_random_uuid(),
  'tile_rush',
  'Tile Rush',
  true,
  '{"boardSize":7,"tileTypes":5,"durationSeconds":60,"minimumChain":3,"rulesVersion":"tile-rush.v1","connectionMode":"ORTHOGONAL","casualEnabled":true,"rankedEnabled":true,"rankedBotFallback":false,"authoritative":true}'::jsonb,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("key") DO UPDATE SET
  "name" = EXCLUDED."name",
  "active" = true,
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
  gen_random_uuid(), "id", 1, true, 'tile_rush_xp', 'tile_rush_elo', 'GLD',
  1.0, 100, 1000, 50, 0, 0, 0, 1, 0, 0, 0, 0,
  '{}'::jsonb, 0, 60, 60, 0, 0, true, 1.0, 1.0, 1.0,
  '{"authoritative":true,"tileRushPolicy":{"enabled":true,"visibleName":"Tile Rush","description":"Connect. Clear. Rush.","boardSize":7,"tileTypes":5,"durationSeconds":60,"minimumChain":3,"rulesVersion":"tile-rush.v1","connectionMode":"ORTHOGONAL","comboWindowMs":2000,"maxComboBonus":0.2,"finalRushSeconds":10,"finalRushMultiplier":1.1,"special5Threshold":5,"special7Threshold":7,"prismThreshold":10,"loopsEnabled":true,"loopMinimumLength":4,"casualEnabled":true,"rankedEnabled":true,"rankedBotFallback":false,"scoreCap":250000,"maxActionsPerSecond":8,"bot":{"enabled":true,"reactionDelayMs":1700,"jitterMs":900,"skill":0.32,"maxActions":32,"errorRate":0.28},"scoring":{"scoreCap":250000,"cascadeMultipliers":[0.5,0.65,0.8,1],"refillCascadeLimit":6,"specialBonuses":{}}}}'::jsonb,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "GameDefinition" WHERE "key" = 'tile_rush'
ON CONFLICT ("gameDefinitionId", "version") DO UPDATE SET
  "active" = true,
  "maxAnswerTimeSeconds" = 60,
  "maxMatchDurationSeconds" = 60,
  "maxQuestions" = 0,
  "rankingEnabled" = true,
  "settings" = EXCLUDED."settings",
  "updatedAt" = CURRENT_TIMESTAMP;
