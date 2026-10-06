import { Module } from "@nestjs/common"
import { DatabaseModule } from "../../database/database.module"
import { MatchesModule } from "../matches/matches.module"
import { TileRushController } from "./tile-rush.controller"
import { TileRushService } from "./tile-rush.service"

@Module({
  imports: [DatabaseModule, MatchesModule],
  controllers: [TileRushController],
  providers: [TileRushService],
  exports: [TileRushService],
})
export class TileRushModule {}
