CREATE TABLE "GldAdRewardPolicy" (
    "id" UUID NOT NULL,
    "adFormat" VARCHAR(40) NOT NULL,
    "eventType" VARCHAR(20) NOT NULL,
    "regionCode" VARCHAR(16) NOT NULL DEFAULT 'DEFAULT',
    "rewardAmount" BIGINT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GldAdRewardPolicy_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GldAdRewardPolicy_adFormat_eventType_regionCode_key"
ON "GldAdRewardPolicy"("adFormat", "eventType", "regionCode");

CREATE INDEX "GldAdRewardPolicy_adFormat_eventType_enabled_idx"
ON "GldAdRewardPolicy"("adFormat", "eventType", "enabled");

CREATE INDEX "GldAdRewardPolicy_regionCode_enabled_idx"
ON "GldAdRewardPolicy"("regionCode", "enabled");

-- Safe starter rows. Administrators can change or disable these from the GLD
-- economy page; DEFAULT applies when no country-specific row exists.
INSERT INTO "GldAdRewardPolicy" ("id", "adFormat", "eventType", "regionCode", "rewardAmount", "updatedAt") VALUES
  (gen_random_uuid(), 'banner', 'impression', 'DEFAULT', 1, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'banner', 'click', 'DEFAULT', 1, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'native', 'impression', 'DEFAULT', 1, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'native', 'click', 'DEFAULT', 1, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'interstitial', 'impression', 'DEFAULT', 2, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'interstitial', 'click', 'DEFAULT', 2, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'rewarded', 'rewarded', 'DEFAULT', 10, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'rewarded_interstitial', 'rewarded', 'DEFAULT', 10, CURRENT_TIMESTAMP);
