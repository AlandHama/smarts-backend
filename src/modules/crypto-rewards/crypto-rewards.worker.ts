import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common"

import { CryptoRewardsService } from "./crypto-rewards.service"
import { getCryptoRewardsConfig } from "./crypto-rewards.config"

@Injectable()
export class CryptoRewardsWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CryptoRewardsWorker.name)
  private timer?: ReturnType<typeof setInterval>
  private running = false

  constructor(private readonly rewards: CryptoRewardsService) {}

  onModuleInit() {
    void this.tick()
    this.timer = setInterval(() => void this.tick(), getCryptoRewardsConfig().pollIntervalMs)
    this.timer.unref?.()
  }

  onModuleDestroy() { if (this.timer) clearInterval(this.timer) }

  private async tick() {
    if (this.running) return
    this.running = true
    try { await this.rewards.runSubmissionQueue(); await this.rewards.runReconciliation() }
    catch (error) { this.logger.warn(`Crypto payout reconciliation failed: ${error instanceof Error ? error.message : String(error)}`) }
    finally { this.running = false }
  }
}
