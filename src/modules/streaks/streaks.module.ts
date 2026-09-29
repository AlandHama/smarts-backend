import { Module } from "@nestjs/common"
import { DatabaseModule } from "../../database/database.module"
import { SystemAdminGuard } from "../system-admin/system-admin.guard"
import { StreaksAdminController } from "./streaks-admin.controller"
import { StreaksController } from "./streaks.controller"
import { StreaksService } from "./streaks.service"

@Module({ imports: [DatabaseModule], controllers: [StreaksController, StreaksAdminController], providers: [StreaksService, SystemAdminGuard], exports: [StreaksService] })
export class StreaksModule {}
