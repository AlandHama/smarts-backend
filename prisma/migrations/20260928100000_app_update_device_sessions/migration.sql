-- App update policy, structured session device metadata, and single-device support.
CREATE TABLE "AppConfiguration" (
    "id" UUID NOT NULL,
    "key" VARCHAR(40) NOT NULL DEFAULT 'default',
    "productionVersion" VARCHAR(32) NOT NULL DEFAULT '1.0.0',
    "developmentVersion" VARCHAR(32) NOT NULL DEFAULT '1.0.0',
    "playStoreUrl" TEXT NOT NULL DEFAULT 'https://play.google.com/store/apps/details?id=com.pheonix.gaemverse',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AppConfiguration_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AppConfiguration_key_key" ON "AppConfiguration"("key");

ALTER TABLE "Session"
    ADD COLUMN "appBuildNumber" VARCHAR(32),
    ADD COLUMN "platform" VARCHAR(32),
    ADD COLUMN "osName" VARCHAR(40),
    ADD COLUMN "osVersion" VARCHAR(80),
    ADD COLUMN "deviceType" VARCHAR(40),
    ADD COLUMN "deviceModel" VARCHAR(120),
    ADD COLUMN "deviceManufacturer" VARCHAR(80),
    ADD COLUMN "deviceLocale" VARCHAR(40),
    ADD COLUMN "deviceTimezone" VARCHAR(80),
    ADD COLUMN "isPhysicalDevice" BOOLEAN;
