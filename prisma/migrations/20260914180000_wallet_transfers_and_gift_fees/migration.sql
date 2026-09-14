ALTER TABLE "GldAdminControl" ADD COLUMN "gldTransferFeeBps" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "PlayerGift" ADD COLUMN "giftFeeAmount" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "PlayerGift" ADD COLUMN "chargedAmount" BIGINT NOT NULL DEFAULT 0;
UPDATE "PlayerGift" SET "chargedAmount" = "gldPrice" WHERE "chargedAmount" = 0;
