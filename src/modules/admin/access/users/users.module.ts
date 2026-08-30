import { Module } from "@nestjs/common"

import { ChangePasswordTransaction } from "./transactions/change-password-transaction"
import { CreateUserTransaction } from "./transactions/create-user-transaction"
import { UpdateUserLastOnlineTransaction } from "./transactions/update-user-last-online-transaction"
import { UsersService } from "./users.service"
import { EconomyModule } from "../../../economy/economy.module"

@Module({
  imports: [EconomyModule],
  providers: [UsersService, CreateUserTransaction, ChangePasswordTransaction, UpdateUserLastOnlineTransaction],
  exports: [UsersService, CreateUserTransaction, ChangePasswordTransaction, UpdateUserLastOnlineTransaction],
})
export class UsersModule {}
