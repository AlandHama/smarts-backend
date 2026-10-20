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
import { BotGameplayService } from "./bot-gameplay.service"
import { MissionsModule } from "../missions/missions.module"
import { FraudModule } from "../fraud/fraud.module"
import { StreaksModule } from "../streaks/streaks.module"
import { WinStreaksModule } from "../win-streaks/win-streaks.module"
import { NotificationsModule } from "../notifications/notifications.module"
import { RematchService } from "./rematch.service"
import { MatchIntegrityPolicyService } from "./match-integrity-policy.service"
import { MatchRewardIntegrityAdminService } from "./match-reward-integrity-admin.service"
import { MatchRewardIntegrityAdminController } from "./match-reward-integrity-admin.controller"
import { SystemAdminGuard } from "../system-admin/system-admin.guard"

@Module({
  imports: [DatabaseModule, GameModule, ProgressionModule, EconomyModule, LeaderboardModule, MissionsModule, FraudModule, StreaksModule, WinStreaksModule, NotificationsModule],
  controllers: [MatchController, MatchRewardIntegrityAdminController],
  providers: [SystemAdminGuard, MatchService, RematchService, MatchIntegrityPolicyService, MatchRewardIntegrityAdminService, CreateMatchTransaction, RecordMatchEventTransaction, CompleteMatchTransaction, SettleMatchTransaction, StartMatchTransaction, ForfeitMatchTransaction, ExpireMatchTransaction, BotGameplayService],
  exports: [MatchService, MatchIntegrityPolicyService, SettleMatchTransaction, ExpireMatchTransaction, BotGameplayService],
})
export class MatchesModule {}
