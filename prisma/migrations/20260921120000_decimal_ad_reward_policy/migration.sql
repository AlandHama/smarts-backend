ALTER TABLE "GldAdRewardPolicy"
ADD COLUMN "rewardAmountDecimal" DECIMAL(20,6);

UPDATE "GldAdRewardPolicy"
SET "rewardAmountDecimal" = "rewardAmount";
