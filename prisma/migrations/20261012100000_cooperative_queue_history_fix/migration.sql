-- Queue entries are an audit history. The old global unique key prevented a
-- party from ever having a second CANCELLED/SETTLED row after its first queue
-- attempt, because changing MATCHED to a terminal status collided with history.
DROP INDEX IF EXISTS "CooperativeQueueEntry_partyId_mode_status_key";

-- Keep at most one active queue entry for a party and mode while allowing
-- unlimited terminal history. Resolve any legacy duplicate active rows before
-- creating the partial unique index, retaining the newest row.
WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "partyId", "mode", "status"
      ORDER BY "queuedAt" DESC, "id" DESC
    ) AS row_number
  FROM "CooperativeQueueEntry"
  WHERE "status" IN ('SEARCHING', 'MATCHED')
)
UPDATE "CooperativeQueueEntry" AS entry
SET "status" = 'CANCELLED', "matchId" = NULL
FROM ranked
WHERE entry."id" = ranked."id"
  AND ranked.row_number > 1;

CREATE INDEX IF NOT EXISTS "CooperativeQueueEntry_partyId_mode_status_idx"
  ON "CooperativeQueueEntry" ("partyId", "mode", "status");

CREATE UNIQUE INDEX "CooperativeQueueEntry_partyId_mode_active_key"
  ON "CooperativeQueueEntry" ("partyId", "mode")
  WHERE "status" IN ('SEARCHING', 'MATCHED');
