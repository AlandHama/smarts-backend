-- Phase 7: server-owned player storage, profile visibility, files, and feedback.
CREATE TYPE "StoredFileVisibility" AS ENUM ('PUBLIC', 'PRIVATE');
CREATE TYPE "StoredFileStatus" AS ENUM ('ACTIVE', 'DELETED');
CREATE TYPE "FeedbackEntity" AS ENUM ('GAME', 'PLAYER', 'UGC');
CREATE TYPE "FeedbackStatus" AS ENUM ('OPEN', 'IN_REVIEW', 'RESOLVED', 'DISMISSED');
CREATE TYPE "PlayerStorageVisibility" AS ENUM ('PRIVATE', 'PUBLIC');
CREATE TYPE "PlayerStorageValueType" AS ENUM ('STRING', 'JSON', 'DATE', 'URL');

ALTER TABLE "PlayerProfile"
  ADD COLUMN "isPublic" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "metadata" JSONB;

CREATE TABLE "PlayerStorageItem" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "key" VARCHAR(100) NOT NULL,
  "value" TEXT NOT NULL,
  "visibility" "PlayerStorageVisibility" NOT NULL DEFAULT 'PRIVATE',
  "valueType" "PlayerStorageValueType" NOT NULL DEFAULT 'STRING',
  "displayOrder" INTEGER NOT NULL DEFAULT 0,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlayerStorageItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StoredFile" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID,
  "objectKey" VARCHAR(512) NOT NULL,
  "originalName" VARCHAR(255) NOT NULL,
  "contentType" VARCHAR(120) NOT NULL,
  "byteSize" BIGINT NOT NULL,
  "checksum" VARCHAR(128),
  "purpose" VARCHAR(80) NOT NULL,
  "visibility" "StoredFileVisibility" NOT NULL DEFAULT 'PRIVATE',
  "status" "StoredFileStatus" NOT NULL DEFAULT 'ACTIVE',
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "StoredFile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FeedbackCategory" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "key" VARCHAR(80) NOT NULL,
  "entity" "FeedbackEntity" NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "description" VARCHAR(500),
  "active" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FeedbackCategory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlayerFeedback" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "categoryId" UUID NOT NULL,
  "entity" "FeedbackEntity" NOT NULL,
  "entityId" UUID,
  "description" TEXT NOT NULL,
  "status" "FeedbackStatus" NOT NULL DEFAULT 'OPEN',
  "metadata" JSONB,
  "adminNote" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "resolvedBy" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlayerFeedback_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlayerStorageItem_userId_key_key" ON "PlayerStorageItem"("userId", "key");
CREATE INDEX "PlayerStorageItem_userId_visibility_displayOrder_idx" ON "PlayerStorageItem"("userId", "visibility", "displayOrder");
CREATE INDEX "PlayerStorageItem_key_visibility_idx" ON "PlayerStorageItem"("key", "visibility");
CREATE UNIQUE INDEX "StoredFile_objectKey_key" ON "StoredFile"("objectKey");
CREATE INDEX "StoredFile_userId_purpose_status_idx" ON "StoredFile"("userId", "purpose", "status");
CREATE INDEX "StoredFile_purpose_status_createdAt_idx" ON "StoredFile"("purpose", "status", "createdAt");
CREATE UNIQUE INDEX "FeedbackCategory_key_key" ON "FeedbackCategory"("key");
CREATE INDEX "FeedbackCategory_entity_active_sortOrder_idx" ON "FeedbackCategory"("entity", "active", "sortOrder");
CREATE INDEX "PlayerFeedback_userId_createdAt_idx" ON "PlayerFeedback"("userId", "createdAt");
CREATE INDEX "PlayerFeedback_entity_status_createdAt_idx" ON "PlayerFeedback"("entity", "status", "createdAt");
CREATE INDEX "PlayerFeedback_categoryId_createdAt_idx" ON "PlayerFeedback"("categoryId", "createdAt");

ALTER TABLE "PlayerStorageItem" ADD CONSTRAINT "PlayerStorageItem_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StoredFile" ADD CONSTRAINT "StoredFile_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PlayerFeedback" ADD CONSTRAINT "PlayerFeedback_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlayerFeedback" ADD CONSTRAINT "PlayerFeedback_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "FeedbackCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "FeedbackCategory" ("key", "entity", "name", "description", "sortOrder", "updatedAt") VALUES
  ('game-bug', 'GAME', 'Game bug', 'Report a problem with a game or round.', 1, CURRENT_TIMESTAMP),
  ('gameplay', 'GAME', 'Gameplay feedback', 'Share feedback about game balance or controls.', 2, CURRENT_TIMESTAMP),
  ('player-report', 'PLAYER', 'Player report', 'Report abusive or suspicious player behavior.', 1, CURRENT_TIMESTAMP),
  ('profile', 'PLAYER', 'Profile feedback', 'Report an issue with a player profile.', 2, CURRENT_TIMESTAMP),
  ('ugc', 'UGC', 'Community content', 'Report community-created content.', 1, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
