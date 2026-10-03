CREATE TABLE "Party" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "hostUserId" UUID NOT NULL,
  "status" VARCHAR(32) NOT NULL DEFAULT 'CREATED',
  "mode" VARCHAR(16) NOT NULL DEFAULT 'RANDOM',
  "maxMembers" INTEGER NOT NULL DEFAULT 2,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "queuedAt" TIMESTAMP(3),
  "matchedAt" TIMESTAMP(3),
  "closedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Party_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Party_hostUserId_status_idx" ON "Party"("hostUserId", "status");
CREATE INDEX "Party_status_mode_queuedAt_idx" ON "Party"("status", "mode", "queuedAt");
CREATE INDEX "Party_expiresAt_idx" ON "Party"("expiresAt");
ALTER TABLE "Party" ADD CONSTRAINT "Party_hostUserId_fkey" FOREIGN KEY ("hostUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PartyMember" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "partyId" UUID NOT NULL, "userId" UUID NOT NULL,
  "role" VARCHAR(16) NOT NULL DEFAULT 'MEMBER', "status" VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
  "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "leftAt" TIMESTAMP(3), "readyAt" TIMESTAMP(3),
  "lastHeartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PartyMember_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PartyMember_partyId_userId_key" ON "PartyMember"("partyId", "userId");
CREATE INDEX "PartyMember_userId_status_leftAt_idx" ON "PartyMember"("userId", "status", "leftAt");
CREATE INDEX "PartyMember_partyId_status_idx" ON "PartyMember"("partyId", "status");
ALTER TABLE "PartyMember" ADD CONSTRAINT "PartyMember_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PartyMember" ADD CONSTRAINT "PartyMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PartyInvite" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "partyId" UUID NOT NULL, "inviterId" UUID NOT NULL, "inviteeId" UUID NOT NULL,
  "status" VARCHAR(24) NOT NULL DEFAULT 'PENDING', "expiresAt" TIMESTAMP(3) NOT NULL, "respondedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PartyInvite_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PartyInvite_partyId_inviteeId_status_key" ON "PartyInvite"("partyId", "inviteeId", "status");
CREATE INDEX "PartyInvite_inviteeId_status_createdAt_idx" ON "PartyInvite"("inviteeId", "status", "createdAt");
CREATE INDEX "PartyInvite_partyId_status_expiresAt_idx" ON "PartyInvite"("partyId", "status", "expiresAt");
ALTER TABLE "PartyInvite" ADD CONSTRAINT "PartyInvite_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PartyInvite" ADD CONSTRAINT "PartyInvite_inviterId_fkey" FOREIGN KEY ("inviterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PartyInvite" ADD CONSTRAINT "PartyInvite_inviteeId_fkey" FOREIGN KEY ("inviteeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "CooperativeQueueEntry" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "partyId" UUID NOT NULL, "mode" VARCHAR(16) NOT NULL,
  "status" VARCHAR(24) NOT NULL DEFAULT 'SEARCHING', "ratingSnapshot" INTEGER NOT NULL DEFAULT 0, "levelSnapshot" INTEGER NOT NULL DEFAULT 1,
  "countrySnapshot" CHAR(2), "clientVersion" VARCHAR(32), "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastHeartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "expiresAt" TIMESTAMP(3) NOT NULL, "matchId" UUID,
  CONSTRAINT "CooperativeQueueEntry_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CooperativeQueueEntry_partyId_mode_status_key" ON "CooperativeQueueEntry"("partyId", "mode", "status");
CREATE INDEX "CooperativeQueueEntry_status_mode_queuedAt_idx" ON "CooperativeQueueEntry"("status", "mode", "queuedAt");
CREATE INDEX "CooperativeQueueEntry_expiresAt_lastHeartbeatAt_idx" ON "CooperativeQueueEntry"("expiresAt", "lastHeartbeatAt");
CREATE INDEX "CooperativeQueueEntry_partyId_status_idx" ON "CooperativeQueueEntry"("partyId", "status");
ALTER TABLE "CooperativeQueueEntry" ADD CONSTRAINT "CooperativeQueueEntry_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "CooperativeConfiguration" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "key" VARCHAR(40) NOT NULL DEFAULT 'default', "enabled" BOOLEAN NOT NULL DEFAULT true,
  "randomEnabled" BOOLEAN NOT NULL DEFAULT true, "rankedEnabled" BOOLEAN NOT NULL DEFAULT false, "allowSoloParty" BOOLEAN NOT NULL DEFAULT false,
  "botFillEnabled" BOOLEAN NOT NULL DEFAULT false, "partyIdleMinutes" INTEGER NOT NULL DEFAULT 30, "inviteExpiryMinutes" INTEGER NOT NULL DEFAULT 5,
  "queueTimeoutSeconds" INTEGER NOT NULL DEFAULT 120, "minLevel" INTEGER NOT NULL DEFAULT 1, "minElo" INTEGER NOT NULL DEFAULT 0,
  "minCompletedMatches" INTEGER NOT NULL DEFAULT 0, "rankedEntryFeeGld" DECIMAL(20,6) NOT NULL DEFAULT 2, "voiceEnabled" BOOLEAN NOT NULL DEFAULT true,
  "updatedById" UUID, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CooperativeConfiguration_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CooperativeConfiguration_key_key" ON "CooperativeConfiguration"("key");
CREATE INDEX "CooperativeConfiguration_enabled_randomEnabled_rankedEnabled_idx" ON "CooperativeConfiguration"("enabled", "randomEnabled", "rankedEnabled");
INSERT INTO "CooperativeConfiguration" ("key", "updatedAt") VALUES ('default', CURRENT_TIMESTAMP) ON CONFLICT ("key") DO NOTHING;

ALTER TABLE "ChatConversation" ADD COLUMN "partyId" UUID;
CREATE UNIQUE INDEX "ChatConversation_partyId_key" ON "ChatConversation"("partyId");
ALTER TABLE "ChatConversation" ADD CONSTRAINT "ChatConversation_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;
