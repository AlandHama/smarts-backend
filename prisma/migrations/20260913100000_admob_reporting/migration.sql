-- CreateEnum
CREATE TYPE "AdMobConnectionStatus" AS ENUM ('CONNECTED', 'DISCONNECTED', 'ERROR');

-- CreateTable
CREATE TABLE "AdMobConnection" (
    "id" UUID NOT NULL,
    "provider" VARCHAR(40) NOT NULL DEFAULT 'ADMOB',
    "publisherId" VARCHAR(80) NOT NULL,
    "googleAccountEmail" VARCHAR(255),
    "reportingTimezone" VARCHAR(80),
    "currencyCode" CHAR(3),
    "encryptedRefreshToken" TEXT NOT NULL,
    "status" "AdMobConnectionStatus" NOT NULL DEFAULT 'CONNECTED',
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSyncStartedAt" TIMESTAMP(3),
    "lastSyncAt" TIMESTAMP(3),
    "lastSyncError" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdMobConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdMobReportRow" (
    "id" UUID NOT NULL,
    "connectionId" UUID NOT NULL,
    "reportDate" DATE NOT NULL,
    "dimensionKey" VARCHAR(1000) NOT NULL,
    "appId" VARCHAR(160),
    "appName" VARCHAR(255),
    "platform" VARCHAR(40),
    "countryCode" CHAR(2),
    "format" VARCHAR(80),
    "adUnitId" VARCHAR(160),
    "adUnitName" VARCHAR(255),
    "adRequests" BIGINT NOT NULL DEFAULT 0,
    "matchedRequests" BIGINT NOT NULL DEFAULT 0,
    "impressions" BIGINT NOT NULL DEFAULT 0,
    "clicks" BIGINT NOT NULL DEFAULT 0,
    "estimatedEarningsMicros" BIGINT NOT NULL DEFAULT 0,
    "impressionCtrBps" INTEGER NOT NULL DEFAULT 0,
    "impressionRpmMicros" BIGINT NOT NULL DEFAULT 0,
    "matchRateBps" INTEGER NOT NULL DEFAULT 0,
    "showRateBps" INTEGER NOT NULL DEFAULT 0,
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdMobReportRow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AdMobConnection_provider_key" ON "AdMobConnection"("provider");
CREATE UNIQUE INDEX "AdMobConnection_publisherId_key" ON "AdMobConnection"("publisherId");
CREATE INDEX "AdMobConnection_status_idx" ON "AdMobConnection"("status");
CREATE INDEX "AdMobConnection_lastSyncAt_idx" ON "AdMobConnection"("lastSyncAt");
CREATE UNIQUE INDEX "AdMobReportRow_connectionId_reportDate_dimensionKey_key" ON "AdMobReportRow"("connectionId", "reportDate", "dimensionKey");
CREATE INDEX "AdMobReportRow_connectionId_reportDate_idx" ON "AdMobReportRow"("connectionId", "reportDate");
CREATE INDEX "AdMobReportRow_reportDate_idx" ON "AdMobReportRow"("reportDate");
CREATE INDEX "AdMobReportRow_appId_reportDate_idx" ON "AdMobReportRow"("appId", "reportDate");
CREATE INDEX "AdMobReportRow_adUnitId_reportDate_idx" ON "AdMobReportRow"("adUnitId", "reportDate");
CREATE INDEX "AdMobReportRow_countryCode_reportDate_idx" ON "AdMobReportRow"("countryCode", "reportDate");

-- AddForeignKey
ALTER TABLE "AdMobReportRow" ADD CONSTRAINT "AdMobReportRow_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "AdMobConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
