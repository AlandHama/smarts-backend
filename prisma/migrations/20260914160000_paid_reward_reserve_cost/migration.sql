-- Lock the GLD price used for each paid reward and record the USD reserve cost
-- consumed when the reward is fulfilled. Existing requests remain legacy rows.
ALTER TABLE "PaidRewardRequest"
  ADD COLUMN "gldUnitPriceUsdMicros" BIGINT,
  ADD COLUMN "reserveCostUsdMicros" BIGINT,
  ADD COLUMN "gldFeeAmount" BIGINT;
