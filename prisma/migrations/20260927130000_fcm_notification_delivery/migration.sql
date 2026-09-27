-- Durable device registration and global notification broadcasts.
-- Existing notifications are intentionally marked SKIPPED so enabling FCM does
-- not replay old inbox items as push notifications.
CREATE TYPE "NotificationPushStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'FAILED', 'SKIPPED');

ALTER TABLE "Notification"
  ADD COLUMN "broadcastId" UUID,
  ADD COLUMN "pushStatus" "NotificationPushStatus" NOT NULL DEFAULT 'SKIPPED',
  ADD COLUMN "pushAttemptedAt" TIMESTAMP(3),
  ADD COLUMN "pushFailureReason" TEXT;

CREATE TABLE "PushDevice" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "token" TEXT NOT NULL,
  "platform" VARCHAR(20) NOT NULL,
  "appVersion" VARCHAR(40),
  "active" BOOLEAN NOT NULL DEFAULT true,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PushDevice_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NotificationBroadcast" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "createdById" UUID NOT NULL,
  "title" VARCHAR(160) NOT NULL,
  "body" TEXT NOT NULL,
  "data" JSONB,
  "recipientCount" INTEGER NOT NULL DEFAULT 0,
  "pushSentCount" INTEGER NOT NULL DEFAULT 0,
  "pushFailedCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NotificationBroadcast_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PushDevice_token_key" ON "PushDevice"("token");
CREATE INDEX "PushDevice_userId_active_idx" ON "PushDevice"("userId", "active");
CREATE INDEX "PushDevice_active_lastSeenAt_idx" ON "PushDevice"("active", "lastSeenAt");
CREATE INDEX "Notification_pushStatus_createdAt_idx" ON "Notification"("pushStatus", "createdAt");
CREATE INDEX "NotificationBroadcast_createdAt_idx" ON "NotificationBroadcast"("createdAt");

ALTER TABLE "Notification"
  ADD CONSTRAINT "Notification_broadcastId_fkey"
  FOREIGN KEY ("broadcastId") REFERENCES "NotificationBroadcast"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PushDevice"
  ADD CONSTRAINT "PushDevice_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NotificationBroadcast"
  ADD CONSTRAINT "NotificationBroadcast_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
