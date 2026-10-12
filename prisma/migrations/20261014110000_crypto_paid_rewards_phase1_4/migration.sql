-- Crypto paid rewards phases 1-4: provider-ready payout requests, quotes,
-- GLD holds, and administrator approval. Provider submission is a later phase.

ALTER TYPE "WalletTransactionSourceType" ADD VALUE IF NOT EXISTS 'CRYPTO_PAYOUT';

CREATE TYPE "CryptoPayoutRequestStatus" AS ENUM (
  'PENDING_ADMIN_APPROVAL',
  'APPROVED',
  'REJECTED',
  'EXPIRED',
  'ADDRESS_INVALID',
  'RECONCILIATION_REQUIRED'
);

CREATE TYPE "CryptoPayoutHoldStatus" AS ENUM (
  'HELD',
  'CONSUMED',
  'RELEASED',
  'EXPIRED'
);

CREATE TABLE "CryptoRewardConfig" (
  "id" UUID NOT NULL,
  "singletonKey" VARCHAR(32) NOT NULL DEFAULT 'default',
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "networkCode" VARCHAR(32) NOT NULL DEFAULT 'SOLANA',
  "usdtSolGldPerUnit" DECIMAL(30,6) NOT NULL DEFAULT 0,
  "usdcSolGldPerUnit" DECIMAL(30,6) NOT NULL DEFAULT 0,
  "rateVersion" VARCHAR(80) NOT NULL DEFAULT 'initial',
  "platformFeeBps" INTEGER NOT NULL DEFAULT 0,
  "quoteTtlSeconds" INTEGER NOT NULL DEFAULT 300,
  "maxQuoteDriftBps" INTEGER NOT NULL DEFAULT 500,
  "minGld" BIGINT NOT NULL DEFAULT 100,
  "maxGldPerRequest" BIGINT NOT NULL DEFAULT 100000,
  "dailyGldLimit" BIGINT NOT NULL DEFAULT 200000,
  "maxPendingPerUser" INTEGER NOT NULL DEFAULT 1,
  "holdExpiryHours" INTEGER NOT NULL DEFAULT 72,
  "minProviderReserveUsd" DECIMAL(30,6),
  "requireAdminApproval" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CryptoRewardConfig_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CryptoPayoutQuote" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "currencyCode" VARCHAR(16) NOT NULL,
  "networkCode" VARCHAR(32) NOT NULL,
  "destinationAddressHash" CHAR(64) NOT NULL,
  "destinationAddressMasked" VARCHAR(80) NOT NULL,
  "gldAmount" BIGINT NOT NULL,
  "gldRatePerStablecoin" DECIMAL(30,6) NOT NULL,
  "gldRateVersion" VARCHAR(80) NOT NULL,
  "platformFeeBps" INTEGER NOT NULL DEFAULT 0,
  "platformFeeCrypto" DECIMAL(30,9) NOT NULL,
  "providerFeeCrypto" DECIMAL(30,9) NOT NULL,
  "providerFeeCurrency" VARCHAR(16) NOT NULL,
  "grossCryptoAmount" DECIMAL(30,9) NOT NULL,
  "netCryptoAmount" DECIMAL(30,9) NOT NULL,
  "minimumPayoutAmount" DECIMAL(30,9) NOT NULL,
  "quoteSnapshot" JSONB NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CryptoPayoutQuote_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CryptoPayoutRequest" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "status" "CryptoPayoutRequestStatus" NOT NULL DEFAULT 'PENDING_ADMIN_APPROVAL',
  "requestKey" VARCHAR(128) NOT NULL,
  "idempotencyKeyId" UUID NOT NULL,
  "currencyCode" VARCHAR(16) NOT NULL,
  "networkCode" VARCHAR(32) NOT NULL,
  "destinationAddressCiphertext" TEXT NOT NULL,
  "destinationAddressHash" CHAR(64) NOT NULL,
  "destinationAddressMasked" VARCHAR(80) NOT NULL,
  "addressValidatedAt" TIMESTAMP(3),
  "addressValidationProvider" VARCHAR(40),
  "addressValidationCode" VARCHAR(80),
  "gldRequested" BIGINT NOT NULL,
  "gldHeld" BIGINT NOT NULL,
  "gldReleased" BIGINT NOT NULL DEFAULT 0,
  "gldCharged" BIGINT NOT NULL DEFAULT 0,
  "gldRatePerStablecoinSnapshot" DECIMAL(30,6) NOT NULL,
  "gldRateVersion" VARCHAR(80) NOT NULL,
  "platformFeeBpsSnapshot" INTEGER NOT NULL DEFAULT 0,
  "platformFeeCrypto" DECIMAL(30,9) NOT NULL,
  "providerFeeCrypto" DECIMAL(30,9) NOT NULL,
  "providerFeeCurrency" VARCHAR(16) NOT NULL,
  "grossCryptoAmount" DECIMAL(30,9) NOT NULL,
  "netCryptoAmount" DECIMAL(30,9) NOT NULL,
  "quoteExpiresAt" TIMESTAMP(3) NOT NULL,
  "quoteSnapshot" JSONB NOT NULL,
  "providerName" VARCHAR(40),
  "providerEnvironment" VARCHAR(20),
  "providerUniqueExternalId" VARCHAR(255),
  "providerBatchWithdrawalId" VARCHAR(255),
  "providerPayoutId" VARCHAR(255),
  "providerStatus" VARCHAR(40),
  "providerStatusRaw" VARCHAR(80),
  "providerErrorCode" VARCHAR(120),
  "providerErrorMessageRedacted" VARCHAR(500),
  "transactionHash" VARCHAR(255),
  "providerCreatedAt" TIMESTAMP(3),
  "providerUpdatedAt" TIMESTAMP(3),
  "adminDecision" VARCHAR(20),
  "adminId" UUID,
  "adminNote" VARCHAR(500),
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "approvedAt" TIMESTAMP(3),
  "rejectedAt" TIMESTAMP(3),
  "submittedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "holdExpiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CryptoPayoutRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CryptoPayoutHold" (
  "id" UUID NOT NULL,
  "requestId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "amount" BIGINT NOT NULL,
  "released" BIGINT NOT NULL DEFAULT 0,
  "status" "CryptoPayoutHoldStatus" NOT NULL DEFAULT 'HELD',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "releasedAt" TIMESTAMP(3),
  "consumedAt" TIMESTAMP(3),
  CONSTRAINT "CryptoPayoutHold_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CryptoRewardConfig_singletonKey_key" ON "CryptoRewardConfig"("singletonKey");
CREATE INDEX "CryptoPayoutQuote_userId_createdAt_idx" ON "CryptoPayoutQuote"("userId", "createdAt");
CREATE INDEX "CryptoPayoutQuote_expiresAt_idx" ON "CryptoPayoutQuote"("expiresAt");
CREATE UNIQUE INDEX "CryptoPayoutRequest_requestKey_key" ON "CryptoPayoutRequest"("requestKey");
CREATE UNIQUE INDEX "CryptoPayoutRequest_idempotencyKeyId_key" ON "CryptoPayoutRequest"("idempotencyKeyId");
CREATE UNIQUE INDEX "CryptoPayoutRequest_providerUniqueExternalId_key" ON "CryptoPayoutRequest"("providerUniqueExternalId");
CREATE UNIQUE INDEX "CryptoPayoutRequest_providerBatchWithdrawalId_key" ON "CryptoPayoutRequest"("providerBatchWithdrawalId");
CREATE UNIQUE INDEX "CryptoPayoutRequest_providerPayoutId_key" ON "CryptoPayoutRequest"("providerPayoutId");
CREATE INDEX "CryptoPayoutRequest_userId_createdAt_idx" ON "CryptoPayoutRequest"("userId", "createdAt");
CREATE INDEX "CryptoPayoutRequest_status_createdAt_idx" ON "CryptoPayoutRequest"("status", "createdAt");
CREATE INDEX "CryptoPayoutRequest_providerStatus_updatedAt_idx" ON "CryptoPayoutRequest"("providerStatus", "updatedAt");
CREATE INDEX "CryptoPayoutRequest_destinationAddressHash_currencyCode_idx" ON "CryptoPayoutRequest"("destinationAddressHash", "currencyCode");
CREATE UNIQUE INDEX "CryptoPayoutHold_requestId_key" ON "CryptoPayoutHold"("requestId");
CREATE INDEX "CryptoPayoutHold_userId_status_expiresAt_idx" ON "CryptoPayoutHold"("userId", "status", "expiresAt");

ALTER TABLE "CryptoPayoutQuote" ADD CONSTRAINT "CryptoPayoutQuote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CryptoPayoutRequest" ADD CONSTRAINT "CryptoPayoutRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CryptoPayoutRequest" ADD CONSTRAINT "CryptoPayoutRequest_idempotencyKeyId_fkey" FOREIGN KEY ("idempotencyKeyId") REFERENCES "IdempotencyKey"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CryptoPayoutRequest" ADD CONSTRAINT "CryptoPayoutRequest_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CryptoPayoutHold" ADD CONSTRAINT "CryptoPayoutHold_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "CryptoPayoutRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CryptoPayoutHold" ADD CONSTRAINT "CryptoPayoutHold_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
