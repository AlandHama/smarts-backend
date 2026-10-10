import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common"

import { ClaimMatchmakingPairTransaction } from "./transactions/claim-matchmaking-pair-transaction"
import { ExpireMatchmakingTicketsTransaction } from "./transactions/expire-matchmaking-tickets-transaction"
import { ExpireMatchTransaction } from "../matches/transactions/expire-match-transaction"
import { BotGameplayService } from "../matches/bot-gameplay.service"
import { GemBlitzService } from "../gem-blitz/gem-blitz.service"
import { TileRushService } from "../tile-rush/tile-rush.service"
import { matchmakerBatchSize } from "./utilities/matchmaking-policy"

@Injectable()
export class MatchmakingWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MatchmakingWorkerService.name)
  private timer?: ReturnType<typeof setInterval>
  private running = false
  private ticks = 0

  constructor(private readonly expireTickets: ExpireMatchmakingTicketsTransaction, private readonly claimPair: ClaimMatchmakingPairTransaction, private readonly expireMatches: ExpireMatchTransaction, private readonly botGameplay: BotGameplayService, private readonly gemBlitz: GemBlitzService, private readonly tileRush: TileRushService) {}

  onModuleInit() {
    void this.tick()
    this.timer = setInterval(() => void this.tick(), 2000)
    this.timer.unref?.()
  }

  onModuleDestroy() { if (this.timer) clearInterval(this.timer) }

  private async tick() {
    if (this.running) return
    this.running = true
    try {
      this.ticks += 1
      const gameMaintenanceTick = this.ticks % 3 === 0
      const settlementTick = this.ticks % 8 === 0
      // Maintenance must never be able to starve the matcher. A malformed
      // bot match or one expired-match race is isolated to that phase so
      // healthy queue tickets are still claimed on the same tick.
      await this.runStep("expire matchmaking tickets", () => this.expireTickets.run())
      // These methods also advance disconnected bot matches and persist their
      // state. Running them every second caused a write/query storm after the
      // board games were added. Two to six seconds is still responsive for
      // gameplay and gives the client websocket time to finish normally.
      if (gameMaintenanceTick) {
        await this.runStep("finalize expired Gem Blitz matches", () => this.gemBlitz.finalizeExpiredMatches())
        await this.runStep("finalize expired Tile Rush matches", () => this.tileRush.finalizeExpiredMatches())
      }
      if (settlementTick) {
        await this.runStep("retry Gem Blitz settlements", () => this.gemBlitz.retryPendingSettlements())
        await this.runStep("retry Tile Rush settlements", () => this.tileRush.retryPendingSettlements())
      }
      await this.runStep("expire matches", () => this.expireMatches.run())
      await this.runStep("advance bot matches", () => this.botGameplay.progressActiveMatches())
      for (let index = 0; index < matchmakerBatchSize(); index += 1) {
        let result
        try {
          result = await this.claimPair.run()
        } catch (error) {
          this.logger.warn(`Matchmaking pair claim failed: ${error instanceof Error ? error.message : String(error)}`)
          break
        }
        if (!result) break
      }
    } finally {
      this.running = false
    }
  }

  private async runStep(label: string, operation: () => Promise<unknown>) {
    try {
      await operation()
    } catch (error) {
      this.logger.warn(`Matchmaking worker step failed (${label}): ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
