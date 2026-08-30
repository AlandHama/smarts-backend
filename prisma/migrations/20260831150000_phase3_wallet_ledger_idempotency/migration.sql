-- Phase 3 adds the idempotency link required by every wallet ledger mutation.
-- Existing Phase 1/2 balances remain unchanged; this is a greenfield install
-- and no opening balance is imported.
ALTER TABLE "WalletTransaction"
  ADD COLUMN "idempotencyKeyId" UUID;

CREATE INDEX "WalletTransaction_idempotencyKeyId_idx"
  ON "WalletTransaction"("idempotencyKeyId");

