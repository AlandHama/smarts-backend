-- Avatar frames are server-owned cosmetics. Keep this migration separate from
-- the seed migration so deployments that already applied the seed can recover.
ALTER TABLE "PlayerProfile"
ADD COLUMN IF NOT EXISTS "avatarFrameKey" VARCHAR(80);
