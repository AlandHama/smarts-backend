-- Ranking arenas are available for every active game by default. Admins can
-- still turn individual games off later through Game config.
UPDATE "GameConfig"
SET "rankingEnabled" = true,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "active" = true;
