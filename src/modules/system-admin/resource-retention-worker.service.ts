import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common"
import { Prisma } from "@prisma/client"

import { PrismaService } from "../../prisma.service"

const LOCK_KEY = "smarts.database.retention"
const INTERVAL_MS = 5 * 60 * 1000
const BATCH_SIZE = 2_000
const HIGH_VOLUME_BATCH_SIZE = 10_000
const HIGH_VOLUME_ANALYTICS_RETENTION_HOURS = 2
const ANALYTICS_RETENTION_DAYS = 7
const HIGH_VOLUME_ANALYTICS_MAX_ROWS = 20_000
const MATCH_EVENT_RETENTION_DAYS = 30
const QUEUE_HISTORY_RETENTION_DAYS = 30
const EXPORT_JOB_RETENTION_DAYS = 14

// Per-action telemetry is useful for short-lived diagnostics, but it must not
// be treated as an append-only product ledger. MatchEvent and the terminal
// match summary retain the authoritative gameplay information.
const HIGH_VOLUME_ANALYTICS_EVENTS = [
  "GEM_BLITZ_MOVE_ACCEPTED",
  "TILE_RUSH_PATH_ACCEPTED",
  "TILE_RUSH_PATH_REJECTED",
  "TILE_RUSH_SPECIAL_CREATED",
  "TILE_RUSH_COLOR_CRUSH",
  "TILE_RUSH_COMBO_REACHED",
  "TILE_RUSH_COMBO_LOST",
  "TILE_RUSH_LEAD_CHANGED",
  "TILE_RUSH_BOARD_HASH_MISMATCH",
] as const

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
        // Per-action telemetry is retained only briefly. The old worker's
        // 500-row pass was slower than production traffic, allowing this table
        // to grow into millions of rows.
        deleted += await tx.$executeRaw(Prisma.sql`
          DELETE FROM "AnalyticsEvent"
          WHERE "id" IN (
            SELECT "id" FROM "AnalyticsEvent"
            WHERE "eventName" IN (${Prisma.join(HIGH_VOLUME_ANALYTICS_EVENTS)})
            AND "occurredAt" < ${highVolumeCutoff}
            ORDER BY "occurredAt" ASC, "id" ASC
            LIMIT ${HIGH_VOLUME_BATCH_SIZE}
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
        // Keep a hard row bound for the high-volume event family as a safety
        // net if traffic spikes or the worker is temporarily unavailable.
        deleted += await tx.$executeRaw(Prisma.sql`
          DELETE FROM "AnalyticsEvent"
          WHERE "id" IN (
            SELECT "id" FROM "AnalyticsEvent"
            WHERE "eventName" IN (${Prisma.join(HIGH_VOLUME_ANALYTICS_EVENTS)})
            ORDER BY "occurredAt" DESC, "id" DESC
            OFFSET ${HIGH_VOLUME_ANALYTICS_MAX_ROWS}
            LIMIT ${HIGH_VOLUME_BATCH_SIZE}
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
