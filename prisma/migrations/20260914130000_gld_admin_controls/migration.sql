-- GLD-7: persisted emergency controls for operator-managed economy safety.
CREATE TABLE "GldAdminControl" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "singletonKey" VARCHAR(32) NOT NULL DEFAULT 'default',
  "emissionsPaused" BOOLEAN NOT NULL DEFAULT false,
  "catalogSinksPaused" BOOLEAN NOT NULL DEFAULT false,
  "giftsPaused" BOOLEAN NOT NULL DEFAULT false,
  "paidRewardsPaused" BOOLEAN NOT NULL DEFAULT false,
  "reason" VARCHAR(500),
  "updatedById" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GldAdminControl_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GldAdminControl_singletonKey_key" ON "GldAdminControl"("singletonKey");
ALTER TABLE "GldAdminControl" ADD CONSTRAINT "GldAdminControl_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
