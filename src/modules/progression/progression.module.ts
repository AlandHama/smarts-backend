import { Module } from "@nestjs/common"

import { DatabaseModule } from "../../database/database.module"
import { ProgressionController } from "./progression.controller"
import { ProgressionService } from "./progression.service"
import { AwardProgressionPointsTransaction } from "./transactions/award-progression-points-transaction"
import { CreateProgressionRewardTransaction } from "./transactions/create-progression-reward-transaction"
import { CreateProgressionTierTransaction } from "./transactions/create-progression-tier-transaction"
import { CreateProgressionTransaction } from "./transactions/create-progression-transaction"
import { DeleteProgressionRewardTransaction } from "./transactions/delete-progression-reward-transaction"
import { DeleteProgressionTierTransaction } from "./transactions/delete-progression-tier-transaction"
import { ResetPlayerProgressionTransaction } from "./transactions/reset-player-progression-transaction"
import { UpdateProgressionRewardTransaction } from "./transactions/update-progression-reward-transaction"
import { UpdateProgressionTierTransaction } from "./transactions/update-progression-tier-transaction"
import { UpdateProgressionTransaction } from "./transactions/update-progression-transaction"

@Module({
  imports: [DatabaseModule],
  controllers: [ProgressionController],
  providers: [
    ProgressionService,
    CreateProgressionTransaction,
    UpdateProgressionTransaction,
    CreateProgressionTierTransaction,
    UpdateProgressionTierTransaction,
    DeleteProgressionTierTransaction,
    CreateProgressionRewardTransaction,
    UpdateProgressionRewardTransaction,
    DeleteProgressionRewardTransaction,
    AwardProgressionPointsTransaction,
    ResetPlayerProgressionTransaction,
  ],
  exports: [ProgressionService],
})
export class ProgressionModule {}

