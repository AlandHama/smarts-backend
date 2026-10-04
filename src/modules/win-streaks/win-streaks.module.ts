import { Module } from "@nestjs/common"
import { DatabaseModule } from "../../database/database.module"
import { SystemAdminGuard } from "../system-admin/system-admin.guard"
import { WinStreaksController } from "./win-streaks.controller"
import { WinStreaksAdminController } from "./win-streaks-admin.controller"
import { WinStreaksService } from "./win-streaks.service"

@Module({ imports: [DatabaseModule], controllers: [WinStreaksController, WinStreaksAdminController], providers: [WinStreaksService, SystemAdminGuard], exports: [WinStreaksService] })
export class WinStreaksModule {}
