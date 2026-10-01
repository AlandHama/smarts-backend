ALTER TYPE "ChatMessageState" ADD VALUE 'FLAGGED';

CREATE TYPE "ChatReportCategory" AS ENUM ('HARASSMENT', 'HATE_THREATS', 'SEXUAL_UNSAFE', 'SPAM_SCAM', 'CHEATING_SOLICITATION', 'INAPPROPRIATE_LINK', 'OTHER');
CREATE TYPE "ChatReportStatus" AS ENUM ('OPEN', 'RESOLVED', 'DISMISSED');

ALTER TABLE "Notification" ADD COLUMN "dedupeKey" VARCHAR(255);
ALTER TABLE "ChatConfiguration" ADD COLUMN "includeMessagePreview" BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX "Notification_dedupeKey_key" ON "Notification"("dedupeKey");

CREATE TABLE "ChatRestriction" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "restrictedUntil" TIMESTAMP(3),
    "createdBy" UUID NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChatRestriction_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ChatRestriction_userId_revokedAt_restrictedUntil_idx" ON "ChatRestriction"("userId", "revokedAt", "restrictedUntil");
CREATE INDEX "ChatRestriction_createdAt_idx" ON "ChatRestriction"("createdAt");
ALTER TABLE "ChatRestriction" ADD CONSTRAINT "ChatRestriction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ChatReport" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "dedupeKey" VARCHAR(255) NOT NULL,
    "reporterId" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "messageId" UUID,
    "category" "ChatReportCategory" NOT NULL,
    "reason" VARCHAR(500),
    "status" "ChatReportStatus" NOT NULL DEFAULT 'OPEN',
    "reviewedBy" UUID,
    "reviewedAt" TIMESTAMP(3),
    "resolutionNote" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ChatReport_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ChatReport_dedupeKey_key" ON "ChatReport"("dedupeKey");
CREATE INDEX "ChatReport_status_createdAt_idx" ON "ChatReport"("status", "createdAt");
CREATE INDEX "ChatReport_conversationId_createdAt_idx" ON "ChatReport"("conversationId", "createdAt");
CREATE INDEX "ChatReport_messageId_createdAt_idx" ON "ChatReport"("messageId", "createdAt");
ALTER TABLE "ChatReport" ADD CONSTRAINT "ChatReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChatReport" ADD CONSTRAINT "ChatReport_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "ChatConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChatReport" ADD CONSTRAINT "ChatReport_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ChatMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ChatEvidence" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "messageId" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "senderId" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "messageCreatedAt" TIMESTAMP(3) NOT NULL,
    "caseReference" VARCHAR(120),
    "reason" VARCHAR(500) NOT NULL,
    "preservedBy" UUID NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChatEvidence_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ChatEvidence_conversationId_createdAt_idx" ON "ChatEvidence"("conversationId", "createdAt");
CREATE INDEX "ChatEvidence_messageId_idx" ON "ChatEvidence"("messageId");
CREATE INDEX "ChatEvidence_expiresAt_idx" ON "ChatEvidence"("expiresAt");
