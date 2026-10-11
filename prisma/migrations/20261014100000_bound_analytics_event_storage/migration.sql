-- AnalyticsEvent is queried by event/time for reporting and by time for the
-- rolling aggregate worker. These four indexes had no corresponding query
-- path and made the index footprint larger than the table data itself.
DROP INDEX IF EXISTS "AnalyticsEvent_playerId_occurredAt_idx";
DROP INDEX IF EXISTS "AnalyticsEvent_platform_appVersion_occurredAt_idx";
DROP INDEX IF EXISTS "AnalyticsEvent_countryCode_occurredAt_idx";
DROP INDEX IF EXISTS "AnalyticsEvent_receivedAt_idx";
