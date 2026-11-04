-- Store the server-controlled opening time shared by the rewards surfaces.
ALTER TABLE "CryptoRewardConfig"
  ADD COLUMN "rewardsOpeningAt" TIMESTAMP(3);
