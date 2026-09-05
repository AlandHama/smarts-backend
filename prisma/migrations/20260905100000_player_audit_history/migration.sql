-- Append-only player activity history. Keep this separate from privileged admin audits.
CREATE TYPE "PlayerAuditActorType" AS ENUM ('PLAYER', 'SYSTEM', 'ADMIN');

CREATE TABLE "PlayerAuditEvent" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "actorType" "PlayerAuditActorType" NOT NULL DEFAULT 'SYSTEM',
  "action" VARCHAR(120) NOT NULL,
  "entityType" VARCHAR(80) NOT NULL,
  "entityId" VARCHAR(255),
  "summary" VARCHAR(500) NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlayerAuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PlayerAuditEvent_userId_createdAt_idx" ON "PlayerAuditEvent"("userId", "createdAt");
CREATE INDEX "PlayerAuditEvent_userId_action_createdAt_idx" ON "PlayerAuditEvent"("userId", "action", "createdAt");
CREATE INDEX "PlayerAuditEvent_entityType_createdAt_idx" ON "PlayerAuditEvent"("entityType", "createdAt");
CREATE INDEX "PlayerAuditEvent_action_createdAt_idx" ON "PlayerAuditEvent"("action", "createdAt");

ALTER TABLE "PlayerAuditEvent" ADD CONSTRAINT "PlayerAuditEvent_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
