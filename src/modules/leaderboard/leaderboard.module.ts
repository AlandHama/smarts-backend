import { Module } from "@nestjs/common"

import { DatabaseModule } from "../../database/database.module"
import { LeaderboardController } from "./leaderboard.controller"
import { LeaderboardSeasonService } from "./leaderboard-season.service"
import { LeaderboardService } from "./leaderboard.service"
import { ApplyLeaderboardScoreTransaction } from "./transactions/apply-score-transaction"
import { CloseSeasonTransaction } from "./transactions/close-season-transaction"
import { CreateLeaderboardTransaction } from "./transactions/create-leaderboard-transaction"
import { CreateSeasonTransaction } from "./transactions/create-season-transaction"
import { UpdateLeaderboardTransaction } from "./transactions/update-leaderboard-transaction"

@Module({
  imports: [DatabaseModule],
  controllers: [LeaderboardController],
  providers: [LeaderboardService, LeaderboardSeasonService, ApplyLeaderboardScoreTransaction, CreateLeaderboardTransaction, UpdateLeaderboardTransaction, CreateSeasonTransaction, CloseSeasonTransaction],
  exports: [LeaderboardService, ApplyLeaderboardScoreTransaction],
})
export class LeaderboardModule {}
