-- Phase 9B: replace Firebase reward/config/notification authority with Railway.
-- Critical values belong in privateConfig and are never projected to clients.
CREATE TYPE "AdRewardClaimStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED', 'GRANTED');
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'READ', 'DISPATCHED', 'FAILED');

CREATE TABLE "RewardPolicyVersion" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "key" VARCHAR(80) NOT NULL,
  "version" INTEGER NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "publicConfig" JSONB NOT NULL,
  "privateConfig" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RewardPolicyVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AdRewardClaim" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "provider" VARCHAR(40) NOT NULL,
  "adFormat" VARCHAR(40) NOT NULL,
  "claimTokenHash" CHAR(64) NOT NULL,
  "providerEventId" VARCHAR(255),
  "countryCode" CHAR(2),
  "currencyId" UUID,
  "rewardAmount" BIGINT,
  "status" "AdRewardClaimStatus" NOT NULL DEFAULT 'PENDING',
  "verificationPayload" JSONB,
  "rejectionReason" VARCHAR(255),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "verifiedAt" TIMESTAMP(3),
  "grantedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AdRewardClaim_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Notification" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID,
  "outboxEventId" UUID,
  "notificationType" VARCHAR(120) NOT NULL,
  "title" VARCHAR(160) NOT NULL,
  "body" TEXT NOT NULL,
  "data" JSONB,
  "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
  "readAt" TIMESTAMP(3),
  "dispatchedAt" TIMESTAMP(3),
  "failureReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RewardPolicyVersion_key_version_key" ON "RewardPolicyVersion"("key", "version");
CREATE INDEX "RewardPolicyVersion_key_active_version_idx" ON "RewardPolicyVersion"("key", "active", "version");
CREATE UNIQUE INDEX "AdRewardClaim_claimTokenHash_key" ON "AdRewardClaim"("claimTokenHash");
CREATE UNIQUE INDEX "AdRewardClaim_provider_providerEventId_key" ON "AdRewardClaim"("provider", "providerEventId");
CREATE INDEX "AdRewardClaim_userId_status_createdAt_idx" ON "AdRewardClaim"("userId", "status", "createdAt");
CREATE INDEX "AdRewardClaim_userId_grantedAt_idx" ON "AdRewardClaim"("userId", "grantedAt");
CREATE INDEX "AdRewardClaim_expiresAt_status_idx" ON "AdRewardClaim"("expiresAt", "status");
CREATE INDEX "Notification_userId_status_createdAt_idx" ON "Notification"("userId", "status", "createdAt");
CREATE INDEX "Notification_notificationType_createdAt_idx" ON "Notification"("notificationType", "createdAt");
CREATE UNIQUE INDEX "Notification_outboxEventId_userId_key" ON "Notification"("outboxEventId", "userId");

ALTER TABLE "AdRewardClaim" ADD CONSTRAINT "AdRewardClaim_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AdRewardClaim" ADD CONSTRAINT "AdRewardClaim_currencyId_fkey"
  FOREIGN KEY ("currencyId") REFERENCES "CurrencyDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Safe defaults only: no reward amounts, eCPM, multipliers, or provider secrets
-- are seeded into the public projection.
INSERT INTO "RewardPolicyVersion" ("key", "version", "active", "publicConfig", "privateConfig", "updatedAt")
VALUES ('platform', 1, true, '{"maintenanceEnabled":false,"minimumVersion":"1.0.0"}'::jsonb, '{}'::jsonb, CURRENT_TIMESTAMP)
ON CONFLICT ("key", "version") DO NOTHING;
