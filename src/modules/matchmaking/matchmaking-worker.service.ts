import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common"

import { ClaimMatchmakingPairTransaction } from "./transactions/claim-matchmaking-pair-transaction"
import { ExpireMatchmakingTicketsTransaction } from "./transactions/expire-matchmaking-tickets-transaction"
import { ExpireMatchTransaction } from "../matches/transactions/expire-match-transaction"
import { matchmakerBatchSize } from "./utilities/matchmaking-policy"

@Injectable()
export class MatchmakingWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MatchmakingWorkerService.name)
  private timer?: ReturnType<typeof setInterval>
  private running = false

  constructor(private readonly expireTickets: ExpireMatchmakingTicketsTransaction, private readonly claimPair: ClaimMatchmakingPairTransaction, private readonly expireMatches: ExpireMatchTransaction) {}

  onModuleInit() {
    void this.tick()
    this.timer = setInterval(() => void this.tick(), 1000)
  }

  onModuleDestroy() { if (this.timer) clearInterval(this.timer) }

  private async tick() {
    if (this.running) return
    this.running = true
    try {
      await this.expireTickets.run()
      await this.expireMatches.run()
      for (let index = 0; index < matchmakerBatchSize(); index += 1) {
        const result = await this.claimPair.run()
        if (!result) break
      }
    } catch (error) {
      this.logger.warn(`Matchmaking worker tick failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      this.running = false
    }
  }
}
