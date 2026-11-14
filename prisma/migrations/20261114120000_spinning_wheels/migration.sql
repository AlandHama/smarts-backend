CREATE TABLE "SpinningWheel" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "key" VARCHAR(80) NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "description" TEXT,
  "themeKey" VARCHAR(40) NOT NULL DEFAULT 'royal_crown',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "purchasePriceGld" BIGINT NOT NULL DEFAULT 0,
  "dailyEnabled" BOOLEAN NOT NULL DEFAULT true,
  "dailyQuantity" INTEGER NOT NULL DEFAULT 1,
  "levelUpEnabled" BOOLEAN NOT NULL DEFAULT false,
  "levelUpQuantity" INTEGER NOT NULL DEFAULT 1,
  "rankUpEnabled" BOOLEAN NOT NULL DEFAULT false,
  "rankUpQuantity" INTEGER NOT NULL DEFAULT 1,
  "matchWinEnabled" BOOLEAN NOT NULL DEFAULT false,
  "matchWinQuantity" INTEGER NOT NULL DEFAULT 1,
  "segments" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SpinningWheel_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SpinningWheel_key_key" ON "SpinningWheel"("key");
CREATE INDEX "SpinningWheel_active_key_idx" ON "SpinningWheel"("active", "key");

CREATE TABLE "SpinningWheelInventory" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "wheelId" UUID NOT NULL,
  "quantity" INTEGER NOT NULL DEFAULT 0,
  "totalSpins" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SpinningWheelInventory_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SpinningWheelInventory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SpinningWheelInventory_wheelId_fkey" FOREIGN KEY ("wheelId") REFERENCES "SpinningWheel"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SpinningWheelInventory_userId_wheelId_key" ON "SpinningWheelInventory"("userId", "wheelId");
CREATE INDEX "SpinningWheelInventory_userId_quantity_idx" ON "SpinningWheelInventory"("userId", "quantity");

CREATE TABLE "SpinningWheelGrant" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "wheelId" UUID NOT NULL,
  "trigger" VARCHAR(30) NOT NULL,
  "sourceId" VARCHAR(255) NOT NULL,
  "quantity" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SpinningWheelGrant_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SpinningWheelGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SpinningWheelGrant_wheelId_fkey" FOREIGN KEY ("wheelId") REFERENCES "SpinningWheel"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SpinningWheelGrant_userId_wheelId_trigger_sourceId_key" ON "SpinningWheelGrant"("userId", "wheelId", "trigger", "sourceId");
CREATE INDEX "SpinningWheelGrant_userId_createdAt_idx" ON "SpinningWheelGrant"("userId", "createdAt");

CREATE TABLE "SpinningWheelSpin" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "wheelId" UUID NOT NULL,
  "rewardType" VARCHAR(20) NOT NULL,
  "rewardAmount" BIGINT NOT NULL,
  "source" VARCHAR(30) NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'GRANTED',
  "claimTokenHash" CHAR(64),
  "expiresAt" TIMESTAMP(3),
  "claimedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SpinningWheelSpin_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SpinningWheelSpin_claimTokenHash_key" UNIQUE ("claimTokenHash"),
  CONSTRAINT "SpinningWheelSpin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SpinningWheelSpin_wheelId_fkey" FOREIGN KEY ("wheelId") REFERENCES "SpinningWheel"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "SpinningWheelSpin_userId_createdAt_idx" ON "SpinningWheelSpin"("userId", "createdAt");
CREATE INDEX "SpinningWheelSpin_userId_status_idx" ON "SpinningWheelSpin"("userId", "status");

INSERT INTO "SpinningWheel" ("key", "name", "description", "themeKey", "purchasePriceGld", "dailyEnabled", "dailyQuantity", "segments", "updatedAt")
VALUES ('royal_crown', 'Royal Crown', 'A premium daily Lucky Spin for GLD, XP, and Skip Gems.', 'royal_crown', 10, true, 1,
  '[{"type":"GLD","amount":"300","weight":1},{"type":"XP","amount":"200","weight":1},{"type":"SKIP_GEM","amount":"1","weight":1},{"type":"GLD","amount":"150","weight":1},{"type":"XP","amount":"500","weight":1},{"type":"SKIP_GEM","amount":"2","weight":1},{"type":"GLD","amount":"50","weight":1},{"type":"XP","amount":"100","weight":1}]'::jsonb,
  CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
