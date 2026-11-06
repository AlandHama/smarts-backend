CREATE TABLE "DailyHint" (
    "id" UUID NOT NULL,
    "dateKey" VARCHAR(10) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "translations" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyHint_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DailyHintView" (
    "id" UUID NOT NULL,
    "hintId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "viewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyHintView_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DailyHint_dateKey_key" ON "DailyHint"("dateKey");
CREATE INDEX "DailyHint_active_dateKey_idx" ON "DailyHint"("active", "dateKey");
CREATE UNIQUE INDEX "DailyHintView_hintId_userId_key" ON "DailyHintView"("hintId", "userId");
CREATE INDEX "DailyHintView_userId_viewedAt_idx" ON "DailyHintView"("userId", "viewedAt");

ALTER TABLE "DailyHintView" ADD CONSTRAINT "DailyHintView_hintId_fkey"
  FOREIGN KEY ("hintId") REFERENCES "DailyHint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DailyHintView" ADD CONSTRAINT "DailyHintView_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
