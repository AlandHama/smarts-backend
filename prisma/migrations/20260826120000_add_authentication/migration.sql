-- UUID-backed authentication tables. gen_random_uuid() keeps direct SQL inserts
-- safe while Prisma also generates UUIDs for normal application writes.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'BANNED');
CREATE TYPE "SessionStatus" AS ENUM ('ACTIVE', 'TERMINATED');

CREATE TABLE "User" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "username" VARCHAR(100) NOT NULL,
    "passwordHash" VARCHAR(255) NOT NULL,
    "firstName" VARCHAR(100) NOT NULL,
    "lastName" VARCHAR(100) NOT NULL,
    "email" VARCHAR(255),
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastOnline" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Session" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "tokenId" UUID NOT NULL,
    "sessionStatus" "SessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "isMobileSession" BOOLEAN NOT NULL DEFAULT false,
    "clientVersion" VARCHAR(32),
    "deviceInfo" VARCHAR(500),
    "ipAddress" VARCHAR(100),
    "deviceName" VARCHAR(100),
    "location" VARCHAR(100),
    "loginTimestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActiveTimestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "Session_tokenId_key" ON "Session"("tokenId");
CREATE INDEX "Session_userId_tokenId_idx" ON "Session"("userId", "tokenId");
CREATE INDEX "Session_userId_sessionStatus_idx" ON "Session"("userId", "sessionStatus");
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

ALTER TABLE "Session"
  ADD CONSTRAINT "Session_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
