import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common"
import { Prisma } from "@prisma/client"

import { PrismaService } from "../../prisma.service"
import { analyticsStorageConfig } from "./analytics-storage.config"

const LOCK_KEY = "smarts.database.retention"
const INTERVAL_MS = 5 * 60 * 1000
const MATCH_EVENT_RETENTION_DAYS = 30
const QUEUE_HISTORY_RETENTION_DAYS = 30
const EXPORT_JOB_RETENTION_DAYS = 14

/**
 * Removes only disposable operational history in small batches. Match rows,
 * settlements, wallet rows, and audit records are deliberately retained.
 * The advisory transaction lock makes this safe when Railway runs multiple
 * API replicas.
 */
@Injectable()
export class ResourceRetentionWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ResourceRetentionWorkerService.name)
  private timer?: ReturnType<typeof setInterval>
  private running = false

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    void this.run()
    this.timer = setInterval(() => void this.run(), INTERVAL_MS)
    this.timer.unref?.()
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer)
  }

  async run() {
    if (this.running) return { skipped: true, deleted: 0 }
    this.running = true
    try {
      // Keep analytics cleanup independent. A failure in an unrelated
      // retention target must never roll back the raw analytics purge.
      const analyticsResult = await this.prisma.$transaction(async (tx) => {
        const lock = await tx.$queryRaw<Array<{ locked: boolean }>>(
          Prisma.sql`SELECT pg_try_advisory_xact_lock(hashtext(${LOCK_KEY})) AS locked`,
        )
        if (!lock[0]?.locked) return { skipped: true, deleted: 0 }

        const analyticsCutoff = new Date(Date.now() - analyticsStorageConfig.rawRetentionHours * 60 * 60 * 1000)

        let deleted = 0
        // AnalyticsEvent is a disposable raw buffer. Counts and dashboard
        // metrics are materialized by the aggregation worker before this
        // window expires, while match/settlement tables retain authoritative
        // business history.
        deleted += await tx.$executeRaw(Prisma.sql`
          DELETE FROM "AnalyticsEvent"
          WHERE "id" IN (
            SELECT "id" FROM "AnalyticsEvent"
            WHERE "receivedAt" < ${analyticsCutoff}
            ORDER BY "receivedAt" ASC
            LIMIT ${analyticsStorageConfig.retentionBatchSize}
          )
        `)

        // Time retention handles normal traffic. This second bounded delete
        // handles traffic bursts or a temporarily paused worker and keeps the
        // table within the storage budget regardless of event volume.
        deleted += await tx.$executeRaw(Prisma.sql`
          DELETE FROM "AnalyticsEvent"
          WHERE "id" IN (
            SELECT "id" FROM "AnalyticsEvent"
            ORDER BY "receivedAt" DESC
            OFFSET ${analyticsStorageConfig.rawMaxRows}
            LIMIT ${analyticsStorageConfig.retentionBatchSize}
          )
        `)

        return { skipped: false, deleted }
      }, { maxWait: 5_000, timeout: 20_000 })

      if (analyticsResult.skipped) return analyticsResult

      let deleted = analyticsResult.deleted
      try {
        const otherResult = await this.prisma.$transaction(async (tx) => {
          const lock = await tx.$queryRaw<Array<{ locked: boolean }>>(
            Prisma.sql`SELECT pg_try_advisory_xact_lock(hashtext(${LOCK_KEY})) AS locked`,
          )
          if (!lock[0]?.locked) return { skipped: true, deleted: 0 }

          const matchEventCutoff = new Date(Date.now() - MATCH_EVENT_RETENTION_DAYS * 24 * 60 * 60 * 1000)
          const queueCutoff = new Date(Date.now() - QUEUE_HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000)
          const exportJobCutoff = new Date(Date.now() - EXPORT_JOB_RETENTION_DAYS * 24 * 60 * 60 * 1000)
          let deleted = 0

          // Preserve the match, settlement, and final score while removing the
          // high-cardinality match-event stream after its operational review
          // window. Match summaries remain authoritative.
          deleted += await tx.$executeRaw(Prisma.sql`
            DELETE FROM "MatchEvent"
            WHERE "id" IN (
              SELECT event."id"
              FROM "MatchEvent" event
              JOIN "Match" match ON match."id" = event."matchId"
              WHERE match."endedAt" < ${matchEventCutoff}
                AND match."status" IN ('CANCELLED', 'SETTLED')
                AND event."serverReceivedAt" < ${matchEventCutoff}
              ORDER BY event."serverReceivedAt" ASC
              LIMIT ${analyticsStorageConfig.retentionBatchSize}
            )
          `)
          deleted += await tx.$executeRaw(Prisma.sql`
            DELETE FROM "AnalyticsExportJob"
            WHERE "id" IN (
              SELECT "id" FROM "AnalyticsExportJob"
              WHERE "expiresAt" < ${exportJobCutoff}
              ORDER BY "expiresAt" ASC
              LIMIT ${analyticsStorageConfig.retentionBatchSize}
            )
          `)
          deleted += await tx.$executeRaw(Prisma.sql`
            DELETE FROM "CooperativeQueueEntry"
            WHERE "id" IN (
              SELECT "id" FROM "CooperativeQueueEntry"
              WHERE "status" IN ('CANCELLED', 'SETTLED', 'EXPIRED')
                AND "queuedAt" < ${queueCutoff}
              ORDER BY "queuedAt" ASC
              LIMIT ${analyticsStorageConfig.retentionBatchSize}
            )
          `)

          return { skipped: false, deleted }
        }, { maxWait: 5_000, timeout: 20_000 })
        deleted += otherResult.deleted
      } catch (error) {
        this.logger.warn(`Secondary retention pass failed: ${error instanceof Error ? error.message : String(error)}`)
      }

      if (deleted > 0) this.logger.log(`Database retention removed ${deleted} disposable rows`)
      return { skipped: false, deleted }
    } catch (error) {
      this.logger.warn(`Database retention pass failed: ${error instanceof Error ? error.message : String(error)}`)
      return { skipped: false, deleted: 0 }
    } finally {
      this.running = false
    }
  }
}
