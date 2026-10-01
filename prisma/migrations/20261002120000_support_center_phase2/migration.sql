CREATE TYPE "SupportLiveChatStatus" AS ENUM ('PAYMENT_PENDING', 'QUEUED', 'ASSIGNED', 'ACTIVE', 'PAUSED', 'WAITING_FOR_PLAYER', 'ENDED', 'REFUND_PENDING', 'REFUNDED', 'EXPIRED');
CREATE TYPE "SupportLiveChatEventType" AS ENUM ('CREATED', 'PAYMENT_CHARGED', 'ASSIGNED', 'STARTED', 'PAUSED', 'RESUMED', 'MESSAGE_ADDED', 'ENDED', 'REFUNDED', 'EXPIRED');

ALTER TABLE "SupportConfiguration"
  ADD COLUMN "liveChatSessionMinutes" INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN "liveChatGraceMinutes" INTEGER NOT NULL DEFAULT 10,
  ADD COLUMN "maxLiveChatQueueSize" INTEGER NOT NULL DEFAULT 25,
  ADD COLUMN "autoCloseInactiveMinutes" INTEGER NOT NULL DEFAULT 15,
  ADD COLUMN "refundOnNoAgentConnection" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "refundOnSystemFailure" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "refundOnAgentCancellation" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "requirePlayerRating" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "liveChatCurrencyCode" VARCHAR(16) NOT NULL DEFAULT 'GLD';
ALTER TABLE "SupportAgent" ADD COLUMN "maxConcurrentLiveChats" INTEGER NOT NULL DEFAULT 2;

CREATE TABLE "SupportLiveChatQuote" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "playerId" UUID NOT NULL,
  "priceGld" DECIMAL(20,6) NOT NULL,
  "currencyCode" VARCHAR(16) NOT NULL DEFAULT 'GLD',
  "availableAgents" INTEGER NOT NULL DEFAULT 0,
  "estimatedWaitSeconds" INTEGER NOT NULL DEFAULT 0,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupportLiveChatQuote_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SupportLiveChatQuote_playerId_expiresAt_idx" ON "SupportLiveChatQuote"("playerId", "expiresAt");

CREATE TABLE "SupportLiveChatSession" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "sessionNumber" VARCHAR(30) NOT NULL,
  "playerId" UUID NOT NULL,
  "assignedAgentId" UUID,
  "quoteId" UUID NOT NULL,
  "purchaseIdempotencyKey" VARCHAR(120) NOT NULL,
  "status" "SupportLiveChatStatus" NOT NULL DEFAULT 'QUEUED',
  "quotedPriceGld" DECIMAL(20,6) NOT NULL,
  "chargedAmountGld" DECIMAL(20,6) NOT NULL,
  "lastSequence" INTEGER NOT NULL DEFAULT 0,
  "currencyCode" VARCHAR(16) NOT NULL DEFAULT 'GLD',
  "walletLedgerId" UUID,
  "refundLedgerId" UUID,
  "configurationVersion" VARCHAR(80),
  "queueEnteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "assignedAt" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3),
  "endedAt" TIMESTAMP(3),
  "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "disconnectUntil" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SupportLiveChatSession_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SupportLiveChatSession_sessionNumber_key" ON "SupportLiveChatSession"("sessionNumber");
CREATE UNIQUE INDEX "SupportLiveChatSession_quoteId_key" ON "SupportLiveChatSession"("quoteId");
CREATE UNIQUE INDEX "SupportLiveChatSession_playerId_purchaseIdempotencyKey_key" ON "SupportLiveChatSession"("playerId", "purchaseIdempotencyKey");
CREATE INDEX "SupportLiveChatSession_playerId_status_updatedAt_idx" ON "SupportLiveChatSession"("playerId", "status", "updatedAt");
CREATE INDEX "SupportLiveChatSession_status_queueEnteredAt_idx" ON "SupportLiveChatSession"("status", "queueEnteredAt");
CREATE INDEX "SupportLiveChatSession_assignedAgentId_status_updatedAt_idx" ON "SupportLiveChatSession"("assignedAgentId", "status", "updatedAt");

