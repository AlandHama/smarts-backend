import { Module } from "@nestjs/common"

import { DatabaseModule } from "../../database/database.module"
import { AuthModule } from "../auth/auth.module"
import { UsersModule } from "../admin/access/users/users.module"
import { SystemAdminController } from "./system-admin.controller"
import { SystemAdminService } from "./system-admin.service"
import { SystemAdminGuard } from "./system-admin.guard"
import { DeleteUserTransaction } from "./transactions/delete-user-transaction"
import { EnsureSystemAdminTransaction } from "./transactions/ensure-system-admin-transaction"
import { UpdateUserStatusTransaction } from "./transactions/update-user-status-transaction"

@Module({
  imports: [DatabaseModule, AuthModule, UsersModule],
  controllers: [SystemAdminController],
  providers: [SystemAdminService, SystemAdminGuard, DeleteUserTransaction, EnsureSystemAdminTransaction, UpdateUserStatusTransaction],
})
export class SystemAdminModule {}
