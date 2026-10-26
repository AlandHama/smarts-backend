-- One-time cleanup requested for the oversized disposable raw buffer. This
-- intentionally touches only AnalyticsEvent; matches, settlements, wallets,
-- audit records, and durable aggregate buckets are not removed.
TRUNCATE TABLE "AnalyticsEvent" RESTART IDENTITY;

-- Retention removes raw envelopes by receipt time. Keep that cleanup ordered
-- and index-backed; durable analytics live in the aggregate tables.
CREATE INDEX IF NOT EXISTS "AnalyticsEvent_receivedAt_idx"
  ON "AnalyticsEvent" ("receivedAt");
