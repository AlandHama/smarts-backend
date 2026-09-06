-- Paid reward requests are reviewed by system administrators. Redeem codes
-- are single-use inventory backing and are never accepted from the client as
-- an entitlement or wallet amount.
ALTER TYPE "InventoryAcquisitionSource" ADD VALUE IF NOT EXISTS 'PAID_REWARD';

DO $$ BEGIN CREATE TYPE "PaidRewardRequestStatus" AS ENUM ('PENDING', 'FULFILLED', 'REFUSED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "AssetRedeemCodeStatus" AS ENUM ('AVAILABLE', 'ASSIGNED', 'VOID'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE "AssetRedeemCode" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "assetDefinitionId" UUID NOT NULL,
  "assetVariationId" UUID,
  "code" TEXT NOT NULL,
  "codeHash" CHAR(64) NOT NULL,
  "status" "AssetRedeemCodeStatus" NOT NULL DEFAULT 'AVAILABLE',
  "assignedUserId" UUID,
  "assignedAt" TIMESTAMP(3),
  "requestId" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AssetRedeemCode_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PaidRewardRequest" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "assetDefinitionId" UUID NOT NULL,
  "assetVariationId" UUID,
  "status" "PaidRewardRequestStatus" NOT NULL DEFAULT 'PENDING',
  "requestKey" VARCHAR(128) NOT NULL,
  "message" VARCHAR(500),
  "adminNote" VARCHAR(500),
  "inventoryItemId" UUID,
  "idempotencyKeyId" UUID NOT NULL,
  "decidedById" UUID,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decidedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaidRewardRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AssetRedeemCode_codeHash_key" ON "AssetRedeemCode"("codeHash");
CREATE UNIQUE INDEX "AssetRedeemCode_requestId_key" ON "AssetRedeemCode"("requestId");
CREATE UNIQUE INDEX "PaidRewardRequest_requestKey_key" ON "PaidRewardRequest"("requestKey");
CREATE UNIQUE INDEX "PaidRewardRequest_idempotencyKeyId_key" ON "PaidRewardRequest"("idempotencyKeyId");
CREATE INDEX "AssetRedeemCode_assetDefinitionId_assetVariationId_status_createdAt_idx" ON "AssetRedeemCode"("assetDefinitionId", "assetVariationId", "status", "createdAt");
CREATE INDEX "AssetRedeemCode_assignedUserId_status_createdAt_idx" ON "AssetRedeemCode"("assignedUserId", "status", "createdAt");
CREATE INDEX "PaidRewardRequest_status_requestedAt_idx" ON "PaidRewardRequest"("status", "requestedAt");
CREATE INDEX "PaidRewardRequest_userId_status_requestedAt_idx" ON "PaidRewardRequest"("userId", "status", "requestedAt");
CREATE INDEX "PaidRewardRequest_assetDefinitionId_assetVariationId_status_idx" ON "PaidRewardRequest"("assetDefinitionId", "assetVariationId", "status");

ALTER TABLE "AssetRedeemCode" ADD CONSTRAINT "AssetRedeemCode_assetDefinitionId_fkey" FOREIGN KEY ("assetDefinitionId") REFERENCES "AssetDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssetRedeemCode" ADD CONSTRAINT "AssetRedeemCode_assetVariationId_fkey" FOREIGN KEY ("assetVariationId") REFERENCES "AssetVariation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AssetRedeemCode" ADD CONSTRAINT "AssetRedeemCode_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AssetRedeemCode" ADD CONSTRAINT "AssetRedeemCode_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "PaidRewardRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PaidRewardRequest" ADD CONSTRAINT "PaidRewardRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PaidRewardRequest" ADD CONSTRAINT "PaidRewardRequest_assetDefinitionId_fkey" FOREIGN KEY ("assetDefinitionId") REFERENCES "AssetDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaidRewardRequest" ADD CONSTRAINT "PaidRewardRequest_assetVariationId_fkey" FOREIGN KEY ("assetVariationId") REFERENCES "AssetVariation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaidRewardRequest" ADD CONSTRAINT "PaidRewardRequest_idempotencyKeyId_fkey" FOREIGN KEY ("idempotencyKeyId") REFERENCES "IdempotencyKey"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaidRewardRequest" ADD CONSTRAINT "PaidRewardRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
