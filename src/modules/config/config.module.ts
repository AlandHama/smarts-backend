import { Module } from "@nestjs/common"

import { DatabaseModule } from "../../database/database.module"
import { ConfigController } from "./config.controller"
import { ConfigService } from "./config.service"
import { PublishRewardPolicyTransaction } from "./transactions/publish-reward-policy-transaction"
import { GameModule } from "../game/game.module"

@Module({
  imports: [DatabaseModule, GameModule],
  controllers: [ConfigController],
  providers: [ConfigService, PublishRewardPolicyTransaction],
  exports: [ConfigService, PublishRewardPolicyTransaction],
})
export class ConfigModule {}
