ALTER TABLE "PlayerProfile" ADD COLUMN "usernameChangeCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PlayerProfile" ADD COLUMN "displayNameChangeCount" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "GldAdminControl" ADD COLUMN "usernameChangeCostGld" BIGINT;
ALTER TABLE "GldAdminControl" ADD COLUMN "displayNameChangeCostGld" BIGINT;
