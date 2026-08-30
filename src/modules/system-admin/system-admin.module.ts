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
import { ProgressionModule } from "../progression/progression.module"
import { EconomyModule } from "../economy/economy.module"
import { LeaderboardModule } from "../leaderboard/leaderboard.module"

@Module({
  imports: [DatabaseModule, AuthModule, UsersModule, ProgressionModule, EconomyModule, LeaderboardModule],
  controllers: [SystemAdminController],
  providers: [
    SystemAdminService,
    SystemAdminGuard,
    DeleteUserTransaction,
    EnsureSystemAdminTransaction,
    ResetUserPasswordTransaction,
    UpdateUserProfileTransaction,
    UpdateUserStatusTransaction,
  ],
})
export class SystemAdminModule {}
