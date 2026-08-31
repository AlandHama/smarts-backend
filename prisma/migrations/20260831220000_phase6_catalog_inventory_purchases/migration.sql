-- Phase 6: server-owned catalog, assets, inventory, purchases and entitlements.
-- This is intentionally greenfield: no LootLocker/Firebase identifiers are imported.
DO $$ BEGIN CREATE TYPE "AssetType" AS ENUM ('COSMETIC', 'CONSUMABLE', 'CHARACTER', 'SKIN', 'BOOSTER', 'BUNDLE', 'OTHER'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "AssetOwnershipPolicy" AS ENUM ('STACKABLE', 'UNIQUE'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "InventoryAcquisitionSource" AS ENUM ('PURCHASE', 'PROGRESSION', 'ADMIN', 'MATCH', 'SIGNUP', 'SYSTEM'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "CatalogRewardType" AS ENUM ('ASSET', 'CURRENCY', 'PROGRESSION_POINTS', 'PROGRESSION_RESET', 'ENTITLEMENT'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "PurchaseStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'REFUNDED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "EntitlementStatus" AS ENUM ('ACTIVE', 'REVOKED', 'EXPIRED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "AssetDefinition" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "key" VARCHAR(100) NOT NULL, "name" VARCHAR(120) NOT NULL,
  "description" TEXT, "assetType" "AssetType" NOT NULL, "ownershipPolicy" "AssetOwnershipPolicy" NOT NULL DEFAULT 'STACKABLE',
  "imageUrl" TEXT, "imageAlt" VARCHAR(160), "imageUrls" JSONB, "active" BOOLEAN NOT NULL DEFAULT true,
  "metadata" JSONB, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AssetDefinition_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "AssetVariation" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "assetDefinitionId" UUID NOT NULL, "key" VARCHAR(100) NOT NULL,
  "name" VARCHAR(120), "imageUrl" TEXT, "imageAlt" VARCHAR(160), "imageUrls" JSONB, "active" BOOLEAN NOT NULL DEFAULT true,
  "metadata" JSONB, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AssetVariation_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "Catalog" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "key" VARCHAR(80) NOT NULL, "name" VARCHAR(120) NOT NULL,
  "description" TEXT, "active" BOOLEAN NOT NULL DEFAULT true, "startsAt" TIMESTAMP(3), "endsAt" TIMESTAMP(3),
  "metadata" JSONB, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Catalog_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "CatalogItem" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "catalogId" UUID NOT NULL, "key" VARCHAR(100) NOT NULL,
  "name" VARCHAR(120) NOT NULL, "description" TEXT, "assetDefinitionId" UUID, "imageUrl" TEXT, "imageAlt" VARCHAR(160),
  "imageUrls" JSONB, "purchasable" BOOLEAN NOT NULL DEFAULT true, "active" BOOLEAN NOT NULL DEFAULT true,
  "startsAt" TIMESTAMP(3), "endsAt" TIMESTAMP(3), "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CatalogItem_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "CatalogPrice" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "catalogItemId" UUID NOT NULL, "currencyId" UUID NOT NULL,
  "amount" BIGINT NOT NULL, "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CatalogPrice_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "CatalogReward" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "catalogItemId" UUID NOT NULL, "rewardType" "CatalogRewardType" NOT NULL,
  "assetDefinitionId" UUID, "assetVariationId" UUID, "currencyId" UUID, "progressionDefinitionId" UUID,
  "targetKey" VARCHAR(120), "amount" BIGINT, "quantity" INTEGER NOT NULL DEFAULT 1, "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "metadata" JSONB, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CatalogReward_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "InventoryItem" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "instanceId" UUID NOT NULL DEFAULT gen_random_uuid(), "stackKey" TEXT,
  "userId" UUID NOT NULL, "assetDefinitionId" UUID NOT NULL, "assetVariationId" UUID, "quantity" INTEGER NOT NULL DEFAULT 1,
  "acquisitionSource" "InventoryAcquisitionSource" NOT NULL, "sourceId" VARCHAR(255) NOT NULL, "rentalExpiresAt" TIMESTAMP(3),
  "metadata" JSONB, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InventoryItem_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "Purchase" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "userId" UUID NOT NULL, "status" "PurchaseStatus" NOT NULL DEFAULT 'PENDING',
  "currencyId" UUID NOT NULL, "totalAmount" BIGINT NOT NULL, "idempotencyKeyId" UUID NOT NULL,
  "provider" VARCHAR(40), "providerReference" VARCHAR(255), "failureReason" TEXT, "metadata" JSONB,
  "completedAt" TIMESTAMP(3), "refundedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "Purchase_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "PurchaseLine" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "purchaseId" UUID NOT NULL, "catalogItemId" UUID,
  "itemKeySnapshot" VARCHAR(100) NOT NULL, "itemNameSnapshot" VARCHAR(120) NOT NULL, "quantity" INTEGER NOT NULL,
  "unitAmount" BIGINT NOT NULL, "totalAmount" BIGINT NOT NULL, "rewardSnapshot" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "PurchaseLine_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "Entitlement" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "userId" UUID NOT NULL, "entitlementKey" VARCHAR(160) NOT NULL,
  "assetDefinitionId" UUID, "status" "EntitlementStatus" NOT NULL DEFAULT 'ACTIVE', "sourceType" VARCHAR(40) NOT NULL,
  "sourceId" VARCHAR(255) NOT NULL, "expiresAt" TIMESTAMP(3), "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Entitlement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AssetDefinition_key_key" ON "AssetDefinition"("key");
CREATE UNIQUE INDEX IF NOT EXISTS "AssetVariation_assetDefinitionId_key_key" ON "AssetVariation"("assetDefinitionId", "key");
CREATE UNIQUE INDEX IF NOT EXISTS "Catalog_key_key" ON "Catalog"("key");
CREATE UNIQUE INDEX IF NOT EXISTS "CatalogItem_catalogId_key_key" ON "CatalogItem"("catalogId", "key");
CREATE UNIQUE INDEX IF NOT EXISTS "CatalogPrice_catalogItemId_currencyId_key" ON "CatalogPrice"("catalogItemId", "currencyId");
CREATE UNIQUE INDEX IF NOT EXISTS "InventoryItem_instanceId_key" ON "InventoryItem"("instanceId");
CREATE UNIQUE INDEX IF NOT EXISTS "InventoryItem_stackKey_key" ON "InventoryItem"("stackKey") WHERE "stackKey" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "Purchase_idempotencyKeyId_key" ON "Purchase"("idempotencyKeyId");
CREATE UNIQUE INDEX IF NOT EXISTS "Purchase_providerReference_key" ON "Purchase"("providerReference") WHERE "providerReference" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "Entitlement_userId_entitlementKey_key" ON "Entitlement"("userId", "entitlementKey");
CREATE INDEX IF NOT EXISTS "AssetDefinition_active_assetType_idx" ON "AssetDefinition"("active", "assetType");
CREATE INDEX IF NOT EXISTS "AssetVariation_assetDefinitionId_active_idx" ON "AssetVariation"("assetDefinitionId", "active");
CREATE INDEX IF NOT EXISTS "Catalog_active_startsAt_endsAt_idx" ON "Catalog"("active", "startsAt", "endsAt");
CREATE INDEX IF NOT EXISTS "CatalogItem_catalogId_active_startsAt_endsAt_idx" ON "CatalogItem"("catalogId", "active", "startsAt", "endsAt");
CREATE INDEX IF NOT EXISTS "CatalogItem_assetDefinitionId_idx" ON "CatalogItem"("assetDefinitionId");
CREATE INDEX IF NOT EXISTS "CatalogPrice_currencyId_active_idx" ON "CatalogPrice"("currencyId", "active");
CREATE INDEX IF NOT EXISTS "CatalogReward_catalogItemId_sortOrder_idx" ON "CatalogReward"("catalogItemId", "sortOrder");
CREATE INDEX IF NOT EXISTS "InventoryItem_userId_createdAt_idx" ON "InventoryItem"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "InventoryItem_userId_assetDefinitionId_assetVariationId_idx" ON "InventoryItem"("userId", "assetDefinitionId", "assetVariationId");
CREATE INDEX IF NOT EXISTS "InventoryItem_sourceId_idx" ON "InventoryItem"("sourceId");
CREATE INDEX IF NOT EXISTS "Purchase_userId_createdAt_idx" ON "Purchase"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "Purchase_status_createdAt_idx" ON "Purchase"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "PurchaseLine_purchaseId_idx" ON "PurchaseLine"("purchaseId");
CREATE INDEX IF NOT EXISTS "PurchaseLine_catalogItemId_idx" ON "PurchaseLine"("catalogItemId");
CREATE INDEX IF NOT EXISTS "Entitlement_userId_status_expiresAt_idx" ON "Entitlement"("userId", "status", "expiresAt");
CREATE INDEX IF NOT EXISTS "Entitlement_assetDefinitionId_idx" ON "Entitlement"("assetDefinitionId");

DO $$ BEGIN ALTER TABLE "AssetVariation" ADD CONSTRAINT "AssetVariation_assetDefinitionId_fkey" FOREIGN KEY ("assetDefinitionId") REFERENCES "AssetDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "CatalogItem" ADD CONSTRAINT "CatalogItem_catalogId_fkey" FOREIGN KEY ("catalogId") REFERENCES "Catalog"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "CatalogItem" ADD CONSTRAINT "CatalogItem_assetDefinitionId_fkey" FOREIGN KEY ("assetDefinitionId") REFERENCES "AssetDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "CatalogPrice" ADD CONSTRAINT "CatalogPrice_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "CatalogItem"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "CatalogPrice" ADD CONSTRAINT "CatalogPrice_currencyId_fkey" FOREIGN KEY ("currencyId") REFERENCES "CurrencyDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "CatalogReward" ADD CONSTRAINT "CatalogReward_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "CatalogItem"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "CatalogReward" ADD CONSTRAINT "CatalogReward_assetDefinitionId_fkey" FOREIGN KEY ("assetDefinitionId") REFERENCES "AssetDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "CatalogReward" ADD CONSTRAINT "CatalogReward_assetVariationId_fkey" FOREIGN KEY ("assetVariationId") REFERENCES "AssetVariation"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "CatalogReward" ADD CONSTRAINT "CatalogReward_currencyId_fkey" FOREIGN KEY ("currencyId") REFERENCES "CurrencyDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "CatalogReward" ADD CONSTRAINT "CatalogReward_progressionDefinitionId_fkey" FOREIGN KEY ("progressionDefinitionId") REFERENCES "ProgressionDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_assetDefinitionId_fkey" FOREIGN KEY ("assetDefinitionId") REFERENCES "AssetDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_assetVariationId_fkey" FOREIGN KEY ("assetVariationId") REFERENCES "AssetVariation"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_currencyId_fkey" FOREIGN KEY ("currencyId") REFERENCES "CurrencyDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_idempotencyKeyId_fkey" FOREIGN KEY ("idempotencyKeyId") REFERENCES "IdempotencyKey"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "PurchaseLine" ADD CONSTRAINT "PurchaseLine_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "PurchaseLine" ADD CONSTRAINT "PurchaseLine_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "CatalogItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "Entitlement" ADD CONSTRAINT "Entitlement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "Entitlement" ADD CONSTRAINT "Entitlement_assetDefinitionId_fkey" FOREIGN KEY ("assetDefinitionId") REFERENCES "AssetDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- SMARTS uses `main` as its default catalog key. It starts empty so catalog
-- owners can publish only approved items from the system-admin console.
INSERT INTO "Catalog" ("key", "name", "active", "updatedAt")
VALUES ('main', 'Main Store', true, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
