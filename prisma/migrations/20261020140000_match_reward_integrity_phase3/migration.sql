ALTER TABLE "Match" ADD COLUMN "integrityPolicyVersion" VARCHAR(64) NOT NULL DEFAULT 'match-integrity-v3';

CREATE TABLE "PlayerInstall" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "installIdHash" CHAR(64) NOT NULL,
    "platform" VARCHAR(24) NOT NULL,
    "appVersion" VARCHAR(48),
    "attestationProvider" VARCHAR(32),
    "attestationStatus" VARCHAR(24) NOT NULL DEFAULT 'UNKNOWN',
    "attestationHash" CHAR(64),
    "ipHash" CHAR(64),
    "networkRisk" VARCHAR(24) NOT NULL DEFAULT 'UNKNOWN',
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PlayerInstall_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PlayerInstall_installIdHash_key" ON "PlayerInstall"("installIdHash");
CREATE INDEX "PlayerInstall_userId_lastSeenAt_idx" ON "PlayerInstall"("userId", "lastSeenAt");
CREATE INDEX "PlayerInstall_attestationStatus_lastSeenAt_idx" ON "PlayerInstall"("attestationStatus", "lastSeenAt");
CREATE INDEX "PlayerInstall_ipHash_lastSeenAt_idx" ON "PlayerInstall"("ipHash", "lastSeenAt");
ALTER TABLE "PlayerInstall" ADD CONSTRAINT "PlayerInstall_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "MatchRewardHold" (
    "id" UUID NOT NULL,
    "matchId" UUID NOT NULL,
    "matchParticipantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'HELD',
    "reason" VARCHAR(160) NOT NULL,
    "heldXp" BIGINT NOT NULL DEFAULT 0,
    "heldGld" BIGINT NOT NULL DEFAULT 0,
    "heldElo" BIGINT NOT NULL DEFAULT 0,
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MatchRewardHold_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MatchRewardHold_matchParticipantId_key" ON "MatchRewardHold"("matchParticipantId");
CREATE INDEX "MatchRewardHold_status_createdAt_idx" ON "MatchRewardHold"("status", "createdAt");
CREATE INDEX "MatchRewardHold_userId_status_idx" ON "MatchRewardHold"("userId", "status");
CREATE INDEX "MatchRewardHold_matchId_status_idx" ON "MatchRewardHold"("matchId", "status");
ALTER TABLE "MatchRewardHold" ADD CONSTRAINT "MatchRewardHold_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MatchRewardHold" ADD CONSTRAINT "MatchRewardHold_matchParticipantId_fkey" FOREIGN KEY ("matchParticipantId") REFERENCES "MatchParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MatchRewardHold" ADD CONSTRAINT "MatchRewardHold_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MatchRewardHold" ADD CONSTRAINT "MatchRewardHold_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "MatchIntegrityPolicy" (
    "id" UUID NOT NULL,
    "scopeKey" VARCHAR(120) NOT NULL,
    "gameKey" VARCHAR(64),
    "mode" VARCHAR(24),
    "version" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "killSwitch" BOOLEAN NOT NULL DEFAULT false,
    "rolloutPercentage" INTEGER NOT NULL DEFAULT 100,
    "casualEnabled" BOOLEAN NOT NULL DEFAULT true,
    "rankedEnabled" BOOLEAN NOT NULL DEFAULT true,
    "practiceEnabled" BOOLEAN NOT NULL DEFAULT true,
    "settings" JSONB,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MatchIntegrityPolicy_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "MatchIntegrityPolicy_gameKey_mode_active_idx" ON "MatchIntegrityPolicy"("gameKey", "mode", "active");
CREATE INDEX "MatchIntegrityPolicy_active_rolloutPercentage_idx" ON "MatchIntegrityPolicy"("active", "rolloutPercentage");
CREATE UNIQUE INDEX "MatchIntegrityPolicy_scopeKey_version_key" ON "MatchIntegrityPolicy"("scopeKey", "version");
