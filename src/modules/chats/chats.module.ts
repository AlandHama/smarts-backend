import { Module } from "@nestjs/common"

import { DatabaseModule } from "../../database/database.module"
import { SystemAdminGuard } from "../system-admin/system-admin.guard"
import { ChatsAdminController } from "./chats.admin.controller"
import { ChatsController } from "./chats.controller"
import { ChatsService } from "./chats.service"

@Module({
  imports: [DatabaseModule],
  controllers: [ChatsController, ChatsAdminController],
  providers: [ChatsService, SystemAdminGuard],
  exports: [ChatsService],
})
export class ChatsModule {}
