-- Older policy rows could have a zero/null decimal amount after the
-- fractional-reward migration even though their legacy integer amount was
-- positive. Restore the exact amount used by the reward pipeline.
UPDATE "GldAdRewardPolicy"
SET "rewardAmountDecimal" = "rewardAmount"
WHERE ("rewardAmountDecimal" IS NULL OR "rewardAmountDecimal" <= 0)
  AND "rewardAmount" > 0;
