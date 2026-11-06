CREATE TYPE "AdminNotificationSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

CREATE TABLE "AdminNotification" (
    "id" UUID NOT NULL,
    "dedupeKey" VARCHAR(255) NOT NULL,
    "category" VARCHAR(60) NOT NULL,
    "severity" "AdminNotificationSeverity" NOT NULL DEFAULT 'INFO',
    "title" VARCHAR(160) NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB,
    "readAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminNotification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AdminNotification_dedupeKey_key" ON "AdminNotification"("dedupeKey");
CREATE INDEX "AdminNotification_readAt_resolvedAt_createdAt_idx" ON "AdminNotification"("readAt", "resolvedAt", "createdAt");
CREATE INDEX "AdminNotification_category_resolvedAt_createdAt_idx" ON "AdminNotification"("category", "resolvedAt", "createdAt");
CREATE INDEX "AdminNotification_severity_resolvedAt_createdAt_idx" ON "AdminNotification"("severity", "resolvedAt", "createdAt");
