ALTER TABLE "PlayerProfile" ADD COLUMN "countryChangeCount" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "GldAdminControl" ADD COLUMN "countryChangeCostGld" BIGINT;
