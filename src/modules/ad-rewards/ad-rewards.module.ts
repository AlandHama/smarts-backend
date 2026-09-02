import { Module } from "@nestjs/common"

import { DatabaseModule } from "../../database/database.module"
import { ConfigModule } from "../config/config.module"
import { EconomyModule } from "../economy/economy.module"
import { AdRewardsController } from "./ad-rewards.controller"
import { AdRewardsService } from "./ad-rewards.service"
import { ClaimAdRewardTransaction } from "./transactions/claim-ad-reward-transaction"
import { VerifyAdImpressionTransaction } from "./transactions/verify-ad-impression-transaction"

@Module({
  imports: [DatabaseModule, ConfigModule, EconomyModule],
  controllers: [AdRewardsController],
  providers: [AdRewardsService, VerifyAdImpressionTransaction, ClaimAdRewardTransaction],
  exports: [AdRewardsService],
})
export class AdRewardsModule {}
