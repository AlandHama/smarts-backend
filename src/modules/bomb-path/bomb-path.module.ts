import { Module } from "@nestjs/common"
import { DatabaseModule } from "../../database/database.module"
import { FraudModule } from "../fraud/fraud.module"
import { MatchesModule } from "../matches/matches.module"
import { BombPathAdminController } from "./bomb-path-admin.controller"
import { BombPathController } from "./bomb-path.controller"
import { BombPathService } from "./bomb-path.service"

@Module({
  imports: [DatabaseModule, FraudModule, MatchesModule],
  controllers: [BombPathController, BombPathAdminController],
  providers: [BombPathService],
  exports: [BombPathService],
})
export class BombPathModule {}
