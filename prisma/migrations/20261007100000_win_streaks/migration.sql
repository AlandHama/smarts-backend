CREATE TABLE "WinStreakConfiguration" (
    "id" UUID NOT NULL,
    "key" VARCHAR(40) NOT NULL DEFAULT 'default',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "resetOnNonWin" BOOLEAN NOT NULL DEFAULT true,
    "maxBonusPercent" DECIMAL(20,6) NOT NULL DEFAULT 35,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WinStreakConfiguration_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WinStreakConfiguration_key_key" ON "WinStreakConfiguration"("key");

CREATE TABLE "WinStreakMilestone" (
    "id" UUID NOT NULL,
    "configurationId" UUID NOT NULL,
    "wins" INTEGER NOT NULL,
    "bonusPercent" DECIMAL(20,6) NOT NULL,
    "title" VARCHAR(120),
    "description" VARCHAR(300),
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WinStreakMilestone_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WinStreakMilestone_configurationId_wins_key" ON "WinStreakMilestone"("configurationId", "wins");
CREATE INDEX "WinStreakMilestone_configurationId_enabled_wins_idx" ON "WinStreakMilestone"("configurationId", "enabled", "wins");
ALTER TABLE "WinStreakMilestone" ADD CONSTRAINT "WinStreakMilestone_configurationId_fkey" FOREIGN KEY ("configurationId") REFERENCES "WinStreakConfiguration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "WinStreakConfiguration" ("id", "key", "enabled", "resetOnNonWin", "maxBonusPercent", "createdAt", "updatedAt")
VALUES (gen_random_uuid(), 'default', true, true, 35, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "WinStreakMilestone" ("id", "configurationId", "wins", "bonusPercent", "title", "description", "enabled", "sortOrder", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", seed.wins, seed.bonus, seed.title, seed.description, true, seed.sort_order, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "WinStreakConfiguration"
CROSS JOIN (VALUES
  (1, 0::numeric, 'First flame', 'Win your first match to light the streak.', 10),
  (3, 3::numeric, 'Three-win spark', 'Keep winning to make your ad rewards stronger.', 20),
  (5, 5::numeric, 'On fire', 'Five consecutive wins puts you on fire.', 30),
  (7, 8::numeric, 'Hot hand', 'A full week of wins.', 40),
  (10, 12::numeric, 'Unstoppable', 'Ten consecutive wins.', 50),
  (20, 20::numeric, 'Win machine', 'Twenty consecutive wins.', 60),
  (50, 30::numeric, 'Legendary run', 'The ultimate configured win streak.', 70)
) AS seed(wins, bonus, title, description, sort_order)
WHERE "key" = 'default'
ON CONFLICT ("configurationId", "wins") DO NOTHING;
