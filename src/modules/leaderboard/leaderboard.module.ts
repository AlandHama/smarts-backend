import { Module } from "@nestjs/common"

import { DatabaseModule } from "../../database/database.module"
import { ProgressionModule } from "../progression/progression.module"
import { LeaderboardController } from "./leaderboard.controller"
import { LeaderboardSeasonService } from "./leaderboard-season.service"
import { LeaderboardService } from "./leaderboard.service"
import { ApplyLeaderboardScoreTransaction } from "./transactions/apply-score-transaction"
import { CloseSeasonTransaction } from "./transactions/close-season-transaction"
import { CreateLeaderboardTransaction } from "./transactions/create-leaderboard-transaction"
import { CreateSeasonTransaction } from "./transactions/create-season-transaction"
import { UpdateLeaderboardTransaction } from "./transactions/update-leaderboard-transaction"
import { LeaderboardRewardService } from "./leaderboard-reward.service"

@Module({
  imports: [DatabaseModule, ProgressionModule],
  controllers: [LeaderboardController],
  providers: [LeaderboardService, LeaderboardSeasonService, LeaderboardRewardService, ApplyLeaderboardScoreTransaction, CreateLeaderboardTransaction, UpdateLeaderboardTransaction, CreateSeasonTransaction, CloseSeasonTransaction],
  exports: [LeaderboardService, ApplyLeaderboardScoreTransaction],
})
export class LeaderboardModule {}
