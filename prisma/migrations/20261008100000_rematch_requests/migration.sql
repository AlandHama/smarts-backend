CREATE TYPE "RematchRequestStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELED', 'EXPIRED');

CREATE TABLE "RematchRequest" (
  "id" UUID NOT NULL,
  "originalMatchId" UUID NOT NULL,
  "requesterId" UUID NOT NULL,
  "recipientId" UUID NOT NULL,
  "gameDefinitionId" UUID NOT NULL,
  "status" "RematchRequestStatus" NOT NULL DEFAULT 'PENDING',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "acceptedAt" TIMESTAMP(3),
  "respondedAt" TIMESTAMP(3),
  "newMatchId" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RematchRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RematchRequest_newMatchId_key" ON "RematchRequest"("newMatchId");
CREATE INDEX "RematchRequest_recipientId_status_createdAt_idx" ON "RematchRequest"("recipientId", "status", "createdAt");
CREATE INDEX "RematchRequest_requesterId_status_createdAt_idx" ON "RematchRequest"("requesterId", "status", "createdAt");
CREATE INDEX "RematchRequest_originalMatchId_status_idx" ON "RematchRequest"("originalMatchId", "status");
CREATE INDEX "RematchRequest_expiresAt_status_idx" ON "RematchRequest"("expiresAt", "status");
CREATE UNIQUE INDEX "RematchRequest_one_pending_pair_key"
  ON "RematchRequest"("originalMatchId", "requesterId", "recipientId")
  WHERE "status" = 'PENDING';

ALTER TABLE "RematchRequest" ADD CONSTRAINT "RematchRequest_originalMatchId_fkey"
  FOREIGN KEY ("originalMatchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RematchRequest" ADD CONSTRAINT "RematchRequest_requesterId_fkey"
  FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RematchRequest" ADD CONSTRAINT "RematchRequest_recipientId_fkey"
  FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RematchRequest" ADD CONSTRAINT "RematchRequest_gameDefinitionId_fkey"
  FOREIGN KEY ("gameDefinitionId") REFERENCES "GameDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RematchRequest" ADD CONSTRAINT "RematchRequest_newMatchId_fkey"
  FOREIGN KEY ("newMatchId") REFERENCES "Match"("id") ON DELETE SET NULL ON UPDATE CASCADE;
