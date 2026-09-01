-- Phase 9.1: server-owned matchmaking tickets and friend game invites.
CREATE TYPE "MatchmakingTicketMode" AS ENUM ('CASUAL', 'RANKED', 'FRIEND', 'BOT_FALLBACK');
CREATE TYPE "MatchmakingTicketStatus" AS ENUM ('SEARCHING', 'MATCHED', 'CANCELLED', 'EXPIRED');
CREATE TYPE "MatchmakingInviteStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELED', 'EXPIRED');
CREATE TYPE "MatchRoundStatus" AS ENUM ('CREATED', 'STARTED', 'FINISHED', 'CANCELLED');

CREATE TABLE "MatchRound" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "matchId" UUID NOT NULL,
  "roundIndex" INTEGER NOT NULL,
  "gameDefinitionId" UUID NOT NULL,
  "status" "MatchRoundStatus" NOT NULL DEFAULT 'CREATED',
  "challengeSeedHash" CHAR(64) NOT NULL,
  "startedAt" TIMESTAMP(3),
  "endedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MatchRound_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MatchmakingTicket" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "gameDefinitionId" UUID NOT NULL,
  "mode" "MatchmakingTicketMode" NOT NULL,
  "status" "MatchmakingTicketStatus" NOT NULL DEFAULT 'SEARCHING',
  "isRankingMatch" BOOLEAN NOT NULL DEFAULT false,
  "rankingSeriesId" UUID,
  "levelSnapshot" INTEGER NOT NULL,
  "eloSnapshot" BIGINT NOT NULL,
  "countryCodeSnapshot" CHAR(2),
  "constraints" JSONB,
  "clientVersion" VARCHAR(32),
  "allowBotFallback" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "lastHeartbeatAt" TIMESTAMP(3) NOT NULL,
  "matchedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "matchId" UUID,
  "idempotencyKeyId" UUID,
  CONSTRAINT "MatchmakingTicket_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MatchmakingInvite" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "inviterId" UUID NOT NULL,
  "inviteeId" UUID NOT NULL,
  "gameDefinitionId" UUID NOT NULL,
  "status" "MatchmakingInviteStatus" NOT NULL DEFAULT 'PENDING',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "acceptedAt" TIMESTAMP(3),
  "respondedAt" TIMESTAMP(3),
  "matchId" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MatchmakingInvite_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MatchmakingTicket_status_gameDefinitionId_mode_createdAt_idx" ON "MatchmakingTicket"("status", "gameDefinitionId", "mode", "createdAt");
CREATE INDEX "MatchmakingTicket_userId_status_idx" ON "MatchmakingTicket"("userId", "status");
CREATE INDEX "MatchmakingTicket_expiresAt_lastHeartbeatAt_idx" ON "MatchmakingTicket"("expiresAt", "lastHeartbeatAt");
CREATE INDEX "MatchmakingTicket_matchId_idx" ON "MatchmakingTicket"("matchId");
CREATE UNIQUE INDEX "MatchmakingTicket_one_searching_per_user_key" ON "MatchmakingTicket"("userId") WHERE "status" = 'SEARCHING';
CREATE UNIQUE INDEX "MatchmakingTicket_idempotencyKeyId_key" ON "MatchmakingTicket"("idempotencyKeyId") WHERE "idempotencyKeyId" IS NOT NULL;

CREATE UNIQUE INDEX "MatchRound_matchId_roundIndex_key" ON "MatchRound"("matchId", "roundIndex");
CREATE INDEX "MatchRound_gameDefinitionId_status_idx" ON "MatchRound"("gameDefinitionId", "status");

CREATE INDEX "MatchmakingInvite_inviteeId_status_createdAt_idx" ON "MatchmakingInvite"("inviteeId", "status", "createdAt");
CREATE INDEX "MatchmakingInvite_inviterId_status_createdAt_idx" ON "MatchmakingInvite"("inviterId", "status", "createdAt");
CREATE INDEX "MatchmakingInvite_expiresAt_status_idx" ON "MatchmakingInvite"("expiresAt", "status");
CREATE UNIQUE INDEX "MatchmakingInvite_matchId_key" ON "MatchmakingInvite"("matchId") WHERE "matchId" IS NOT NULL;

ALTER TABLE "MatchmakingTicket" ADD CONSTRAINT "MatchmakingTicket_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MatchmakingTicket" ADD CONSTRAINT "MatchmakingTicket_gameDefinitionId_fkey"
  FOREIGN KEY ("gameDefinitionId") REFERENCES "GameDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MatchmakingTicket" ADD CONSTRAINT "MatchmakingTicket_matchId_fkey"
  FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MatchmakingTicket" ADD CONSTRAINT "MatchmakingTicket_idempotencyKeyId_fkey"
  FOREIGN KEY ("idempotencyKeyId") REFERENCES "IdempotencyKey"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MatchRound" ADD CONSTRAINT "MatchRound_matchId_fkey"
  FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MatchRound" ADD CONSTRAINT "MatchRound_gameDefinitionId_fkey"
  FOREIGN KEY ("gameDefinitionId") REFERENCES "GameDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MatchmakingInvite" ADD CONSTRAINT "MatchmakingInvite_inviterId_fkey"
  FOREIGN KEY ("inviterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MatchmakingInvite" ADD CONSTRAINT "MatchmakingInvite_inviteeId_fkey"
  FOREIGN KEY ("inviteeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MatchmakingInvite" ADD CONSTRAINT "MatchmakingInvite_gameDefinitionId_fkey"
  FOREIGN KEY ("gameDefinitionId") REFERENCES "GameDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MatchmakingInvite" ADD CONSTRAINT "MatchmakingInvite_matchId_fkey"
  FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE SET NULL ON UPDATE CASCADE;
