-- GLD-5/GLD-6: snapshot the GLD reservation and any compensating refund on
-- paid reward requests. Existing requests remain valid as legacy free claims.
ALTER TABLE "PaidRewardRequest"
  ADD COLUMN "gldPrice" BIGINT,
  ADD COLUMN "gldRefundedAmount" BIGINT NOT NULL DEFAULT 0;
