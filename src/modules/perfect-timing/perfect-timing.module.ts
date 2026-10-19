import { Module } from "@nestjs/common"

import { DatabaseModule } from "../../database/database.module"
import { FraudModule } from "../fraud/fraud.module"
import { MatchesModule } from "../matches/matches.module"
import { PerfectTimingController } from "./perfect-timing.controller"
import { PerfectTimingAdminController } from "./perfect-timing-admin.controller"
import { PerfectTimingService } from "./perfect-timing.service"

@Module({
  imports: [DatabaseModule, FraudModule, MatchesModule],
  controllers: [PerfectTimingController, PerfectTimingAdminController],
  providers: [PerfectTimingService],
  exports: [PerfectTimingService],
})
export class PerfectTimingModule {}
