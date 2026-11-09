-- Convert date-authored hints into a reusable pool. This migration is written
-- to be safely retryable after a failed deployment: Railway may preserve part
-- of a DDL migration when the process is interrupted.

CREATE TABLE IF NOT EXISTS "DailyHintSelection" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "dateKey" VARCHAR(10) NOT NULL,
    "hintId" UUID NOT NULL,
    "selectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyHintSelection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DailyHintSelection_dateKey_key"
  ON "DailyHintSelection"("dateKey");

ALTER TABLE "DailyHintView"
  ADD COLUMN IF NOT EXISTS "dateKey" VARCHAR(10);

-- Existing views reference the old date-authored hint. Preserve their
-- acknowledgement day before replacing the uniqueness rule. The dynamic
-- guard also handles a deployment that got as far as dropping the legacy
-- column before it was marked failed.
DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'DailyHint'
      AND column_name = 'dateKey'
  ) THEN
    EXECUTE $sql$
      UPDATE "DailyHintView" AS daily_view
      SET "dateKey" = hint."dateKey"
      FROM "DailyHint" AS hint
      WHERE hint."id" = daily_view."hintId"
        AND daily_view."dateKey" IS DISTINCT FROM hint."dateKey"
    $sql$;
  END IF;
END
$migration$;

-- This fallback only applies to a partially-created/legacy row that has no
-- matching hint date. It keeps the acknowledgement tied to the day it was
-- recorded so the NOT NULL conversion remains safe.
UPDATE "DailyHintView"
SET "dateKey" = to_char("viewedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD')
WHERE "dateKey" IS NULL;

ALTER TABLE "DailyHintView"
  ALTER COLUMN "dateKey" SET NOT NULL;

-- The old unique rule allowed multiple rows for one player/day when a hint
-- was edited or recreated. Keep the earliest acknowledgement before adding
-- the new per-day rule.
DELETE FROM "DailyHintView" AS duplicate
USING "DailyHintView" AS kept
WHERE duplicate."dateKey" = kept."dateKey"
  AND duplicate."userId" = kept."userId"
  AND duplicate."id" > kept."id";

DROP INDEX IF EXISTS "DailyHintView_hintId_userId_key";
CREATE UNIQUE INDEX IF NOT EXISTS "DailyHintView_dateKey_userId_key"
  ON "DailyHintView"("dateKey", "userId");

-- Preserve all existing scheduled hints as the initial daily selections.
-- If a partial attempt already removed the legacy date column, the selection
-- rows were inserted before that step and there is nothing to backfill.
DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'DailyHint'
      AND column_name = 'dateKey'
  ) THEN
    EXECUTE $sql$
      INSERT INTO "DailyHintSelection" ("dateKey", "hintId", "selectedAt")
      SELECT "dateKey", "id", "updatedAt"
      FROM "DailyHint"
      ON CONFLICT ("dateKey") DO NOTHING
    $sql$;
  END IF;
END
$migration$;

DROP INDEX IF EXISTS "DailyHint_dateKey_key";
DROP INDEX IF EXISTS "DailyHint_active_dateKey_idx";
ALTER TABLE "DailyHint"
  DROP COLUMN IF EXISTS "dateKey";

CREATE INDEX IF NOT EXISTS "DailyHintSelection_hintId_dateKey_idx"
  ON "DailyHintSelection"("hintId", "dateKey");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'DailyHintSelection_hintId_fkey'
      AND conrelid = '"DailyHintSelection"'::regclass
  ) THEN
    ALTER TABLE "DailyHintSelection"
      ADD CONSTRAINT "DailyHintSelection_hintId_fkey"
      FOREIGN KEY ("hintId") REFERENCES "DailyHint"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
