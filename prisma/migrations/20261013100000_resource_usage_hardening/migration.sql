-- Analytics aggregation filters by occurredAt before grouping by eventName.
-- Keep the existing eventName-first index for event-specific reports and add
-- the time-first index used by the rolling daily/hourly refresh.
CREATE INDEX IF NOT EXISTS "AnalyticsEvent_occurredAt_eventName_idx"
  ON "AnalyticsEvent" ("occurredAt", "eventName");
