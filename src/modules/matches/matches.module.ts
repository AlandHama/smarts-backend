import { Module } from "@nestjs/common"

import { DatabaseModule } from "../../database/database.module"
import { EconomyModule } from "../economy/economy.module"
import { GameModule } from "../game/game.module"
import { LeaderboardModule } from "../leaderboard/leaderboard.module"
import { ProgressionModule } from "../progression/progression.module"
import { CompleteMatchTransaction } from "./transactions/complete-match-transaction"
import { CreateMatchTransaction } from "./transactions/create-match-transaction"
import { RecordMatchEventTransaction } from "./transactions/record-match-event-transaction"
import { SettleMatchTransaction } from "./transactions/settle-match-transaction"
import { ExpireMatchTransaction } from "./transactions/expire-match-transaction"
import { ForfeitMatchTransaction } from "./transactions/forfeit-match-transaction"
import { StartMatchTransaction } from "./transactions/start-match-transaction"
import { MatchController } from "./match.controller"
import { MatchService } from "./match.service"

@Module({
  imports: [DatabaseModule, GameModule, ProgressionModule, EconomyModule, LeaderboardModule],
  controllers: [MatchController],
  providers: [MatchService, CreateMatchTransaction, RecordMatchEventTransaction, CompleteMatchTransaction, SettleMatchTransaction, StartMatchTransaction, ForfeitMatchTransaction, ExpireMatchTransaction],
  exports: [MatchService, SettleMatchTransaction, ExpireMatchTransaction],
})
export class MatchesModule {}
