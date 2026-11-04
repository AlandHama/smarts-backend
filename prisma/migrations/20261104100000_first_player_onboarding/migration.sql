ALTER TABLE "User"
  ADD COLUMN "onboardingCompletedAt" TIMESTAMP(3);

-- Existing accounts have already used the product and should not be shown
-- the first-time onboarding flow after this migration.
UPDATE "User"
SET "onboardingCompletedAt" = "createdAt"
WHERE "onboardingCompletedAt" IS NULL;
