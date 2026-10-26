const DEFAULT_RAW_RETENTION_HOURS = 24
// At the current observed row density, 30k rows is roughly 25 MB including
// indexes. It also leaves room for a full normal day before the safety cap.
const DEFAULT_RAW_MAX_ROWS = 30_000
const DEFAULT_RETENTION_BATCH_SIZE = 10_000

function boundedInteger(name: string, fallback: number, minimum: number, maximum: number) {
  const value = Number(process.env[name])
  if (!Number.isFinite(value)) return fallback
  return Math.min(maximum, Math.max(minimum, Math.floor(value)))
}

/**
 * Raw analytics are a short-lived ingestion buffer. Durable reporting is
 * served from AnalyticsDailyAggregate/AnalyticsHourlyAggregate, so keeping
 * every JSON envelope forever only increases WAL, table bloat, and index
 * maintenance without improving product analytics.
 *
 * The row cap is deliberately enabled in addition to time retention. It is a
 * hard safety valve for traffic spikes and keeps the raw table below the
 * storage budget even if a worker is temporarily unavailable.
 */
export const analyticsStorageConfig = {
  rawRetentionHours: boundedInteger("ANALYTICS_RAW_RETENTION_HOURS", DEFAULT_RAW_RETENTION_HOURS, 1, 168),
  rawMaxRows: boundedInteger("ANALYTICS_RAW_MAX_ROWS", DEFAULT_RAW_MAX_ROWS, 1_000, 100_000),
  retentionBatchSize: boundedInteger("ANALYTICS_RETENTION_BATCH_SIZE", DEFAULT_RETENTION_BATCH_SIZE, 1_000, 25_000),
}
