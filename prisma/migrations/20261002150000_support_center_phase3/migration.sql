CREATE TYPE "SupportArticleStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');
CREATE TYPE "SupportAttachmentScanStatus" AS ENUM ('PENDING', 'CLEAN', 'REJECTED', 'EXPIRED');

ALTER TABLE "SupportConfiguration"
  ADD COLUMN "playerCanReopenDays" INTEGER NOT NULL DEFAULT 7,
  ADD COLUMN "attachmentRetentionDays" INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN "maxAttachmentsPerMessage" INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN "maxAttachmentSizeBytes" INTEGER NOT NULL DEFAULT 10485760,
  ADD COLUMN "allowedAttachmentMimes" JSONB,
  ADD COLUMN "blockedAttachmentExtensions" JSONB,
  ADD COLUMN "playerTicketRatePerHour" INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN "playerLiveChatRatePerDay" INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN "agentReplyRatePerMinute" INTEGER NOT NULL DEFAULT 20,
  ADD COLUMN "profanityPolicy" VARCHAR(20) NOT NULL DEFAULT 'REDACT',
  ADD COLUMN "allowRestrictedPlayers" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "slaWorkerEnabled" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "SupportTicket"
  ADD COLUMN "customData" JSONB,
  ADD COLUMN "firstResponseDueAt" TIMESTAMP(3),
  ADD COLUMN "resolutionDueAt" TIMESTAMP(3),
  ADD COLUMN "slaOverdue" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "lastSlaNotifiedAt" TIMESTAMP(3);
CREATE INDEX "SupportTicket_slaOverdue_firstResponseDueAt_idx" ON "SupportTicket"("slaOverdue", "firstResponseDueAt");

ALTER TABLE "SupportCategory" ADD COLUMN "formSchema" JSONB;

CREATE TABLE "SupportHelpArticle" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "slug" VARCHAR(160) NOT NULL,
  "title" VARCHAR(180) NOT NULL,
  "summary" VARCHAR(500) NOT NULL,
  "body" TEXT NOT NULL,
  "status" "SupportArticleStatus" NOT NULL DEFAULT 'DRAFT',
  "categoryId" UUID,
  "tags" JSONB,
  "searchText" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "viewCount" INTEGER NOT NULL DEFAULT 0,
  "helpfulYes" INTEGER NOT NULL DEFAULT 0,
  "helpfulNo" INTEGER NOT NULL DEFAULT 0,
  "publishedAt" TIMESTAMP(3),
  "createdById" UUID,
  "updatedById" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SupportHelpArticle_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SupportHelpArticle_slug_key" ON "SupportHelpArticle"("slug");
CREATE INDEX "SupportHelpArticle_status_sortOrder_publishedAt_idx" ON "SupportHelpArticle"("status", "sortOrder", "publishedAt");
CREATE INDEX "SupportHelpArticle_categoryId_status_idx" ON "SupportHelpArticle"("categoryId", "status");

CREATE TABLE "SupportCannedReply" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "key" VARCHAR(80) NOT NULL,
  "title" VARCHAR(160) NOT NULL,
  "body" TEXT NOT NULL,
  "categoryId" UUID,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdById" UUID,
  "updatedById" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SupportCannedReply_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SupportCannedReply_key_key" ON "SupportCannedReply"("key");
CREATE INDEX "SupportCannedReply_active_categoryId_idx" ON "SupportCannedReply"("active", "categoryId");

CREATE TABLE "SupportTicketRating" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "ticketId" UUID NOT NULL,
  "playerId" UUID NOT NULL,
  "rating" INTEGER NOT NULL,
  "comment" VARCHAR(1000),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SupportTicketRating_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SupportTicketRating_ticketId_playerId_key" ON "SupportTicketRating"("ticketId", "playerId");
CREATE INDEX "SupportTicketRating_rating_createdAt_idx" ON "SupportTicketRating"("rating", "createdAt");

CREATE TABLE "SupportTicketEscalation" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "ticketId" UUID NOT NULL,
  "actorId" UUID NOT NULL,
  "reason" VARCHAR(1000) NOT NULL,
  "fromStatus" "SupportTicketStatus",
  "toStatus" "SupportTicketStatus" NOT NULL DEFAULT 'ESCALATED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  CONSTRAINT "SupportTicketEscalation_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SupportTicketEscalation_ticketId_createdAt_idx" ON "SupportTicketEscalation"("ticketId", "createdAt");
CREATE INDEX "SupportTicketEscalation_resolvedAt_createdAt_idx" ON "SupportTicketEscalation"("resolvedAt", "createdAt");

CREATE TABLE "SupportAttachment" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "ticketId" UUID NOT NULL,
  "messageId" UUID,
  "createdById" UUID NOT NULL,
  "fileName" VARCHAR(255) NOT NULL,
  "mimeType" VARCHAR(120) NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "storageKey" VARCHAR(500) NOT NULL,
  "scanStatus" "SupportAttachmentScanStatus" NOT NULL DEFAULT 'PENDING',
  "scanReason" VARCHAR(500),
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupportAttachment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SupportAttachment_ticketId_createdAt_idx" ON "SupportAttachment"("ticketId", "createdAt");
CREATE INDEX "SupportAttachment_scanStatus_expiresAt_idx" ON "SupportAttachment"("scanStatus", "expiresAt");

ALTER TABLE "SupportHelpArticle" ADD CONSTRAINT "SupportHelpArticle_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "SupportCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupportHelpArticle" ADD CONSTRAINT "SupportHelpArticle_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupportHelpArticle" ADD CONSTRAINT "SupportHelpArticle_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupportCannedReply" ADD CONSTRAINT "SupportCannedReply_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "SupportCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupportCannedReply" ADD CONSTRAINT "SupportCannedReply_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupportCannedReply" ADD CONSTRAINT "SupportCannedReply_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupportTicketRating" ADD CONSTRAINT "SupportTicketRating_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupportTicketRating" ADD CONSTRAINT "SupportTicketRating_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupportTicketEscalation" ADD CONSTRAINT "SupportTicketEscalation_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupportTicketEscalation" ADD CONSTRAINT "SupportTicketEscalation_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupportAttachment" ADD CONSTRAINT "SupportAttachment_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupportAttachment" ADD CONSTRAINT "SupportAttachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "SupportTicketMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupportAttachment" ADD CONSTRAINT "SupportAttachment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
