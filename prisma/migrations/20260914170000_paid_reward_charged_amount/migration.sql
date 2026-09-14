-- Add the fulfillment-time charge marker in a new migration. The preceding
-- paid-reward migration may already be applied in production and must remain
-- immutable so Prisma can advance the migration history safely.
ALTER TABLE "PaidRewardRequest"
  ADD COLUMN "gldChargedAmount" BIGINT;

-- Requests created by the previous implementation were charged immediately.
-- Preserve that fact so a refusal can still compensate those historical rows,
-- while all new requests remain uncharged until fulfillment.
UPDATE "PaidRewardRequest"
SET "gldChargedAmount" = "gldPrice"
WHERE "gldPrice" IS NOT NULL;
