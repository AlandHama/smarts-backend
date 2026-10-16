ALTER TABLE "CooperativeQueueEntry"
  ADD COLUMN IF NOT EXISTS "gameKey" VARCHAR(64) NOT NULL DEFAULT 'random';

CREATE INDEX IF NOT EXISTS "CooperativeQueueEntry_gameKey_status_queuedAt_idx"
  ON "CooperativeQueueEntry"("gameKey", "status", "queuedAt");
