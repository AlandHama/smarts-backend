import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common"
import { Prisma } from "@prisma/client"

import { PrismaService } from "../../prisma.service"

const WORKER_KEY = "smarts.analytics.aggregate"
const REFRESH_KEY = "server-events"
const REFRESH_INTERVAL_MS = 5 * 60 * 1000

/** Recomputes recent event buckets so late-arriving events are corrected. */
@Injectable()
export class AnalyticsAggregationWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AnalyticsAggregationWorkerService.name)
  private timer?: ReturnType<typeof setInterval>

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    void this.refresh()
    this.timer = setInterval(() => void this.refresh(), REFRESH_INTERVAL_MS)
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer)
  }

  async refresh() {
    const lockRows = await this.prisma.$queryRaw<Array<{ locked: boolean }>>(
      Prisma.sql`SELECT pg_try_advisory_lock(hashtext(${WORKER_KEY})) AS locked`,
    )
    if (!lockRows[0]?.locked) return { skipped: true, rows: 0 }

    const startedAt = new Date()
    await this.prisma.analyticsRefreshState.upsert({
      where: { key: REFRESH_KEY },
      create: { key: REFRESH_KEY, status: "RUNNING", startedAt },
      update: { status: "RUNNING", startedAt, error: null },
    })

    try {
      const dailyFrom = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
      const hourlyFrom = new Date(Date.now() - 48 * 60 * 60 * 1000)
      const now = new Date()
      let rows = 0

      await this.prisma.$transaction(async (transaction) => {
        await transaction.$executeRaw(Prisma.sql`DELETE FROM "AnalyticsDailyAggregate" WHERE "day" >= date_trunc('day', ${dailyFrom}::timestamp)::date`)
        await transaction.$executeRaw(Prisma.sql`DELETE FROM "AnalyticsHourlyAggregate" WHERE "hour" >= date_trunc('hour', ${hourlyFrom}::timestamp)`)

        const daily = await transaction.$executeRaw(Prisma.sql`
          INSERT INTO "AnalyticsDailyAggregate"
            ("day", "metricKey", "dimensionKey", "dimensions", "value", "refreshedAt")
          SELECT
            date_trunc('day', "occurredAt")::date,
            'event.' || "eventName",
            concat_ws('|', COALESCE(NULLIF("platform", ''), 'unknown'), COALESCE(NULLIF("appVersion", ''), 'unknown'), COALESCE(NULLIF("countryCode", ''), 'unknown')),
            jsonb_build_object('platform', COALESCE(NULLIF("platform", ''), 'unknown'), 'appVersion', COALESCE(NULLIF("appVersion", ''), 'unknown'), 'countryCode', COALESCE(NULLIF("countryCode", ''), 'unknown')),
            count(*)::decimal,
            CURRENT_TIMESTAMP
          FROM "AnalyticsEvent"
          WHERE "occurredAt" >= date_trunc('day', ${dailyFrom}::timestamp)
            AND "occurredAt" <= ${now}
          GROUP BY 1, 2, 3, 4
        `)
        const hourly = await transaction.$executeRaw(Prisma.sql`
          INSERT INTO "AnalyticsHourlyAggregate"
            ("hour", "metricKey", "dimensionKey", "dimensions", "value", "refreshedAt")
          SELECT
            date_trunc('hour', "occurredAt"),
            'event.' || "eventName",
            concat_ws('|', COALESCE(NULLIF("platform", ''), 'unknown'), COALESCE(NULLIF("appVersion", ''), 'unknown'), COALESCE(NULLIF("countryCode", ''), 'unknown')),
            jsonb_build_object('platform', COALESCE(NULLIF("platform", ''), 'unknown'), 'appVersion', COALESCE(NULLIF("appVersion", ''), 'unknown'), 'countryCode', COALESCE(NULLIF("countryCode", ''), 'unknown')),
            count(*)::decimal,
            CURRENT_TIMESTAMP
          FROM "AnalyticsEvent"
          WHERE "occurredAt" >= date_trunc('hour', ${hourlyFrom}::timestamp)
            AND "occurredAt" <= ${now}
          GROUP BY 1, 2, 3, 4
        `)
        rows = Number(daily) + Number(hourly)
      })

      await this.prisma.analyticsRefreshState.update({
        where: { key: REFRESH_KEY },
        data: { status: "COMPLETE", dataThrough: now, completedAt: new Date(), rowCount: rows, error: null },
      })
      return { skipped: false, rows }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.logger.error(`Analytics aggregation failed: ${message}`)
      await this.prisma.analyticsRefreshState.update({
        where: { key: REFRESH_KEY },
        data: { status: "FAILED", error: message.slice(0, 4000), completedAt: new Date() },
      }).catch(() => undefined)
      return { skipped: false, rows: 0, error: message }
    } finally {
      await this.prisma.$queryRaw(Prisma.sql`SELECT pg_advisory_unlock(hashtext(${WORKER_KEY}))`).catch(() => undefined)
    }
  }
}
