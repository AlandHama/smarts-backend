import { Module } from "@nestjs/common"

import { DatabaseModule } from "../../database/database.module"
import { NotificationsModule } from "../notifications/notifications.module"
import { StorageModule } from "../storage/storage.module"
import { SystemAdminGuard } from "../system-admin/system-admin.guard"
import { ChatsAdminController } from "./chats.admin.controller"
import { ChatsController } from "./chats.controller"
import { ChatsService } from "./chats.service"
import { ChatPresenceRegistry } from "./chat-presence.registry"

@Module({
  imports: [DatabaseModule, NotificationsModule, StorageModule],
  controllers: [ChatsController, ChatsAdminController],
  providers: [ChatsService, ChatPresenceRegistry, SystemAdminGuard],
  exports: [ChatsService, ChatPresenceRegistry],
})
export class ChatsModule {}
