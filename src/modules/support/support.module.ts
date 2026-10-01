import { Module } from "@nestjs/common"

import { DatabaseModule } from "../../database/database.module"
import { NotificationsModule } from "../notifications/notifications.module"
import { EconomyModule } from "../economy/economy.module"
import { SystemAdminGuard } from "../system-admin/system-admin.guard"
import { SupportAdminController } from "./support.admin.controller"
import { SupportAgentController } from "./support.agent.controller"
import { SupportController } from "./support.controller"
import { SupportService } from "./support.service"
import { SupportLiveChatService } from "./support-live-chat.service"

@Module({
  imports: [DatabaseModule, NotificationsModule, EconomyModule],
  controllers: [SupportController, SupportAgentController, SupportAdminController],
  providers: [SupportService, SupportLiveChatService, SystemAdminGuard],
  exports: [SupportService, SupportLiveChatService],
})
export class SupportModule {}
