ALTER TABLE "SocialGiftDefinition"
  ADD COLUMN "priceGldDecimal" DECIMAL(30,6) NOT NULL DEFAULT 0;

UPDATE "SocialGiftDefinition"
SET "priceGldDecimal" = "priceGld";

ALTER TABLE "PlayerGift"
  ADD COLUMN "gldPriceDecimal" DECIMAL(30,6) NOT NULL DEFAULT 0;

UPDATE "PlayerGift"
SET "gldPriceDecimal" = "gldPrice";
