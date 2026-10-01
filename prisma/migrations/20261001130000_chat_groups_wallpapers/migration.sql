ALTER TYPE "ChatConversationType" ADD VALUE 'GROUP';

CREATE TYPE "ChatParticipantRole" AS ENUM ('MEMBER', 'ADMIN');

ALTER TABLE "ChatConversation" ALTER COLUMN "pairKey" DROP NOT NULL;
ALTER TABLE "ChatConversation" ADD COLUMN "name" VARCHAR(80);
ALTER TABLE "ChatConversation" ADD COLUMN "imageUrl" TEXT;
ALTER TABLE "ChatConversation" ADD COLUMN "createdById" UUID;
ALTER TABLE "ChatConversation" ADD CONSTRAINT "ChatConversation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "ChatConversation_createdById_idx" ON "ChatConversation"("createdById");

ALTER TABLE "ChatParticipant" ADD COLUMN "role" "ChatParticipantRole" NOT NULL DEFAULT 'MEMBER';
ALTER TABLE "ChatParticipant" ADD COLUMN "wallpaperKey" VARCHAR(80);
