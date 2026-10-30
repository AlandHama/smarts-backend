ALTER TABLE "GldAdminControl"
  ADD COLUMN "admobPlayerRewardAllocationBps" INTEGER,
  ADD COLUMN "admobCompanyProfitAllocationBps" INTEGER;

-- Keep the persisted policy aligned with the new three-way split. The one-BPS
-- remainder is assigned to company profit because allocations are integers.
UPDATE "GldAdminControl"
SET
  "admobPlayerRewardAllocationBps" = 3333,
  "admobReserveAllocationBps" = 3333,
  "admobCompanyProfitAllocationBps" = 3334
WHERE "singletonKey" = 'default';
