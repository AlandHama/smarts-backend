CREATE TYPE "SupportTicketStatus" AS ENUM ('OPEN', 'TRIAGED', 'ASSIGNED', 'WAITING_FOR_PLAYER', 'WAITING_FOR_SUPPORT', 'ESCALATED', 'RESOLVED', 'CLOSED', 'REOPENED');
CREATE TYPE "SupportTicketPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');
CREATE TYPE "SupportAgentLevel" AS ENUM ('AGENT', 'SENIOR', 'SUPERVISOR');
CREATE TYPE "SupportAgentStatus" AS ENUM ('OFFLINE', 'AVAILABLE', 'BUSY', 'SUSPENDED');
CREATE TYPE "SupportMessageSenderKind" AS ENUM ('PLAYER', 'AGENT', 'SYSTEM');

CREATE TABLE "SupportConfiguration" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "key" VARCHAR(40) NOT NULL DEFAULT 'default',
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "maintenanceMessage" VARCHAR(300),
  "ticketRetentionDays" INTEGER NOT NULL DEFAULT 30,
  "messageRetentionDays" INTEGER NOT NULL DEFAULT 30,
  "maxOpenTicketsPerPlayer" INTEGER NOT NULL DEFAULT 3,
  "maxMessageLength" INTEGER NOT NULL DEFAULT 4000,
  "maxSubjectLength" INTEGER NOT NULL DEFAULT 160,
  "firstResponseSlaMinutes" INTEGER NOT NULL DEFAULT 1440,
  "playerReplyTimeoutHours" INTEGER NOT NULL DEFAULT 72,
  "pushNotificationsEnabled" BOOLEAN NOT NULL DEFAULT true,
  "liveChatEnabled" BOOLEAN NOT NULL DEFAULT false,
  "liveChatPriceGld" DECIMAL(20,6) NOT NULL DEFAULT 2,
  "updatedById" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SupportConfiguration_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SupportConfiguration_key_key" ON "SupportConfiguration"("key");
CREATE INDEX "SupportConfiguration_enabled_idx" ON "SupportConfiguration"("enabled");

CREATE TABLE "SupportCategory" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "key" VARCHAR(60) NOT NULL,
  "name" VARCHAR(100) NOT NULL,
  "description" VARCHAR(300),
  "queueKey" VARCHAR(60),
  "defaultPriority" "SupportTicketPriority" NOT NULL DEFAULT 'NORMAL',
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SupportCategory_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SupportCategory_key_key" ON "SupportCategory"("key");
CREATE INDEX "SupportCategory_active_sortOrder_idx" ON "SupportCategory"("active", "sortOrder");

CREATE TABLE "SupportAgent" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "level" "SupportAgentLevel" NOT NULL DEFAULT 'AGENT',
  "status" "SupportAgentStatus" NOT NULL DEFAULT 'OFFLINE',
  "maxConcurrentTickets" INTEGER NOT NULL DEFAULT 10,
  "lastSeenAt" TIMESTAMP(3),
  "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "grantedById" UUID,
  "revokedAt" TIMESTAMP(3),
  "revokedById" UUID,
  "suspensionReason" VARCHAR(500),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SupportAgent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SupportAgent_userId_key" ON "SupportAgent"("userId");
CREATE INDEX "SupportAgent_status_level_idx" ON "SupportAgent"("status", "level");

CREATE TABLE "SupportTicket" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "ticketNumber" VARCHAR(30) NOT NULL,
  "playerId" UUID NOT NULL,
  "categoryId" UUID NOT NULL,
  "assignedAgentId" UUID,
  "subject" VARCHAR(160) NOT NULL,
  "status" "SupportTicketStatus" NOT NULL DEFAULT 'OPEN',
  "priority" "SupportTicketPriority" NOT NULL DEFAULT 'NORMAL',
  "lastSequence" INTEGER NOT NULL DEFAULT 0,
  "firstResponseAt" TIMESTAMP(3),
  "resolvedAt" TIMESTAMP(3),
  "closedAt" TIMESTAMP(3),
  "lastPlayerActivity" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastAgentActivity" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SupportTicket_ticketNumber_key" ON "SupportTicket"("ticketNumber");
CREATE INDEX "SupportTicket_playerId_status_updatedAt_idx" ON "SupportTicket"("playerId", "status", "updatedAt");
CREATE INDEX "SupportTicket_status_priority_updatedAt_idx" ON "SupportTicket"("status", "priority", "updatedAt");
CREATE INDEX "SupportTicket_assignedAgentId_status_updatedAt_idx" ON "SupportTicket"("assignedAgentId", "status", "updatedAt");
CREATE INDEX "SupportTicket_categoryId_status_idx" ON "SupportTicket"("categoryId", "status");

CREATE TABLE "SupportTicketMessage" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "ticketId" UUID NOT NULL,
  "senderId" UUID,
  "senderKind" "SupportMessageSenderKind" NOT NULL,
  "sequence" INTEGER NOT NULL,
  "clientMessageId" VARCHAR(120),
  "body" TEXT NOT NULL,
  "internal" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupportTicketMessage_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SupportTicketMessage_ticketId_sequence_key" ON "SupportTicketMessage"("ticketId", "sequence");
