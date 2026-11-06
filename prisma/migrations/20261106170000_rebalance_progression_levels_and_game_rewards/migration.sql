-- Keep progression pace consistent across every game while preserving each
-- game's own raw score and rating rules.

-- The supplied level table is the single authoritative XP curve for every
-- LEVEL progression, including the main profile progression and each game's
-- isolated XP progression.
--
-- These are intentionally regular helper tables rather than ON COMMIT DROP
-- temporary tables. Railway's Prisma migration runner can commit between SQL
-- statements; an ON COMMIT DROP table would disappear before the next UPDATE.
-- The tables are removed at the end and also cleared at the start so a retry
-- after a failed deployment is safe.
DROP TABLE IF EXISTS "_SmartsLevelTierMap";
DROP TABLE IF EXISTS "_SmartsLevelThresholds";

CREATE TABLE "_SmartsLevelTierMap" AS
SELECT
  tier."id",
  tier."progressionId",
  ROW_NUMBER() OVER (
    PARTITION BY tier."progressionId"
    ORDER BY tier."step", tier."pointsThreshold", tier."id"
  )::INTEGER AS "ordinal"
FROM "ProgressionTier" tier
JOIN "ProgressionDefinition" definition
  ON definition."id" = tier."progressionId"
WHERE definition."kind" = 'LEVEL';

-- Move existing rows away from both unique constraints before assigning the
-- new step/threshold pairs. The ordinal is stable within each progression.
UPDATE "ProgressionTier" tier
SET
  "step" = 10000 + mapping."ordinal",
  "pointsThreshold" = -1000000000000::BIGINT - mapping."ordinal",
  "updatedAt" = CURRENT_TIMESTAMP
FROM "_SmartsLevelTierMap" mapping
WHERE mapping."id" = tier."id";

CREATE TABLE "_SmartsLevelThresholds" (
  "step" INTEGER PRIMARY KEY,
  "pointsThreshold" BIGINT NOT NULL
);

INSERT INTO "_SmartsLevelThresholds" ("step", "pointsThreshold")
VALUES
  (1, 0),
  (2, 400),
  (3, 1600),
  (4, 3600),
  (5, 6400),
  (6, 10000),
  (7, 14400),
  (8, 19600),
  (9, 25600),
  (10, 32400),
  (11, 40000),
  (12, 48400),
  (13, 57600),
  (14, 67600),
  (15, 78400),
  (16, 90000),
  (17, 102400),
  (18, 115600),
  (19, 129600),
  (20, 144400),
  (21, 160000),
  (22, 208500),
  (23, 260500),
  (24, 316000),
  (25, 375000),
  (26, 437500),
  (27, 503500),
  (28, 573000),
  (29, 646000),
  (30, 722500),
  (31, 802500),
  (32, 884000),
  (33, 967000),
  (34, 1051500),
  (35, 1137500),
  (36, 1225000),
  (37, 1314000),
  (38, 1404500),
  (39, 1496500),
  (40, 1590000),
  (41, 1685000),
  (42, 1781500),
  (43, 1879500),
  (44, 1979000),
  (45, 2080000),
  (46, 2182500),
  (47, 2286500),
  (48, 2392000),
  (49, 2499000),
  (50, 2607500),
  (51, 2717500),
  (52, 2829000),
  (53, 2942000),
  (54, 3056500),
  (55, 3172500),
  (56, 3290000),
  (57, 3409000),
  (58, 3529500),
  (59, 3651500),
  (60, 3775000),
  (61, 3900000),
  (62, 4026500),
  (63, 4154500),
  (64, 4284000),
  (65, 4415000),
  (66, 4547500),
  (67, 4681500),
  (68, 4817000),
  (69, 4954000),
  (70, 5092500),
  (71, 5232500),
  (72, 5374000),
  (73, 5517000),
  (74, 5661500),
  (75, 5807500),
  (76, 5955000),
  (77, 6104000),
  (78, 6254500),
  (79, 6406500),
  (80, 6560000),
  (81, 6715000),
  (82, 6871500),
  (83, 7029500),
  (84, 7189000),
  (85, 7350000),
  (86, 7512500),
  (87, 7676500),
  (88, 7842000),
  (89, 8009000),
  (90, 8177500),
  (91, 8347500),
  (92, 8519000),
  (93, 8692000),
  (94, 8866500),
  (95, 9042500),
  (96, 9220000),
  (97, 9399000),
  (98, 9579500),
  (99, 9761500),
  (100, 9945000);

UPDATE "ProgressionTier" tier
SET
  "step" = thresholds."step",
  "pointsThreshold" = thresholds."pointsThreshold",
  "updatedAt" = CURRENT_TIMESTAMP
