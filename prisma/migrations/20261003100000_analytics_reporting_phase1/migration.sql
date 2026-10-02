CREATE TABLE "AnalyticsEvent" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "eventName" VARCHAR(120) NOT NULL,
    "eventVersion" INTEGER NOT NULL DEFAULT 1,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "playerId" UUID,
    "sessionId" UUID,
    "matchId" UUID,
    "requestId" UUID,
    "platform" VARCHAR(32),
    "appVersion" VARCHAR(32),
    "countryCode" VARCHAR(8),
    "properties" JSONB,
    "privacyClass" VARCHAR(20) NOT NULL DEFAULT 'OPERATIONAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AnalyticsEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AnalyticsDailyAggregate" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "day" DATE NOT NULL,
    "metricKey" VARCHAR(120) NOT NULL,
    "dimensionKey" VARCHAR(255) NOT NULL DEFAULT 'all',
    "dimensions" JSONB,
    "value" DECIMAL(30,6) NOT NULL,
    "definitionVersion" INTEGER NOT NULL DEFAULT 1,
    "refreshedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AnalyticsDailyAggregate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AnalyticsHourlyAggregate" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "hour" TIMESTAMP(3) NOT NULL,
    "metricKey" VARCHAR(120) NOT NULL,
    "dimensionKey" VARCHAR(255) NOT NULL DEFAULT 'all',
    "dimensions" JSONB,
    "value" DECIMAL(30,6) NOT NULL,
    "definitionVersion" INTEGER NOT NULL DEFAULT 1,
    "refreshedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AnalyticsHourlyAggregate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AnalyticsRefreshState" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "key" VARCHAR(80) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "definitionVersion" INTEGER NOT NULL DEFAULT 1,
    "dataThrough" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AnalyticsRefreshState_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AnalyticsEvent_eventName_occurredAt_idx" ON "AnalyticsEvent"("eventName", "occurredAt");
CREATE INDEX "AnalyticsEvent_playerId_occurredAt_idx" ON "AnalyticsEvent"("playerId", "occurredAt");
CREATE INDEX "AnalyticsEvent_platform_appVersion_occurredAt_idx" ON "AnalyticsEvent"("platform", "appVersion", "occurredAt");
CREATE INDEX "AnalyticsEvent_countryCode_occurredAt_idx" ON "AnalyticsEvent"("countryCode", "occurredAt");
CREATE INDEX "AnalyticsEvent_receivedAt_idx" ON "AnalyticsEvent"("receivedAt");
CREATE UNIQUE INDEX "AnalyticsDailyAggregate_day_metricKey_dimensionKey_key" ON "AnalyticsDailyAggregate"("day", "metricKey", "dimensionKey");
CREATE INDEX "AnalyticsDailyAggregate_metricKey_day_idx" ON "AnalyticsDailyAggregate"("metricKey", "day");
CREATE INDEX "AnalyticsDailyAggregate_day_idx" ON "AnalyticsDailyAggregate"("day");
CREATE UNIQUE INDEX "AnalyticsHourlyAggregate_hour_metricKey_dimensionKey_key" ON "AnalyticsHourlyAggregate"("hour", "metricKey", "dimensionKey");
CREATE INDEX "AnalyticsHourlyAggregate_metricKey_hour_idx" ON "AnalyticsHourlyAggregate"("metricKey", "hour");
CREATE INDEX "AnalyticsHourlyAggregate_hour_idx" ON "AnalyticsHourlyAggregate"("hour");
CREATE UNIQUE INDEX "AnalyticsRefreshState_key_key" ON "AnalyticsRefreshState"("key");

ALTER TABLE "AnalyticsEvent" ADD CONSTRAINT "AnalyticsEvent_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "AnalyticsRefreshState" ("key", "updatedAt")
VALUES ('server-events', CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
