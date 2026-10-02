CREATE TABLE "AnalyticsReportDefinition" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "key" VARCHAR(80) NOT NULL, "name" VARCHAR(160) NOT NULL,
  "category" VARCHAR(40) NOT NULL, "description" VARCHAR(500) NOT NULL, "definitionVersion" INTEGER NOT NULL DEFAULT 1,
  "active" BOOLEAN NOT NULL DEFAULT true, "defaultResolution" VARCHAR(16) NOT NULL DEFAULT 'day', "permissions" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AnalyticsReportDefinition_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AnalyticsReportDefinition_key_key" ON "AnalyticsReportDefinition"("key");
CREATE INDEX "AnalyticsReportDefinition_category_active_idx" ON "AnalyticsReportDefinition"("category", "active");

CREATE TABLE "AnalyticsSavedReport" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "ownerId" UUID NOT NULL, "name" VARCHAR(160) NOT NULL,
  "reportKey" VARCHAR(80) NOT NULL, "visibility" VARCHAR(20) NOT NULL DEFAULT 'PRIVATE', "configuration" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AnalyticsSavedReport_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AnalyticsSavedReport_ownerId_updatedAt_idx" ON "AnalyticsSavedReport"("ownerId", "updatedAt");
CREATE INDEX "AnalyticsSavedReport_reportKey_visibility_idx" ON "AnalyticsSavedReport"("reportKey", "visibility");

CREATE TABLE "AnalyticsScheduledReport" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "savedReportId" UUID NOT NULL, "ownerId" UUID NOT NULL,
  "frequency" VARCHAR(16) NOT NULL, "timezone" VARCHAR(80) NOT NULL DEFAULT 'UTC', "sendAt" VARCHAR(5) NOT NULL DEFAULT '09:00',
  "recipients" JSONB NOT NULL, "formats" JSONB NOT NULL, "enabled" BOOLEAN NOT NULL DEFAULT true, "nextRunAt" TIMESTAMP(3),
  "lastRunAt" TIMESTAMP(3), "lastStatus" VARCHAR(20), "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AnalyticsScheduledReport_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AnalyticsScheduledReport_enabled_nextRunAt_idx" ON "AnalyticsScheduledReport"("enabled", "nextRunAt");
CREATE INDEX "AnalyticsScheduledReport_ownerId_updatedAt_idx" ON "AnalyticsScheduledReport"("ownerId", "updatedAt");

CREATE TABLE "AnalyticsAlertRule" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "key" VARCHAR(100) NOT NULL, "name" VARCHAR(160) NOT NULL,
  "metricKey" VARCHAR(120) NOT NULL, "condition" VARCHAR(16) NOT NULL, "threshold" DECIMAL(30,6) NOT NULL,
  "baselineWindow" INTEGER NOT NULL DEFAULT 7, "evaluationMinutes" INTEGER NOT NULL DEFAULT 15, "minimumSample" INTEGER NOT NULL DEFAULT 1,
  "severity" VARCHAR(16) NOT NULL DEFAULT 'WARNING', "cooldownMinutes" INTEGER NOT NULL DEFAULT 60, "recipients" JSONB NOT NULL,
  "activeFrom" TIMESTAMP(3), "activeUntil" TIMESTAMP(3), "enabled" BOOLEAN NOT NULL DEFAULT true,
  "lastEvaluatedAt" TIMESTAMP(3), "lastTriggeredAt" TIMESTAMP(3), "createdById" UUID NOT NULL, "updatedById" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AnalyticsAlertRule_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AnalyticsAlertRule_key_key" ON "AnalyticsAlertRule"("key");
CREATE INDEX "AnalyticsAlertRule_enabled_lastEvaluatedAt_idx" ON "AnalyticsAlertRule"("enabled", "lastEvaluatedAt");
CREATE INDEX "AnalyticsAlertRule_metricKey_enabled_idx" ON "AnalyticsAlertRule"("metricKey", "enabled");

CREATE TABLE "AnalyticsAlertEvent" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "ruleId" UUID NOT NULL, "status" VARCHAR(20) NOT NULL DEFAULT 'OPEN',
  "observedValue" DECIMAL(30,6) NOT NULL, "threshold" DECIMAL(30,6) NOT NULL, "message" VARCHAR(500) NOT NULL, "metadata" JSONB,
  "triggeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "acknowledgedAt" TIMESTAMP(3), "acknowledgedById" UUID, "resolvedAt" TIMESTAMP(3),
  CONSTRAINT "AnalyticsAlertEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AnalyticsAlertEvent_ruleId_triggeredAt_idx" ON "AnalyticsAlertEvent"("ruleId", "triggeredAt");
CREATE INDEX "AnalyticsAlertEvent_status_triggeredAt_idx" ON "AnalyticsAlertEvent"("status", "triggeredAt");

CREATE TABLE "AnalyticsDataQualityCheck" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "key" VARCHAR(100) NOT NULL, "name" VARCHAR(160) NOT NULL,
  "feature" VARCHAR(40) NOT NULL, "status" VARCHAR(16) NOT NULL DEFAULT 'PASS', "severity" VARCHAR(16) NOT NULL DEFAULT 'INFO',
  "message" VARCHAR(500) NOT NULL, "affectedFrom" TIMESTAMP(3), "affectedTo" TIMESTAMP(3), "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "metadata" JSONB, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AnalyticsDataQualityCheck_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AnalyticsDataQualityCheck_key_key" ON "AnalyticsDataQualityCheck"("key");
CREATE INDEX "AnalyticsDataQualityCheck_status_checkedAt_idx" ON "AnalyticsDataQualityCheck"("status", "checkedAt");
CREATE INDEX "AnalyticsDataQualityCheck_feature_checkedAt_idx" ON "AnalyticsDataQualityCheck"("feature", "checkedAt");

CREATE TABLE "AnalyticsExportJob" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "ownerId" UUID NOT NULL, "reportKey" VARCHAR(80) NOT NULL,
  "format" VARCHAR(16) NOT NULL, "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING', "query" JSONB NOT NULL, "result" JSONB,
  "error" TEXT, "expiresAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "completedAt" TIMESTAMP(3),
  CONSTRAINT "AnalyticsExportJob_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AnalyticsExportJob_ownerId_createdAt_idx" ON "AnalyticsExportJob"("ownerId", "createdAt");
CREATE INDEX "AnalyticsExportJob_status_createdAt_idx" ON "AnalyticsExportJob"("status", "createdAt");

INSERT INTO "AnalyticsReportDefinition" ("key", "name", "category", "description", "defaultResolution") VALUES
('engagement','Engagement','engagement','DAU, retention, sessions, and feature adoption.','day'),
('gameplay','Gameplay & matchmaking','gameplay','Match volume, completion, queue health, and answer quality.','day'),
('progression','Progression & retention','progression','XP, levels, missions, achievements, and streaks.','day'),
('economy','Economy & monetization','economy','GLD movement, ads, purchases, and reconciliation.','day'),
('social','Social & communications','social','Friends, chats, notifications, and media activity.','day'),
('support','Support operations','support','Tickets, live support, SLAs, and agent workload.','day'),
('risk','Fraud, risk & moderation','risk','Risk signals, cases, reports, and moderation actions.','day'),
('platform','Platform health','platform','Sessions, jobs, notifications, storage, and pipeline health.','hour')
ON CONFLICT ("key") DO NOTHING;