CREATE TABLE "SupportLiveChatCharge" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "sessionId" UUID NOT NULL,
  "amountGld" DECIMAL(20,6) NOT NULL,
  "currencyCode" VARCHAR(16) NOT NULL,
  "ledgerId" UUID,
  "quoteId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupportLiveChatCharge_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SupportLiveChatCharge_sessionId_key" ON "SupportLiveChatCharge"("sessionId");
CREATE INDEX "SupportLiveChatCharge_createdAt_idx" ON "SupportLiveChatCharge"("createdAt");

CREATE TABLE "SupportLiveChatRefund" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "sessionId" UUID NOT NULL,
  "amountGld" DECIMAL(20,6) NOT NULL,
  "currencyCode" VARCHAR(16) NOT NULL,
  "ledgerId" UUID,
  "reason" VARCHAR(500) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupportLiveChatRefund_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SupportLiveChatRefund_sessionId_key" ON "SupportLiveChatRefund"("sessionId");

CREATE TABLE "SupportLiveChatMessage" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "sessionId" UUID NOT NULL,
  "senderId" UUID,
  "senderKind" "SupportMessageSenderKind" NOT NULL,
  "sequence" INTEGER NOT NULL,
  "clientMessageId" VARCHAR(120) NOT NULL,
  "body" TEXT NOT NULL,
  "internal" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupportLiveChatMessage_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SupportLiveChatMessage_sessionId_sequence_key" ON "SupportLiveChatMessage"("sessionId", "sequence");
CREATE UNIQUE INDEX "SupportLiveChatMessage_sessionId_clientMessageId_key" ON "SupportLiveChatMessage"("sessionId", "clientMessageId");
CREATE INDEX "SupportLiveChatMessage_sessionId_createdAt_idx" ON "SupportLiveChatMessage"("sessionId", "createdAt");

CREATE TABLE "SupportLiveChatRead" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "sessionId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "lastSequence" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SupportLiveChatRead_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SupportLiveChatRead_sessionId_userId_key" ON "SupportLiveChatRead"("sessionId", "userId");

CREATE TABLE "SupportLiveChatEvent" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "sessionId" UUID NOT NULL,
  "actorId" UUID,
  "type" "SupportLiveChatEventType" NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupportLiveChatEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SupportLiveChatEvent_sessionId_createdAt_idx" ON "SupportLiveChatEvent"("sessionId", "createdAt");

ALTER TABLE "SupportLiveChatQuote" ADD CONSTRAINT "SupportLiveChatQuote_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupportLiveChatSession" ADD CONSTRAINT "SupportLiveChatSession_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupportLiveChatSession" ADD CONSTRAINT "SupportLiveChatSession_assignedAgentId_fkey" FOREIGN KEY ("assignedAgentId") REFERENCES "SupportAgent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupportLiveChatSession" ADD CONSTRAINT "SupportLiveChatSession_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "SupportLiveChatQuote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupportLiveChatCharge" ADD CONSTRAINT "SupportLiveChatCharge_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "SupportLiveChatSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupportLiveChatRefund" ADD CONSTRAINT "SupportLiveChatRefund_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "SupportLiveChatSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupportLiveChatMessage" ADD CONSTRAINT "SupportLiveChatMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "SupportLiveChatSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupportLiveChatMessage" ADD CONSTRAINT "SupportLiveChatMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupportLiveChatRead" ADD CONSTRAINT "SupportLiveChatRead_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "SupportLiveChatSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupportLiveChatRead" ADD CONSTRAINT "SupportLiveChatRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupportLiveChatEvent" ADD CONSTRAINT "SupportLiveChatEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "SupportLiveChatSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupportLiveChatEvent" ADD CONSTRAINT "SupportLiveChatEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
