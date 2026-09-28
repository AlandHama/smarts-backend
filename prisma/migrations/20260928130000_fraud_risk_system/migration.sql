CREATE TYPE "FraudRiskLevel" AS ENUM ('NORMAL', 'LOW', 'SUSPICIOUS', 'HIGH', 'CRITICAL');
CREATE TYPE "FraudProfileStatus" AS ENUM ('CLEAR', 'WATCH', 'RESTRICTED', 'SUSPENDED');
CREATE TYPE "FraudSignalStatus" AS ENUM ('ACTIVE', 'RESOLVED', 'EXPIRED');
CREATE TYPE "FraudCaseStatus" AS ENUM ('OPEN', 'IN_REVIEW', 'WATCH', 'SAFE', 'CLOSED');
CREATE TYPE "FraudActionType" AS ENUM ('MARK_SAFE', 'WATCH', 'RESTRICT_REWARDS', 'SUSPEND', 'REINSTATE', 'RECALCULATE');

CREATE TABLE "FraudProfile" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 0,
    "riskLevel" "FraudRiskLevel" NOT NULL DEFAULT 'NORMAL',
    "status" "FraudProfileStatus" NOT NULL DEFAULT 'CLEAR',
    "lastEvaluatedAt" TIMESTAMP(3),
    "lastSignalAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FraudProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FraudRule" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "key" VARCHAR(80) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(500) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "scoreDelta" INTEGER NOT NULL DEFAULT 10,
    "threshold" INTEGER,
    "windowSeconds" INTEGER,
    "decayDays" INTEGER NOT NULL DEFAULT 30,
    "autoOpenScore" INTEGER,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FraudRule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FraudSignal" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "ruleId" UUID,
    "type" VARCHAR(80) NOT NULL,
    "severity" "FraudRiskLevel" NOT NULL DEFAULT 'LOW',
    "scoreDelta" INTEGER NOT NULL DEFAULT 0,
    "sourceType" VARCHAR(80) NOT NULL,
    "sourceId" VARCHAR(255),
    "dedupeKey" VARCHAR(255) NOT NULL,
    "metadata" JSONB,
    "status" "FraudSignalStatus" NOT NULL DEFAULT 'ACTIVE',
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FraudSignal_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FraudCase" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "status" "FraudCaseStatus" NOT NULL DEFAULT 'OPEN',
    "scoreAtOpen" INTEGER NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "assignedAdminId" UUID,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "resolution" VARCHAR(500),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FraudCase_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FraudAction" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "caseId" UUID,
    "userId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "action" "FraudActionType" NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FraudAction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FraudProfile_userId_key" ON "FraudProfile"("userId");
CREATE UNIQUE INDEX "FraudRule_key_key" ON "FraudRule"("key");
CREATE UNIQUE INDEX "FraudSignal_dedupeKey_key" ON "FraudSignal"("dedupeKey");
CREATE INDEX "FraudProfile_riskLevel_status_score_idx" ON "FraudProfile"("riskLevel", "status", "score");
CREATE INDEX "FraudProfile_lastSignalAt_idx" ON "FraudProfile"("lastSignalAt");
CREATE INDEX "FraudRule_enabled_key_idx" ON "FraudRule"("enabled", "key");
CREATE INDEX "FraudSignal_userId_status_occurredAt_idx" ON "FraudSignal"("userId", "status", "occurredAt");
CREATE INDEX "FraudSignal_type_occurredAt_idx" ON "FraudSignal"("type", "occurredAt");
CREATE INDEX "FraudSignal_sourceType_sourceId_idx" ON "FraudSignal"("sourceType", "sourceId");
CREATE INDEX "FraudCase_status_openedAt_idx" ON "FraudCase"("status", "openedAt");
CREATE INDEX "FraudCase_userId_status_idx" ON "FraudCase"("userId", "status");
CREATE INDEX "FraudCase_assignedAdminId_status_idx" ON "FraudCase"("assignedAdminId", "status");
CREATE INDEX "FraudAction_userId_createdAt_idx" ON "FraudAction"("userId", "createdAt");
CREATE INDEX "FraudAction_caseId_createdAt_idx" ON "FraudAction"("caseId", "createdAt");

ALTER TABLE "FraudProfile" ADD CONSTRAINT "FraudProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FraudProfile" ADD CONSTRAINT "FraudProfile_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FraudSignal" ADD CONSTRAINT "FraudSignal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FraudSignal" ADD CONSTRAINT "FraudSignal_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "FraudRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FraudCase" ADD CONSTRAINT "FraudCase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FraudCase" ADD CONSTRAINT "FraudCase_assignedAdminId_fkey" FOREIGN KEY ("assignedAdminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FraudAction" ADD CONSTRAINT "FraudAction_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "FraudCase"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FraudAction" ADD CONSTRAINT "FraudAction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FraudAction" ADD CONSTRAINT "FraudAction_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "FraudRule" ("key", "name", "description", "enabled", "scoreDelta", "threshold", "windowSeconds", "decayDays", "autoOpenScore", "updatedAt") VALUES
('MULTI_ACCOUNT_DEVICE', 'Multi-account device', 'Several player accounts share the same device fingerprint.', true, 15, 3, 86400, 30, 60, CURRENT_TIMESTAMP),
('RAPID_AD_REWARDS', 'Rapid ad rewards', 'Rewarded ads are granted too frequently in a short period.', true, 12, 10, 1800, 7, 60, CURRENT_TIMESTAMP),
('IMPOSSIBLE_ANSWER_SPEED', 'Impossible answer speed', 'Repeated answers arrive below the configured human response window.', true, 8, 5, 3600, 14, 70, CURRENT_TIMESTAMP),
('REFERRAL_DEVICE_MATCH', 'Referral device match', 'Referred accounts share a device fingerprint with their referrer.', true, 20, 1, 86400, 30, 60, CURRENT_TIMESTAMP),
('GLD_FUNNELING', 'GLD funneling', 'Many related accounts funnel GLD to one destination.', true, 25, 5, 86400, 30, 60, CURRENT_TIMESTAMP),
('REPEATED_INVALID_EVENTS', 'Repeated invalid events', 'Repeated rejected or out-of-order authoritative events.', true, 10, 15, 3600, 14, 70, CURRENT_TIMESTAMP),
('ABNORMAL_SESSION_SWITCHING', 'Abnormal session switching', 'Frequent device/session changes are detected for one account.', true, 8, 6, 3600, 14, 70, CURRENT_TIMESTAMP),
('PAID_REWARD_REVIEW', 'Paid reward review', 'A paid reward request requires additional fraud review.', true, 0, 60, 86400, 30, NULL, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