CREATE UNIQUE INDEX "SupportTicketMessage_ticketId_clientMessageId_key" ON "SupportTicketMessage"("ticketId", "clientMessageId");
CREATE INDEX "SupportTicketMessage_ticketId_createdAt_idx" ON "SupportTicketMessage"("ticketId", "createdAt");

CREATE TABLE "SupportTicketAssignment" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "ticketId" UUID NOT NULL,
  "agentId" UUID NOT NULL,
  "assignedById" UUID,
  "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "unassignedAt" TIMESTAMP(3),
  "reason" VARCHAR(500),
  CONSTRAINT "SupportTicketAssignment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SupportTicketAssignment_agentId_unassignedAt_assignedAt_idx" ON "SupportTicketAssignment"("agentId", "unassignedAt", "assignedAt");
CREATE INDEX "SupportTicketAssignment_ticketId_assignedAt_idx" ON "SupportTicketAssignment"("ticketId", "assignedAt");

CREATE TABLE "SupportTicketEvent" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "ticketId" UUID NOT NULL,
  "actorId" UUID,
  "fromStatus" "SupportTicketStatus",
  "toStatus" "SupportTicketStatus",
  "action" VARCHAR(80) NOT NULL,
  "note" VARCHAR(1000),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupportTicketEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SupportTicketEvent_ticketId_createdAt_idx" ON "SupportTicketEvent"("ticketId", "createdAt");

CREATE TABLE "SupportTicketRead" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "ticketId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "lastSequence" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SupportTicketRead_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SupportTicketRead_ticketId_userId_key" ON "SupportTicketRead"("ticketId", "userId");

CREATE TABLE "SupportAuditEvent" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "actorId" UUID,
  "ticketId" UUID,
  "action" VARCHAR(100) NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupportAuditEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SupportAuditEvent_ticketId_createdAt_idx" ON "SupportAuditEvent"("ticketId", "createdAt");
CREATE INDEX "SupportAuditEvent_actorId_createdAt_idx" ON "SupportAuditEvent"("actorId", "createdAt");
CREATE INDEX "SupportAuditEvent_action_createdAt_idx" ON "SupportAuditEvent"("action", "createdAt");

ALTER TABLE "SupportConfiguration" ADD CONSTRAINT "SupportConfiguration_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupportAgent" ADD CONSTRAINT "SupportAgent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupportAgent" ADD CONSTRAINT "SupportAgent_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupportAgent" ADD CONSTRAINT "SupportAgent_revokedById_fkey" FOREIGN KEY ("revokedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "SupportCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_assignedAgentId_fkey" FOREIGN KEY ("assignedAgentId") REFERENCES "SupportAgent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupportTicketMessage" ADD CONSTRAINT "SupportTicketMessage_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupportTicketMessage" ADD CONSTRAINT "SupportTicketMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupportTicketAssignment" ADD CONSTRAINT "SupportTicketAssignment_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupportTicketAssignment" ADD CONSTRAINT "SupportTicketAssignment_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "SupportAgent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupportTicketEvent" ADD CONSTRAINT "SupportTicketEvent_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupportTicketEvent" ADD CONSTRAINT "SupportTicketEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupportTicketRead" ADD CONSTRAINT "SupportTicketRead_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupportTicketRead" ADD CONSTRAINT "SupportTicketRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupportAuditEvent" ADD CONSTRAINT "SupportAuditEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupportAuditEvent" ADD CONSTRAINT "SupportAuditEvent_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "SupportConfiguration" ("updatedAt") VALUES (CURRENT_TIMESTAMP) ON CONFLICT ("key") DO NOTHING;
INSERT INTO "SupportCategory" ("key", "name", "description", "sortOrder", "updatedAt") VALUES
 ('ACCOUNT_LOGIN', 'Account & login', 'Sign-in, sessions, and account access.', 10, CURRENT_TIMESTAMP),
 ('MATCHMAKING_GAMEPLAY', 'Matchmaking & gameplay', 'Matches, game rules, and gameplay issues.', 20, CURRENT_TIMESTAMP),
 ('RESULT_REWARD', 'Results & rewards', 'Match results, XP, and rewards.', 30, CURRENT_TIMESTAMP),
 ('GLD', 'GLD wallet', 'Wallet balance and GLD transactions.', 40, CURRENT_TIMESTAMP),
 ('SOCIAL', 'Friends & social', 'Friends, gifts, and chat notifications.', 50, CURRENT_TIMESTAMP),
 ('STORE', 'Store & purchases', 'Purchases, inventory, and store items.', 60, CURRENT_TIMESTAMP),
 ('BUG', 'Report a bug', 'Something is not working as expected.', 70, CURRENT_TIMESTAMP),
 ('SAFETY', 'Safety & harassment', 'Safety, abuse, and player reports.', 80, CURRENT_TIMESTAMP),
 ('OTHER', 'Other', 'Anything else about SMARTS.', 90, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
