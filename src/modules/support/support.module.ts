import { Module } from "@nestjs/common"

import { DatabaseModule } from "../../database/database.module"
import { NotificationsModule } from "../notifications/notifications.module"
import { SystemAdminGuard } from "../system-admin/system-admin.guard"
import { SupportAdminController } from "./support.admin.controller"
import { SupportAgentController } from "./support.agent.controller"
import { SupportController } from "./support.controller"
import { SupportService } from "./support.service"

@Module({
  imports: [DatabaseModule, NotificationsModule],
  controllers: [SupportController, SupportAgentController, SupportAdminController],
  providers: [SupportService, SystemAdminGuard],
  exports: [SupportService],
})
export class SupportModule {}
