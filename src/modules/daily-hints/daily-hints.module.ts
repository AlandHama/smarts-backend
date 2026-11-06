import { Module } from "@nestjs/common";

import { DatabaseModule } from "../../database/database.module";
import { DailyHintsController } from "./daily-hints.controller";
import { DailyHintsService } from "./daily-hints.service";

@Module({
  imports: [DatabaseModule],
  controllers: [DailyHintsController],
  providers: [DailyHintsService],
  exports: [DailyHintsService],
})
export class DailyHintsModule {}
