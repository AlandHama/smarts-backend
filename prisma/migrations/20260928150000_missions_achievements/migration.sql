CREATE TYPE "MissionPeriod" AS ENUM ('DAILY', 'WEEKLY');
CREATE TYPE "MissionStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'CLAIMED');

CREATE TABLE "EngagementEvent" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "eventType" VARCHAR(80) NOT NULL,
  "sourceId" VARCHAR(255) NOT NULL,
  "amount" INTEGER NOT NULL DEFAULT 1,
  "payload" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EngagementEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MissionDefinition" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "key" VARCHAR(80) NOT NULL,
  "title" VARCHAR(120) NOT NULL,
  "description" VARCHAR(300) NOT NULL,
  "icon" VARCHAR(40) NOT NULL DEFAULT 'target',
  "category" VARCHAR(40) NOT NULL DEFAULT 'daily',
  "eventType" VARCHAR(80) NOT NULL,
  "target" INTEGER NOT NULL,
  "period" "MissionPeriod" NOT NULL DEFAULT 'DAILY',
  "rewardGld" DECIMAL(30,6) NOT NULL DEFAULT 0,
  "rewardXp" BIGINT NOT NULL DEFAULT 0,
  "filters" JSONB,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "startsAt" TIMESTAMP(3),
  "endsAt" TIMESTAMP(3),
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MissionDefinition_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlayerMission" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "missionDefinitionId" UUID NOT NULL,
  "periodKey" VARCHAR(32) NOT NULL,
  "progress" INTEGER NOT NULL DEFAULT 0,
  "targetSnapshot" INTEGER NOT NULL,
  "status" "MissionStatus" NOT NULL DEFAULT 'ACTIVE',
  "completedAt" TIMESTAMP(3),
  "claimedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlayerMission_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AchievementDefinition" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "key" VARCHAR(80) NOT NULL,
  "title" VARCHAR(120) NOT NULL,
  "description" VARCHAR(300) NOT NULL,
  "icon" VARCHAR(40) NOT NULL DEFAULT 'trophy',
  "category" VARCHAR(40) NOT NULL DEFAULT 'general',
  "eventType" VARCHAR(80) NOT NULL,
  "filters" JSONB,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AchievementDefinition_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AchievementTier" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "achievementDefinitionId" UUID NOT NULL,
  "tier" INTEGER NOT NULL,
  "title" VARCHAR(100) NOT NULL,
  "target" INTEGER NOT NULL,
  "rewardGld" DECIMAL(30,6) NOT NULL DEFAULT 0,
  "rewardXp" BIGINT NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AchievementTier_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlayerAchievement" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "achievementDefinitionId" UUID NOT NULL,
  "progress" INTEGER NOT NULL DEFAULT 0,
  "completedTier" INTEGER NOT NULL DEFAULT 0,
  "claimedTier" INTEGER NOT NULL DEFAULT 0,
  "lastCompletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlayerAchievement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EngagementEvent_userId_eventType_sourceId_key" ON "EngagementEvent"("userId", "eventType", "sourceId");
CREATE INDEX "EngagementEvent_userId_eventType_createdAt_idx" ON "EngagementEvent"("userId", "eventType", "createdAt");
CREATE UNIQUE INDEX "MissionDefinition_key_key" ON "MissionDefinition"("key");
CREATE INDEX "MissionDefinition_enabled_period_sortOrder_idx" ON "MissionDefinition"("enabled", "period", "sortOrder");
CREATE INDEX "MissionDefinition_eventType_enabled_idx" ON "MissionDefinition"("eventType", "enabled");
CREATE UNIQUE INDEX "PlayerMission_userId_missionDefinitionId_periodKey_key" ON "PlayerMission"("userId", "missionDefinitionId", "periodKey");
CREATE INDEX "PlayerMission_userId_status_periodKey_idx" ON "PlayerMission"("userId", "status", "periodKey");
CREATE UNIQUE INDEX "AchievementDefinition_key_key" ON "AchievementDefinition"("key");
CREATE INDEX "AchievementDefinition_eventType_enabled_idx" ON "AchievementDefinition"("eventType", "enabled");
CREATE INDEX "AchievementDefinition_enabled_sortOrder_idx" ON "AchievementDefinition"("enabled", "sortOrder");
CREATE UNIQUE INDEX "AchievementTier_achievementDefinitionId_tier_key" ON "AchievementTier"("achievementDefinitionId", "tier");
CREATE INDEX "AchievementTier_achievementDefinitionId_target_idx" ON "AchievementTier"("achievementDefinitionId", "target");
CREATE UNIQUE INDEX "PlayerAchievement_userId_achievementDefinitionId_key" ON "PlayerAchievement"("userId", "achievementDefinitionId");
CREATE INDEX "PlayerAchievement_userId_completedTier_claimedTier_idx" ON "PlayerAchievement"("userId", "completedTier", "claimedTier");

ALTER TABLE "EngagementEvent" ADD CONSTRAINT "EngagementEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlayerMission" ADD CONSTRAINT "PlayerMission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlayerMission" ADD CONSTRAINT "PlayerMission_missionDefinitionId_fkey" FOREIGN KEY ("missionDefinitionId") REFERENCES "MissionDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AchievementTier" ADD CONSTRAINT "AchievementTier_achievementDefinitionId_fkey" FOREIGN KEY ("achievementDefinitionId") REFERENCES "AchievementDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlayerAchievement" ADD CONSTRAINT "PlayerAchievement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlayerAchievement" ADD CONSTRAINT "PlayerAchievement_achievementDefinitionId_fkey" FOREIGN KEY ("achievementDefinitionId") REFERENCES "AchievementDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
