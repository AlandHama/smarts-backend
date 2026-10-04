import { Module } from "@nestjs/common";

import { DatabaseModule } from "../../database/database.module";
import { DailyChallengeController } from "./daily-challenge.controller";
import { DailyChallengeService } from "./daily-challenge.service";

@Module({
  imports: [DatabaseModule],
  controllers: [DailyChallengeController],
  providers: [DailyChallengeService],
  exports: [DailyChallengeService],
})
export class DailyChallengesModule {}
