import { Module } from "@nestjs/common"

import { DatabaseModule } from "../../database/database.module"
import { EconomyModule } from "../economy/economy.module"
import { ProgressionModule } from "../progression/progression.module"
import { MissionsAdminController } from "./missions-admin.controller"
import { MissionsController } from "./missions.controller"
import { MissionsService } from "./missions.service"

@Module({
  imports: [DatabaseModule, EconomyModule, ProgressionModule],
  controllers: [MissionsController, MissionsAdminController],
  providers: [MissionsService],
  exports: [MissionsService],
})
export class MissionsModule {}
