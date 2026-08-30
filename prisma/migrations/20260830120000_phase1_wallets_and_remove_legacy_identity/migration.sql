-- Phase 1 starts from an empty player database. The provider identity columns
-- are not part of the new UUID authority and are removed before registration.
DROP INDEX IF EXISTS "User_firebaseUid_key";
DROP INDEX IF EXISTS "User_lootLockerPlayerId_key";

ALTER TABLE "User" DROP COLUMN IF EXISTS "firebaseUid";
ALTER TABLE "User" DROP COLUMN IF EXISTS "lootLockerPlayerId";

CREATE TYPE "CurrencyKind" AS ENUM ('SOFT', 'HARD', 'PREMIUM', 'EVENT');
CREATE TYPE "WalletType" AS ENUM ('PLAYER', 'SYSTEM');
CREATE TYPE "WalletStatus" AS ENUM ('ACTIVE', 'LOCKED', 'CLOSED');

CREATE TABLE "CurrencyDefinition" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(32) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "kind" "CurrencyKind" NOT NULL,
    "precision" SMALLINT NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CurrencyDefinition_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Wallet" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "walletType" "WalletType" NOT NULL DEFAULT 'PLAYER',
    "status" "WalletStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WalletBalance" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "walletId" UUID NOT NULL,
    "currencyId" UUID NOT NULL,
    "amount" BIGINT NOT NULL DEFAULT 0,
    "version" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WalletBalance_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CurrencyDefinition_code_key" ON "CurrencyDefinition"("code");
CREATE UNIQUE INDEX "Wallet_userId_key" ON "Wallet"("userId");
CREATE UNIQUE INDEX "WalletBalance_walletId_currencyId_key" ON "WalletBalance"("walletId", "currencyId");
CREATE INDEX "WalletBalance_currencyId_idx" ON "WalletBalance"("currencyId");

ALTER TABLE "Wallet"
  ADD CONSTRAINT "Wallet_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WalletBalance"
  ADD CONSTRAINT "WalletBalance_walletId_fkey"
  FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WalletBalance"
  ADD CONSTRAINT "WalletBalance_currencyId_fkey"
  FOREIGN KEY ("currencyId") REFERENCES "CurrencyDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- MCN and GLD are the SMARTS Phase 1 currencies. Values start at zero; all
-- player-owned signup grants are issued by the registration transaction.
INSERT INTO "CurrencyDefinition" ("code", "name", "kind", "precision", "active", "updatedAt")
VALUES
  ('MCN', 'MCN', 'SOFT', 0, true, CURRENT_TIMESTAMP),
  ('GLD', 'Gold', 'HARD', 0, true, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;
