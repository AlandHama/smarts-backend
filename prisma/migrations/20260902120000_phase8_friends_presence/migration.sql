-- Phase 8: server-owned presence and relational social graph.
CREATE TYPE "FriendRequestStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELED');

CREATE TABLE "Presence" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "lastHeartbeatAt" TIMESTAMP(3) NOT NULL,
  "lastSeenAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Presence_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FriendRequest" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "requesterId" UUID NOT NULL,
  "addresseeId" UUID NOT NULL,
  "status" "FriendRequestStatus" NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "respondedAt" TIMESTAMP(3),
  CONSTRAINT "FriendRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Friendship" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "friendId" UUID NOT NULL,
  "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Friendship_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FriendBlock" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "blockerId" UUID NOT NULL,
  "blockedId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FriendBlock_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Presence_userId_key" ON "Presence"("userId");
CREATE INDEX "Presence_lastHeartbeatAt_idx" ON "Presence"("lastHeartbeatAt");
CREATE INDEX "Presence_lastSeenAt_idx" ON "Presence"("lastSeenAt");
CREATE UNIQUE INDEX "FriendRequest_requesterId_addresseeId_key" ON "FriendRequest"("requesterId", "addresseeId");
CREATE INDEX "FriendRequest_addresseeId_status_createdAt_idx" ON "FriendRequest"("addresseeId", "status", "createdAt");
CREATE INDEX "FriendRequest_requesterId_status_createdAt_idx" ON "FriendRequest"("requesterId", "status", "createdAt");
CREATE UNIQUE INDEX "Friendship_userId_friendId_key" ON "Friendship"("userId", "friendId");
CREATE INDEX "Friendship_friendId_idx" ON "Friendship"("friendId");
CREATE INDEX "Friendship_userId_acceptedAt_idx" ON "Friendship"("userId", "acceptedAt");
CREATE UNIQUE INDEX "FriendBlock_blockerId_blockedId_key" ON "FriendBlock"("blockerId", "blockedId");
CREATE INDEX "FriendBlock_blockedId_idx" ON "FriendBlock"("blockedId");

ALTER TABLE "Presence" ADD CONSTRAINT "Presence_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FriendRequest" ADD CONSTRAINT "FriendRequest_requesterId_fkey"
  FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FriendRequest" ADD CONSTRAINT "FriendRequest_addresseeId_fkey"
  FOREIGN KEY ("addresseeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Friendship" ADD CONSTRAINT "Friendship_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Friendship" ADD CONSTRAINT "Friendship_friendId_fkey"
  FOREIGN KEY ("friendId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FriendBlock" ADD CONSTRAINT "FriendBlock_blockerId_fkey"
  FOREIGN KEY ("blockerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FriendBlock" ADD CONSTRAINT "FriendBlock_blockedId_fkey"
  FOREIGN KEY ("blockedId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
