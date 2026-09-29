CREATE TABLE "StreakConfiguration" (
    "id" UUID NOT NULL,
    "key" VARCHAR(40) NOT NULL DEFAULT 'default',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "qualifyingActivity" VARCHAR(40) NOT NULL DEFAULT 'MATCH_COMPLETED',
    "timezone" VARCHAR(40) NOT NULL DEFAULT 'UTC',
    "maxBonusPercent" INTEGER NOT NULL DEFAULT 30,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StreakConfiguration_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StreakConfiguration_key_key" ON "StreakConfiguration"("key");

CREATE TABLE "StreakMilestone" (
    "id" UUID NOT NULL,
    "configurationId" UUID NOT NULL,
    "day" INTEGER NOT NULL,
    "bonusPercent" INTEGER NOT NULL,
    "title" VARCHAR(120),
    "description" VARCHAR(300),
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StreakMilestone_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StreakMilestone_configurationId_day_key" ON "StreakMilestone"("configurationId", "day");
CREATE INDEX "StreakMilestone_configurationId_enabled_day_idx" ON "StreakMilestone"("configurationId", "enabled", "day");
ALTER TABLE "StreakMilestone" ADD CONSTRAINT "StreakMilestone_configurationId_fkey" FOREIGN KEY ("configurationId") REFERENCES "StreakConfiguration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PlayerDailyStreak" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "currentDays" INTEGER NOT NULL DEFAULT 0,
    "longestDays" INTEGER NOT NULL DEFAULT 0,
    "lastQualifiedDate" DATE,
    "lastQualifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PlayerDailyStreak_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlayerDailyStreak_userId_key" ON "PlayerDailyStreak"("userId");
CREATE INDEX "PlayerDailyStreak_lastQualifiedDate_idx" ON "PlayerDailyStreak"("lastQualifiedDate");
ALTER TABLE "PlayerDailyStreak" ADD CONSTRAINT "PlayerDailyStreak_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "StreakActivity" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "streakId" UUID NOT NULL,
    "activityType" VARCHAR(40) NOT NULL,
    "activityDate" DATE NOT NULL,
    "sourceId" VARCHAR(255) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StreakActivity_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StreakActivity_userId_activityType_activityDate_key" ON "StreakActivity"("userId", "activityType", "activityDate");
CREATE UNIQUE INDEX "StreakActivity_userId_activityType_sourceId_key" ON "StreakActivity"("userId", "activityType", "sourceId");
CREATE INDEX "StreakActivity_userId_activityDate_idx" ON "StreakActivity"("userId", "activityDate");
ALTER TABLE "StreakActivity" ADD CONSTRAINT "StreakActivity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StreakActivity" ADD CONSTRAINT "StreakActivity_streakId_fkey" FOREIGN KEY ("streakId") REFERENCES "PlayerDailyStreak"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "StreakConfiguration" ("id", "updatedAt") VALUES (gen_random_uuid(), CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "StreakMilestone" ("id", "configurationId", "day", "bonusPercent", "title", "description", "sortOrder", "updatedAt")
SELECT gen_random_uuid(), "id", v.day, v.bonus, v.title, v.description, v.sort_order, CURRENT_TIMESTAMP
FROM "StreakConfiguration"
CROSS JOIN (VALUES
  (1, 0, 'Getting started', 'Qualify today to start your streak.', 10),
  (3, 3, 'Three-day spark', 'Keep showing up for a stronger ad reward.', 20),
  (7, 7, 'One-week flame', 'A full week of qualifying activity.', 30),
  (14, 12, 'Fortnight focus', 'Two weeks of consistent play.', 40),
  (30, 20, 'Monthly momentum', 'A month of keeping the flame alive.', 50),
  (60, 25, 'Unstoppable', 'Two months of daily activity.', 60),
  (100, 30, 'Century streak', 'The maximum configured ad bonus.', 70)
) AS v(day, bonus, title, description, sort_order)
WHERE "key" = 'default'
ON CONFLICT ("configurationId", "day") DO NOTHING;
