import { Module } from "@nestjs/common"

import { DatabaseModule } from "../../database/database.module"
import { AuthModule } from "../auth/auth.module"
import { UsersModule } from "../admin/access/users/users.module"
import { SystemAdminController } from "./system-admin.controller"
import { SystemAdminService } from "./system-admin.service"
import { SystemAdminGuard } from "./system-admin.guard"
import { DeleteUserTransaction } from "./transactions/delete-user-transaction"
import { EnsureSystemAdminTransaction } from "./transactions/ensure-system-admin-transaction"
import { ResetUserPasswordTransaction } from "./transactions/reset-user-password-transaction"
import { UpdateUserProfileTransaction } from "./transactions/update-user-profile-transaction"
import { UpdateUserStatusTransaction } from "./transactions/update-user-status-transaction"
import { TerminateAdminSessionTransaction } from "./transactions/terminate-admin-session-transaction"
import { ProgressionModule } from "../progression/progression.module"
import { EconomyModule } from "../economy/economy.module"
import { LeaderboardModule } from "../leaderboard/leaderboard.module"
import { GameModule } from "../game/game.module"
import { CommerceModule } from "../commerce/commerce.module"
import { StorageModule } from "../storage/storage.module"
import { FriendsModule } from "../friends/friends.module"
import { ConfigModule } from "../config/config.module"
import { AdRewardsModule } from "../ad-rewards/ad-rewards.module"
import { SystemAdminAnalyticsService } from "./system-admin-analytics.service"
import { AdMobModule } from "../admob/admob.module"
import { GldModule } from "../gld/gld.module"
import { ReferralsModule } from "../referrals/referrals.module"
import { NotificationsModule } from "../notifications/notifications.module"
import { StreaksModule } from "../streaks/streaks.module"
import { AnalyticsEventService } from "./analytics-event.service"
import { AnalyticsAggregationWorkerService } from "./analytics-aggregation-worker.service"
import { AnalyticsReportingService } from "./analytics-reporting.service"
import { AnalyticsReportingWorkerService } from "./analytics-reporting-worker.service"
import { WinStreaksModule } from "../win-streaks/win-streaks.module"
import { DailyChallengesModule } from "../daily-challenges/daily-challenges.module"
import { GemBlitzModule } from "../gem-blitz/gem-blitz.module"
import { GemBlitzAdminController } from "../gem-blitz/gem-blitz-admin.controller"
import { TileRushModule } from "../tile-rush/tile-rush.module"
import { TileRushAdminController } from "../tile-rush/tile-rush-admin.controller"

@Module({
  imports: [DatabaseModule, AuthModule, UsersModule, ProgressionModule, EconomyModule, LeaderboardModule, GameModule, CommerceModule, StorageModule, FriendsModule, ConfigModule, AdRewardsModule, AdMobModule, GldModule, ReferralsModule, NotificationsModule, StreaksModule, WinStreaksModule, DailyChallengesModule, GemBlitzModule, TileRushModule],
  controllers: [SystemAdminController, GemBlitzAdminController, TileRushAdminController],
  providers: [
    SystemAdminService,
    SystemAdminGuard,
    DeleteUserTransaction,
    EnsureSystemAdminTransaction,
    ResetUserPasswordTransaction,
    UpdateUserProfileTransaction,
    UpdateUserStatusTransaction,
    TerminateAdminSessionTransaction,
    SystemAdminAnalyticsService,
    AnalyticsEventService,
    AnalyticsAggregationWorkerService,
    AnalyticsReportingService,
    AnalyticsReportingWorkerService,
  ],
  exports: [AnalyticsEventService],
})
export class SystemAdminModule {}
