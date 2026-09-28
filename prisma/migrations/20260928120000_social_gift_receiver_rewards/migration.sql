ALTER TABLE "PlayerGift" ADD COLUMN "recipientAmount" DECIMAL(30,6) NOT NULL DEFAULT 0;
ALTER TABLE "PlayerGift" ADD COLUMN "recipientRewardBps" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PlayerGift" ADD COLUMN "burnedAmountDecimal" DECIMAL(30,6) NOT NULL DEFAULT 0;
ALTER TABLE "PlayerGift" ADD COLUMN "retainedAmountDecimal" DECIMAL(30,6) NOT NULL DEFAULT 0;
UPDATE "PlayerGift" SET "burnedAmountDecimal" = "burnedAmount", "retainedAmountDecimal" = "retainedAmount";

ALTER TABLE "GldBurnEvent" ADD COLUMN "exactAmount" DECIMAL(30,6) NOT NULL DEFAULT 0;
UPDATE "GldBurnEvent" SET "exactAmount" = "amount";
