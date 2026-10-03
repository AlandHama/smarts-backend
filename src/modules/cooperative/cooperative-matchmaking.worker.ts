import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common"

import { NotificationsService } from "../notifications/notifications.service"
import { AnalyticsEventService } from "../system-admin/analytics-event.service"
import { CooperativeMatchService } from "./cooperative-match.service"
import { SettleMatchTransaction } from "../matches/transactions/settle-match-transaction"

@Injectable()
export class CooperativeMatchmakingWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CooperativeMatchmakingWorker.name)
  private timer?: ReturnType<typeof setInterval>
  private running = false
  private ticks = 0

  constructor(private readonly matches: CooperativeMatchService, private readonly notifications: NotificationsService, private readonly analytics: AnalyticsEventService, private readonly settleMatch: SettleMatchTransaction) {}

  onModuleInit() {
    void this.tick()
    this.timer = setInterval(() => void this.tick(), 1000)
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer)
  }

  private async tick() {
    if (this.running) return
    this.running = true
    try {
      this.ticks += 1
      if (this.ticks % 5 === 0) {
        await this.matches.expireConfirmations()
        await this.matches.enforceDisconnectGrace()
      }
      // One claim per tick keeps the transaction short and lets the advisory
      // lock coordinate safely across multiple Railway API replicas.
      const result = await this.matches.claimNext()
      if (result?.userIds?.length) {
        await Promise.all(result.userIds.map((userId: string) => this.analytics.record({ eventName: "COOPERATIVE_MATCH_FOUND", playerId: userId, matchId: result.matchId, properties: { botFilled: result.botFilled, format: "TWO_V_TWO", mode: result.mode } }).catch(() => undefined)))
        await Promise.all(result.userIds.map((userId: string) => this.notifications.createPlayerNotification({
          recipientId: userId,
          notificationType: "cooperative.match.found",
          title: result.botFilled ? "Co-op match ready" : "Co-op teams found",
          body: result.botFilled ? "Your teammates are ready. Confirm the cooperative match." : "Two teams are ready. Confirm the cooperative match.",
          data: { route: "/cooperative/matchmaking", matchId: result.matchId },
        }).catch(() => undefined)))
      }
      for (const candidate of await this.matches.settlementCandidates()) {
        const userId = candidate.participants[0]?.userId
        if (!userId) continue
        try {
          await this.settleMatch.run({ matchId: candidate.matchId, userId, idempotencyKey: `cooperative-settle:${candidate.matchId}` })
          await this.matches.markSettlementAttempt(candidate.id, "SUCCEEDED")
          await this.analytics.record({ eventName: "COOPERATIVE_MATCH_SETTLED", playerId: userId, matchId: candidate.matchId, properties: { recoveredByWorker: true } }).catch(() => undefined)
        } catch (error) {
          await this.matches.markSettlementAttempt(candidate.id, "FAILED", error instanceof Error ? error.message : String(error)).catch(() => undefined)
          await this.analytics.record({ eventName: "COOPERATIVE_SETTLEMENT_FAILED", playerId: userId, matchId: candidate.matchId, properties: { error: error instanceof Error ? error.message : String(error) } }).catch(() => undefined)
        }
      }
    } catch (error) {
      this.logger.warn(`Cooperative matchmaking tick failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      this.running = false
    }
  }
}
