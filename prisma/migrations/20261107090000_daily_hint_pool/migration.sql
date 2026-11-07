-- Convert date-authored hints into a reusable pool and preserve the hints
-- already scheduled for historical dates as daily selections.
CREATE TABLE "DailyHintSelection" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "dateKey" VARCHAR(10) NOT NULL,
    "hintId" UUID NOT NULL,
    "selectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyHintSelection_pkey" PRIMARY KEY ("id")
);

-- The backfill below uses ON CONFLICT ("dateKey"). PostgreSQL requires the
-- matching unique index to exist before that statement is executed.
CREATE UNIQUE INDEX "DailyHintSelection_dateKey_key" ON "DailyHintSelection"("dateKey");

ALTER TABLE "DailyHintView" ADD COLUMN "dateKey" VARCHAR(10);

UPDATE "DailyHintView" view
SET "dateKey" = hint."dateKey"
FROM "DailyHint" hint
WHERE hint."id" = view."hintId";

ALTER TABLE "DailyHintView" ALTER COLUMN "dateKey" SET NOT NULL;

DROP INDEX "DailyHintView_hintId_userId_key";
CREATE UNIQUE INDEX "DailyHintView_dateKey_userId_key" ON "DailyHintView"("dateKey", "userId");

INSERT INTO "DailyHintSelection" ("dateKey", "hintId", "selectedAt")
SELECT "dateKey", "id", "updatedAt"
FROM "DailyHint"
ON CONFLICT ("dateKey") DO NOTHING;

DROP INDEX "DailyHint_dateKey_key";
DROP INDEX "DailyHint_active_dateKey_idx";
ALTER TABLE "DailyHint" DROP COLUMN "dateKey";

CREATE INDEX "DailyHintSelection_hintId_dateKey_idx" ON "DailyHintSelection"("hintId", "dateKey");

ALTER TABLE "DailyHintSelection" ADD CONSTRAINT "DailyHintSelection_hintId_fkey"
  FOREIGN KEY ("hintId") REFERENCES "DailyHint"("id") ON DELETE CASCADE ON UPDATE CASCADE;
