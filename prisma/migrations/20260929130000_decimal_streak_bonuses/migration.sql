ALTER TABLE "StreakConfiguration"
  ALTER COLUMN "maxBonusPercent" TYPE DECIMAL(20,6)
  USING "maxBonusPercent"::DECIMAL(20,6);

ALTER TABLE "StreakMilestone"
  ALTER COLUMN "bonusPercent" TYPE DECIMAL(20,6)
  USING "bonusPercent"::DECIMAL(20,6);
