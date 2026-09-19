ALTER TABLE "GldAdminControl"
  ADD COLUMN "adDailyGldCap" BIGINT,
  ADD COLUMN "adMaxValidatedAds" INTEGER,
  ADD COLUMN "adMaxRewardPerClaim" BIGINT,
  ADD COLUMN "giftBurnBps" INTEGER,
  ADD COLUMN "paidRewardSafetyMarginBps" INTEGER,
  ADD COLUMN "paidRewardDailyRequestLimit" INTEGER;

CREATE TABLE "ReferralPlayerOverride" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "enabled" BOOLEAN,
    "maxInvitesPerUser" INTEGER,
    "rewardBps" INTEGER,
    "maxRewardPerReferral" BIGINT,
    "minQualifyingAds" INTEGER,
    "updatedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ReferralPlayerOverride_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReferralPlayerOverride_userId_key" ON "ReferralPlayerOverride"("userId");
CREATE INDEX "ReferralPlayerOverride_updatedAt_idx" ON "ReferralPlayerOverride"("updatedAt");
ALTER TABLE "ReferralPlayerOverride"
  ADD CONSTRAINT "ReferralPlayerOverride_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
