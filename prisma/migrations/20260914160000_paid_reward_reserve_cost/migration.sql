-- Lock the GLD price used for each paid reward and record the USD reserve cost
-- consumed when the reward is fulfilled. Existing requests remain legacy rows.
ALTER TABLE "PaidRewardRequest"
  ADD COLUMN "gldUnitPriceUsdMicros" BIGINT,
  ADD COLUMN "reserveCostUsdMicros" BIGINT,
  ADD COLUMN "gldFeeAmount" BIGINT,
  ADD COLUMN "gldChargedAmount" BIGINT;

-- Requests created by the previous implementation were charged immediately.
-- Preserve that fact so a refusal can still compensate those historical rows,
-- while all new requests remain uncharged until fulfillment.
UPDATE "PaidRewardRequest"
SET "gldChargedAmount" = "gldPrice"
WHERE "gldPrice" IS NOT NULL;
