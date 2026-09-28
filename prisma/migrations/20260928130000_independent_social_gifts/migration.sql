CREATE TABLE "SocialGiftDefinition" (
    "id" UUID NOT NULL,
    "key" VARCHAR(80) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "icon" VARCHAR(16),
    "description" TEXT,
    "imageUrl" TEXT,
    "priceGld" BIGINT NOT NULL,
    "recipientRewardBps" INTEGER NOT NULL DEFAULT 5000,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SocialGiftDefinition_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SocialGiftDefinition_key_key" ON "SocialGiftDefinition"("key");
CREATE INDEX "SocialGiftDefinition_active_sortOrder_idx" ON "SocialGiftDefinition"("active", "sortOrder");

INSERT INTO "SocialGiftDefinition" ("id", "key", "name", "icon", "description", "priceGld", "recipientRewardBps", "active", "sortOrder", "createdAt", "updatedAt") VALUES
  ('9c4d6a2e-8c5b-4f07-a3dd-000000000001', 'rose', 'Rose', '🌹', 'A little appreciation for a great player.', 5, 5000, true, 10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('9c4d6a2e-8c5b-4f07-a3dd-000000000002', 'heart', 'Heart', '❤️', 'Send some love.', 10, 5000, true, 20, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('9c4d6a2e-8c5b-4f07-a3dd-000000000003', 'cake', 'Cake', '🎂', 'Celebrate a memorable match.', 25, 5000, true, 30, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('9c4d6a2e-8c5b-4f07-a3dd-000000000004', 'crown', 'Crown', '👑', 'For a truly legendary performance.', 50, 5000, true, 40, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('9c4d6a2e-8c5b-4f07-a3dd-000000000005', 'diamond', 'Diamond', '💎', 'A premium show of support.', 100, 5000, true, 50, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('9c4d6a2e-8c5b-4f07-a3dd-000000000006', 'rocket', 'Rocket', '🚀', 'Boost your friend to the top.', 250, 5000, true, 60, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

ALTER TABLE "PlayerGift" ALTER COLUMN "catalogItemId" DROP NOT NULL;
ALTER TABLE "PlayerGift" ADD COLUMN "socialGiftDefinitionId" UUID;
CREATE INDEX "PlayerGift_socialGiftDefinitionId_idx" ON "PlayerGift"("socialGiftDefinitionId");

ALTER TABLE "PlayerGift"
  ADD CONSTRAINT "PlayerGift_socialGiftDefinitionId_fkey"
  FOREIGN KEY ("socialGiftDefinitionId") REFERENCES "SocialGiftDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
