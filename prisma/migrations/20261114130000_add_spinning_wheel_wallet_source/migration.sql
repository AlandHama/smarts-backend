-- The spinning-wheel module writes a dedicated wallet source so its
-- purchases and ad-claimed GLD rewards remain identifiable in the ledger.
-- The table migration created the wheel tables but did not extend the
-- existing enum, which caused PostgreSQL to reject every wheel wallet entry.
ALTER TYPE "WalletTransactionSourceType"
  ADD VALUE IF NOT EXISTS 'SPINNING_WHEEL';
