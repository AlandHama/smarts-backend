import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common"
import { LeaderboardPeriod } from "@prisma/client"

import { PrismaService } from "../../prisma.service"

@Injectable()
export class LeaderboardSeasonService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LeaderboardSeasonService.name)
  private timer?: ReturnType<typeof setInterval>

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    void this.rollover().catch((error) => this.logger.warn(`Initial leaderboard season rollover skipped: ${error instanceof Error ? error.message : String(error)}`))
    this.timer = setInterval(() => void this.rollover().catch((error) => this.logger.warn(`Leaderboard season rollover failed: ${error instanceof Error ? error.message : String(error)}`)), 60_000)
  }

  onModuleDestroy() { if (this.timer) clearInterval(this.timer) }

  async rollover() {
    await this.prisma.$transaction(async (transaction) => {
      const [{ locked }] = await transaction.$queryRaw<Array<{ locked: boolean }>>`SELECT pg_try_advisory_xact_lock(hashtextextended('smarts-leaderboard-season-rollover', 0)) AS locked`
      if (!locked) return
      const boards = await transaction.leaderboard.findMany({ where: { active: true, period: { in: [LeaderboardPeriod.WEEKLY, LeaderboardPeriod.MONTHLY] } }, select: { id: true, period: true }, take: 100 })
      const now = new Date()
      for (const board of boards) {
        await transaction.leaderboardSeason.updateMany({ where: { leaderboardId: board.id, status: "ACTIVE", endsAt: { lte: now } }, data: { status: "CLOSED", resetAt: now } })
        const window = this.currentWindow(board.period, now)
        const current = await transaction.leaderboardSeason.findUnique({ where: { leaderboardId_startsAt: { leaderboardId: board.id, startsAt: window.startsAt } }, select: { id: true, status: true } })
        if (!current) await transaction.leaderboardSeason.create({ data: { leaderboardId: board.id, startsAt: window.startsAt, endsAt: window.endsAt, status: "ACTIVE" } })
        else if (current.status === "SCHEDULED") await transaction.leaderboardSeason.update({ where: { id: current.id }, data: { endsAt: window.endsAt, status: "ACTIVE" } })
      }
    })
  }

  private currentWindow(period: LeaderboardPeriod, now: Date) {
    if (period === LeaderboardPeriod.MONTHLY) {
      const startsAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
      return { startsAt, endsAt: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)) }
    }
    const day = now.getUTCDay()
    const daysSinceMonday = (day + 6) % 7
    const startsAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysSinceMonday))
    return { startsAt, endsAt: new Date(startsAt.getTime() + 7 * 24 * 60 * 60 * 1000) }
  }
}
