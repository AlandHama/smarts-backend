import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common"
import { Prisma } from "@prisma/client"

import { PrismaService } from "../../prisma.service"

const LOCK_KEY = "smarts.database.retention"
const INTERVAL_MS = 15 * 60 * 1000
const BATCH_SIZE = 500
const HIGH_VOLUME_ANALYTICS_RETENTION_HOURS = 24
const ANALYTICS_RETENTION_DAYS = 90
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
      const result = await this.prisma.$transaction(async (tx) => {
        const lock = await tx.$queryRaw<Array<{ locked: boolean }>>(
          Prisma.sql`SELECT pg_try_advisory_xact_lock(hashtext(${LOCK_KEY})) AS locked`,
        )
        if (!lock[0]?.locked) return { skipped: true, deleted: 0 }

        const highVolumeCutoff = new Date(Date.now() - HIGH_VOLUME_ANALYTICS_RETENTION_HOURS * 60 * 60 * 1000)
        const analyticsCutoff = new Date(Date.now() - ANALYTICS_RETENTION_DAYS * 24 * 60 * 60 * 1000)
        const matchEventCutoff = new Date(Date.now() - MATCH_EVENT_RETENTION_DAYS * 24 * 60 * 60 * 1000)
        const queueCutoff = new Date(Date.now() - QUEUE_HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000)
        const exportJobCutoff = new Date(Date.now() - EXPORT_JOB_RETENTION_DAYS * 24 * 60 * 60 * 1000)

        let deleted = 0
        // These events were introduced as per-action Tile Rush telemetry. They
        // are not authoritative state and retaining them indefinitely is what
        // caused the sharp post-October-7 growth. MatchEvent and terminal
        // match analytics summaries remain the source for replay/results.
        deleted += await tx.$executeRaw(Prisma.sql`
          DELETE FROM "AnalyticsEvent"
          WHERE "id" IN (
            SELECT "id" FROM "AnalyticsEvent"
            WHERE "eventName" IN (
              'TILE_RUSH_PATH_ACCEPTED', 'TILE_RUSH_PATH_REJECTED',
              'TILE_RUSH_SPECIAL_CREATED', 'TILE_RUSH_COLOR_CRUSH',
              'TILE_RUSH_COMBO_REACHED', 'TILE_RUSH_COMBO_LOST',
              'TILE_RUSH_LEAD_CHANGED', 'TILE_RUSH_BOARD_HASH_MISMATCH'
            )
            AND "occurredAt" < ${highVolumeCutoff}
            ORDER BY "occurredAt" ASC
            LIMIT ${BATCH_SIZE}
          )
        `)
        deleted += await tx.$executeRaw(Prisma.sql`
          DELETE FROM "AnalyticsEvent"
          WHERE "id" IN (
            SELECT "id" FROM "AnalyticsEvent"
            WHERE "occurredAt" < ${analyticsCutoff}
            ORDER BY "occurredAt" ASC
            LIMIT ${BATCH_SIZE}
          )
        `)
        // Preserve the match, settlement, and final score while removing the
        // high-cardinality action stream after its operational review window.
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
            LIMIT ${BATCH_SIZE}
          )
        `)
        deleted += await tx.$executeRaw(Prisma.sql`
          DELETE FROM "AnalyticsExportJob"
          WHERE "id" IN (
            SELECT "id" FROM "AnalyticsExportJob"
            WHERE "expiresAt" < ${exportJobCutoff}
            ORDER BY "expiresAt" ASC
            LIMIT ${BATCH_SIZE}
          )
        `)
        deleted += await tx.$executeRaw(Prisma.sql`
          DELETE FROM "CooperativeQueueEntry"
          WHERE "id" IN (
            SELECT "id" FROM "CooperativeQueueEntry"
            WHERE "status" IN ('CANCELLED', 'SETTLED', 'EXPIRED')
              AND "queuedAt" < ${queueCutoff}
            ORDER BY "queuedAt" ASC
            LIMIT ${BATCH_SIZE}
          )
        `)

        return { skipped: false, deleted }
      }, { maxWait: 5_000, timeout: 20_000 })

      if (result.deleted > 0) this.logger.log(`Database retention removed ${result.deleted} disposable rows`)
      return result
    } catch (error) {
      this.logger.warn(`Database retention pass failed: ${error instanceof Error ? error.message : String(error)}`)
      return { skipped: false, deleted: 0 }
    } finally {
      this.running = false
    }
  }
}
