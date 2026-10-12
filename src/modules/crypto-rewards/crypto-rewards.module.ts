import { Module } from "@nestjs/common"

import { DatabaseModule } from "../../database/database.module"
import { AuthModule } from "../auth/auth.module"
import { EconomyModule } from "../economy/economy.module"
import { FraudModule } from "../fraud/fraud.module"
import { CryptoRewardsController } from "./crypto-rewards.controller"
import { CryptoRewardsService } from "./crypto-rewards.service"
import { NowPaymentsPayoutAdapter } from "./nowpayments-payout.adapter"
import { CryptoRewardsWorker } from "./crypto-rewards.worker"

@Module({
  imports: [DatabaseModule, AuthModule, EconomyModule, FraudModule],
  controllers: [CryptoRewardsController],
  providers: [CryptoRewardsService, NowPaymentsPayoutAdapter, CryptoRewardsWorker],
  exports: [CryptoRewardsService, NowPaymentsPayoutAdapter],
})
export class CryptoRewardsModule {}
