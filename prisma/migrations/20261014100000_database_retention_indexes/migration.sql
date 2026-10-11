-- Supports small, ordered retention batches without scanning the complete
-- match-event or export-job indexes on every maintenance pass.
CREATE INDEX IF NOT EXISTS "MatchEvent_serverReceivedAt_idx"
  ON "MatchEvent" ("serverReceivedAt");

CREATE INDEX IF NOT EXISTS "AnalyticsExportJob_expiresAt_idx"
  ON "AnalyticsExportJob" ("expiresAt");
