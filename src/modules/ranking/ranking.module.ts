import { Module } from "@nestjs/common"

import { DatabaseModule } from "../../database/database.module"
import { RankingController, RankingAdminController } from "./ranking.controller"
import { RankingService } from "./ranking.service"
import { SystemAdminGuard } from "../system-admin/system-admin.guard"

@Module({
  imports: [DatabaseModule],
  controllers: [RankingController, RankingAdminController],
  providers: [RankingService, SystemAdminGuard],
  exports: [RankingService],
})
export class RankingModule {}
