ALTER TABLE "WalletBalance" ADD COLUMN "exactAmount" DECIMAL(30,6) NOT NULL DEFAULT 0;
UPDATE "WalletBalance" SET "exactAmount" = "amount";

ALTER TABLE "WalletTransaction" ADD COLUMN "exactAmount" DECIMAL(30,6) NOT NULL DEFAULT 0;
ALTER TABLE "WalletTransaction" ADD COLUMN "exactBalanceBefore" DECIMAL(30,6) NOT NULL DEFAULT 0;
ALTER TABLE "WalletTransaction" ADD COLUMN "exactBalanceAfter" DECIMAL(30,6) NOT NULL DEFAULT 0;
UPDATE "WalletTransaction" SET "exactAmount" = "amount", "exactBalanceBefore" = "balanceBefore", "exactBalanceAfter" = "balanceAfter";

ALTER TABLE "RewardGrant" ADD COLUMN "amountDecimal" DECIMAL(30,6);
UPDATE "RewardGrant" SET "amountDecimal" = "amount" WHERE "amount" IS NOT NULL;

ALTER TABLE "AdRewardClaim" ADD COLUMN "rewardAmountDecimal" DECIMAL(30,6);
UPDATE "AdRewardClaim" SET "rewardAmountDecimal" = "rewardAmount" WHERE "rewardAmount" IS NOT NULL;

ALTER TABLE "GldEmissionDay" ADD COLUMN "emittedAmountDecimal" DECIMAL(30,6) NOT NULL DEFAULT 0;
ALTER TABLE "GldEmissionDay" ADD COLUMN "adRewardAmountDecimal" DECIMAL(30,6) NOT NULL DEFAULT 0;
UPDATE "GldEmissionDay" SET "emittedAmountDecimal" = "emittedAmount", "adRewardAmountDecimal" = "adRewardAmount";

ALTER TABLE "GldPlayerDailyAdState" ADD COLUMN "gldEarnedDecimal" DECIMAL(30,6) NOT NULL DEFAULT 0;
UPDATE "GldPlayerDailyAdState" SET "gldEarnedDecimal" = "gldEarned";

ALTER TABLE "ProgressionTier" ADD COLUMN "adRewardBonusPercent" INTEGER NOT NULL DEFAULT 0;
