import { Module } from "@nestjs/common"

import { DatabaseModule } from "../../database/database.module"
import { FraudModule } from "../fraud/fraud.module"
import { MatchesModule } from "../matches/matches.module"
import { WordDashController } from "./word-dash.controller"
import { WordDashDictionary } from "./engine/word-dash-dictionary"
import { WordDashService } from "./word-dash.service"

@Module({
  imports: [DatabaseModule, FraudModule, MatchesModule],
  controllers: [WordDashController],
  providers: [WordDashDictionary, WordDashService],
  exports: [WordDashService, WordDashDictionary],
})
export class WordDashModule {}
