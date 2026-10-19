-- Bomb Path phases 0-3: game registration and versioned authoritative policy.
-- Match state, fields, commitments, step events and replay data live in the
-- existing Match.metadata/MatchEvent lifecycle; no game-specific table is
-- needed until replay volume justifies one.

INSERT INTO "GameDefinition" ("id", "key", "name", "active", "modePolicy", "createdAt", "updatedAt")
VALUES (
  gen_random_uuid(),
  'bomb_path',
  'Bomb Path',
  true,
  '{"rulesVersion":"bomb-path.v1","generationVersion":"bomb-path-field.v1","roundCount":5,"casualEnabled":true,"rankedEnabled":false,"practiceEnabled":true,"casualBotEnabled":true,"rankedBotFallback":false,"killSwitch":false,"rolloutPercentage":100,"authoritative":true}'::jsonb,
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
  gen_random_uuid(), "id", 1, true, 'bomb_path_xp', 'bomb_path_elo', 'GLD',
  1.0, 100, 1000, 50, 0, 0, 0, 1, 250000, 0, 0, 0,
  '{"SUCCESS":1,"BOMB_HIT":0,"TIMEOUT":0,"INCOMPLETE":0}'::jsonb, 0, 8, 60, 0,
  0, false, 1.0, 1.0, 1.0,
  '{"authoritative":true,"bombPathPolicy":{"enabled":true,"killSwitch":false,"rolloutPercentage":100,"visibleName":"Bomb Path","rulesVersion":"bomb-path.v1","generationVersion":"bomb-path-field.v1","policyVersion":"bomb-path-policy.v1","roundCount":5,"gridSizeEarly":5,"gridSizeLate":7,"bombCountEarly":2,"bombCountLate":10,"memorizeDurationMs":3500,"playDurationMs":8000,"roundResultDurationMs":900,"matchDurationSeconds":60,"baseRoundScore":100,"speedBonusMax":50,"efficiencyBonusMax":25,"orthogonalOnly":true,"casualEnabled":true,"rankedEnabled":false,"practiceEnabled":true,"casualBotEnabled":true,"rankedBotFallback":false,"bot":{"enabled":true,"reactionDelayMs":900,"stepDelayMs":420,"jitterMs":160,"errorRate":0.08,"skill":0.7}}}'::jsonb,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "GameDefinition"
WHERE "key" = 'bomb_path'
  AND NOT EXISTS (SELECT 1 FROM "GameConfig" WHERE "gameDefinitionId" = "GameDefinition"."id" AND "version" = 1);

UPDATE "GameConfig" config
SET "active" = true,
    "maxAnswerTimeSeconds" = 8,
    "maxMatchDurationSeconds" = 60,
    "maxQuestions" = 0,
    "rankingEnabled" = false,
    "updatedAt" = CURRENT_TIMESTAMP
FROM "GameDefinition" definition
WHERE config."gameDefinitionId" = definition."id"
  AND definition."key" = 'bomb_path'
  AND config."version" = 1;