FROM "_SmartsLevelTierMap" mapping
JOIN "_SmartsLevelThresholds" thresholds
  ON thresholds."step" = mapping."ordinal"
WHERE mapping."id" = tier."id"
  AND mapping."ordinal" <= 100;

INSERT INTO "ProgressionTier" (
  "progressionId",
  "step",
  "pointsThreshold",
  "name",
  "updatedAt"
)
SELECT
  definition."id",
  thresholds."step",
  thresholds."pointsThreshold",
  CASE WHEN thresholds."step" = 1 THEN 'Beginner' ELSE 'Level ' || thresholds."step" END,
  CURRENT_TIMESTAMP
FROM "ProgressionDefinition" definition
CROSS JOIN "_SmartsLevelThresholds" thresholds
WHERE definition."kind" = 'LEVEL'
  AND NOT EXISTS (
    SELECT 1
    FROM "_SmartsLevelTierMap" mapping
    WHERE mapping."progressionId" = definition."id"
      AND mapping."ordinal" = thresholds."step"
  );

-- Reconcile cached level pointers without changing a player's accumulated XP.
UPDATE "PlayerProgression" player
SET
  "step" = tier."step",
  "previousThreshold" = tier."pointsThreshold",
  "nextThreshold" = (
    SELECT MIN(nextTier."pointsThreshold")
    FROM "ProgressionTier" nextTier
    WHERE nextTier."progressionId" = player."progressionId"
      AND nextTier."pointsThreshold" > tier."pointsThreshold"
  ),
  "updatedAt" = CURRENT_TIMESTAMP
FROM "ProgressionTier" tier
JOIN "ProgressionDefinition" definition
  ON definition."id" = tier."progressionId"
WHERE player."progressionId" = tier."progressionId"
  AND definition."kind" = 'LEVEL'
  AND tier."pointsThreshold" = (
    SELECT MAX(currentTier."pointsThreshold")
    FROM "ProgressionTier" currentTier
    WHERE currentTier."progressionId" = player."progressionId"
      AND currentTier."pointsThreshold" <= player."points"
  );

UPDATE "PlayerProfile" profile
SET
  "level" = player."step",
  "xp" = player."points",
  "updatedAt" = CURRENT_TIMESTAMP
FROM "PlayerProgression" player
JOIN "ProgressionDefinition" definition
  ON definition."id" = player."progressionId"
WHERE profile."userId" = player."userId"
  AND definition."key" = 'main'
  AND definition."kind" = 'LEVEL';

-- Normalize match XP by each game's normal score range. The shared XP envelope
-- makes a completed match worth a comparable amount regardless of game type;
-- expectedScore is the only game-specific factor.
UPDATE "GameConfig" config
SET
  "settings" = COALESCE(config."settings", '{}'::JSONB)
    || jsonb_build_object(
      'rewardIntegrity',
      COALESCE(config."settings" -> 'rewardIntegrity', '{}'::JSONB)
        || jsonb_build_object(
          'expectedScore', CASE definition."key"
            WHEN 'gem_blitz' THEN 15000
            WHEN 'tile_rush' THEN 15000
            WHEN 'word_dash' THEN 2000
            WHEN 'domino' THEN 100
            WHEN 'perfect_timing' THEN 1000
            WHEN 'bomb_path' THEN 1000
            ELSE 1500
          END,
          'scoreNormalizationFactor', CASE definition."key"
            WHEN 'gem_blitz' THEN 1.0 / 15000
            WHEN 'tile_rush' THEN 1.0 / 15000
            WHEN 'word_dash' THEN 1.0 / 2000
            WHEN 'domino' THEN 1.0 / 100
            WHEN 'perfect_timing' THEN 1.0 / 1000
            WHEN 'bomb_path' THEN 1.0 / 1000
            ELSE 1.0 / 1500
          END,
          'maximumMatchXp', 240,
          'minimumCompletionXp', 25,
          'participationXp', 25,
          'winnerXpBonus', 35,
          'loserXpBonus', 15,
          'drawXpBonus', 25,
          'timeoutXp', 8
        )
    ),
  "updatedAt" = CURRENT_TIMESTAMP
FROM "GameDefinition" definition
WHERE config."gameDefinitionId" = definition."id"
  AND config."active" = true
  AND definition."key" IN (
    'trivia', 'math', 'flick_master', 'high_low', 'stacking',
    'similarities', 'follow_the_lead', 'memorize_cards', 'bird_watching',
    'gem_blitz', 'tile_rush', 'word_dash', 'domino', 'perfect_timing', 'bomb_path'
  );

DROP TABLE IF EXISTS "_SmartsLevelTierMap";
DROP TABLE IF EXISTS "_SmartsLevelThresholds";
