ALTER TABLE "User"
  ALTER COLUMN "username" TYPE VARCHAR(50),
  ALTER COLUMN "firstName" DROP NOT NULL,
  ALTER COLUMN "lastName" DROP NOT NULL;

ALTER TABLE "User"
  ADD COLUMN "firebaseUid" VARCHAR(255),
  ADD COLUMN "lootLockerPlayerId" VARCHAR(255);

CREATE UNIQUE INDEX "User_firebaseUid_key" ON "User"("firebaseUid");
CREATE UNIQUE INDEX "User_lootLockerPlayerId_key" ON "User"("lootLockerPlayerId");

ALTER TABLE "Session" ALTER COLUMN "isMobileSession" SET DEFAULT true;

CREATE TABLE "PlayerProfile" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "displayName" VARCHAR(50) NOT NULL,
    "avatarUrl" TEXT,
    "countryCode" VARCHAR(2),
    "bio" VARCHAR(250),
    "level" INTEGER NOT NULL DEFAULT 1,
    "xp" BIGINT NOT NULL DEFAULT 0,
    "elo" INTEGER NOT NULL DEFAULT 1000,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PlayerProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlayerStats" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "gamesPlayed" INTEGER NOT NULL DEFAULT 0,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "draws" INTEGER NOT NULL DEFAULT 0,
    "currentWinStreak" INTEGER NOT NULL DEFAULT 0,
    "highestWinStreak" INTEGER NOT NULL DEFAULT 0,
    "highestElo" INTEGER NOT NULL DEFAULT 1000,
    "totalScore" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PlayerStats_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlayerProfile_userId_key" ON "PlayerProfile"("userId");
CREATE INDEX "PlayerProfile_elo_idx" ON "PlayerProfile"("elo");
CREATE INDEX "PlayerProfile_level_idx" ON "PlayerProfile"("level");
CREATE INDEX "PlayerProfile_countryCode_idx" ON "PlayerProfile"("countryCode");
CREATE UNIQUE INDEX "PlayerStats_userId_key" ON "PlayerStats"("userId");

ALTER TABLE "PlayerProfile"
  ADD CONSTRAINT "PlayerProfile_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PlayerStats"
  ADD CONSTRAINT "PlayerStats_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
