-- Provider submission, signed callback reconciliation, polling, and final hold handling.
ALTER TYPE "CryptoPayoutRequestStatus" ADD VALUE IF NOT EXISTS 'SUBMITTING';
ALTER TYPE "CryptoPayoutRequestStatus" ADD VALUE IF NOT EXISTS 'CREATED';
ALTER TYPE "CryptoPayoutRequestStatus" ADD VALUE IF NOT EXISTS 'AWAITING_PROVIDER_VERIFICATION';
ALTER TYPE "CryptoPayoutRequestStatus" ADD VALUE IF NOT EXISTS 'PROCESSING';
ALTER TYPE "CryptoPayoutRequestStatus" ADD VALUE IF NOT EXISTS 'SENDING';
ALTER TYPE "CryptoPayoutRequestStatus" ADD VALUE IF NOT EXISTS 'COMPLETED';
ALTER TYPE "CryptoPayoutRequestStatus" ADD VALUE IF NOT EXISTS 'REFUNDED';
ALTER TYPE "CryptoPayoutRequestStatus" ADD VALUE IF NOT EXISTS 'FAILED_RETRYABLE';
ALTER TYPE "CryptoPayoutRequestStatus" ADD VALUE IF NOT EXISTS 'REQUOTE_REQUIRED';

ALTER TABLE "CryptoPayoutRequest"
  ADD COLUMN "providerStatusSnapshot" JSONB,
  ADD COLUMN "providerLastEventAt" TIMESTAMP(3),
  ADD COLUMN "nextPollAt" TIMESTAMP(3),
  ADD COLUMN "pollAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "submissionAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "providerVerificationRequired" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "providerVerificationAt" TIMESTAMP(3);

CREATE INDEX "CryptoPayoutRequest_status_nextPollAt_idx" ON "CryptoPayoutRequest"("status", "nextPollAt");
