-- Authoritative games use isolated progression keys in their GameConfig rows.
-- The original game migrations created those configs but only the generic
-- `main` and `elo` progression definitions existed, which made matchmaking
-- reject the games as having incomplete reward configuration.
INSERT INTO "ProgressionDefinition" ("key", "name", "kind", "active", "allowNegative", "resetPolicy", "updatedAt")
VALUES
  ('gem_blitz_xp', 'Gem Blitz XP', 'LEVEL', true, false, 'NEVER', CURRENT_TIMESTAMP),
  ('gem_blitz_elo', 'Gem Blitz Rating', 'RATING', true, true, 'MANUAL', CURRENT_TIMESTAMP),
  ('tile_rush_xp', 'Tile Rush XP', 'LEVEL', true, false, 'NEVER', CURRENT_TIMESTAMP),
  ('tile_rush_elo', 'Tile Rush Rating', 'RATING', true, true, 'MANUAL', CURRENT_TIMESTAMP),
  ('word_dash_xp', 'Word Dash XP', 'LEVEL', true, false, 'NEVER', CURRENT_TIMESTAMP),
  ('word_dash_elo', 'Word Dash Rating', 'RATING', true, true, 'MANUAL', CURRENT_TIMESTAMP),
  ('domino_xp', 'Domino XP', 'LEVEL', true, false, 'NEVER', CURRENT_TIMESTAMP),
  ('domino_elo', 'Domino Rating', 'RATING', true, true, 'MANUAL', CURRENT_TIMESTAMP),
  ('perfect_timing_xp', 'Perfect Timing XP', 'LEVEL', true, false, 'NEVER', CURRENT_TIMESTAMP),
  ('perfect_timing_elo', 'Perfect Timing Rating', 'RATING', true, true, 'MANUAL', CURRENT_TIMESTAMP),
  ('bomb_path_xp', 'Bomb Path XP', 'LEVEL', true, false, 'NEVER', CURRENT_TIMESTAMP),
  ('bomb_path_elo', 'Bomb Path Rating', 'RATING', true, true, 'MANUAL', CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "ProgressionTier" ("progressionId", "step", "pointsThreshold", "name", "updatedAt")
SELECT
  definition."id",
  1,
  0,
  CASE WHEN definition."kind" = 'LEVEL' THEN 'Beginner' ELSE 'Unranked' END,
  CURRENT_TIMESTAMP
FROM "ProgressionDefinition" definition
WHERE definition."key" IN (
  'gem_blitz_xp', 'gem_blitz_elo',
  'tile_rush_xp', 'tile_rush_elo',
  'word_dash_xp', 'word_dash_elo',
  'domino_xp', 'domino_elo',
  'perfect_timing_xp', 'perfect_timing_elo',
  'bomb_path_xp', 'bomb_path_elo'
)
AND NOT EXISTS (
  SELECT 1
  FROM "ProgressionTier" tier
  WHERE tier."progressionId" = definition."id"
    AND tier."step" = 1
);
