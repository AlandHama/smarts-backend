-- Referral rewards must preserve fractional GLD. The existing BIGINT columns
-- remain as compatibility floors for older reports and clients.
ALTER TABLE "Referral"
  ADD COLUMN "totalRewardedGldDecimal" DECIMAL(30, 6) NOT NULL DEFAULT 0;

UPDATE "Referral"
SET "totalRewardedGldDecimal" = "totalRewardedGld";

ALTER TABLE "ReferralReward"
  ADD COLUMN "grossAdRewardDecimal" DECIMAL(30, 6) NOT NULL DEFAULT 0,
  ADD COLUMN "rewardAmountDecimal" DECIMAL(30, 6) NOT NULL DEFAULT 0;

UPDATE "ReferralReward"
SET
  "grossAdRewardDecimal" = "grossAdReward",
  "rewardAmountDecimal" = "rewardAmount";
