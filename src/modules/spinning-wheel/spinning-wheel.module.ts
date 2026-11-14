import { Module } from "@nestjs/common"
import { DatabaseModule } from "../../database/database.module"
import { EconomyModule } from "../economy/economy.module"
import { ProgressionModule } from "../progression/progression.module"
import { CommerceModule } from "../commerce/commerce.module"
import { SystemAdminGuard } from "../system-admin/system-admin.guard"
import { SpinningWheelController } from "./spinning-wheel.controller"
import { SpinningWheelService } from "./spinning-wheel.service"

@Module({ imports: [DatabaseModule, EconomyModule, ProgressionModule, CommerceModule], controllers: [SpinningWheelController], providers: [SpinningWheelService, SystemAdminGuard], exports: [SpinningWheelService] })
export class SpinningWheelModule {}
