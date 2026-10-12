ALTER TABLE "CryptoRewardConfig"
ADD COLUMN "assetRates" JSONB NOT NULL DEFAULT '{}'::jsonb;
