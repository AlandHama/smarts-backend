import { Module } from "@nestjs/common"

import { DatabaseModule } from "./database/database.module"
import { HealthController } from "./health.controller"
import { NotesController } from "./notes.controller"
import { AuthModule } from "./modules/auth/auth.module"
import { PlayersModule } from "./modules/players/players.module"
import { SystemAdminModule } from "./modules/system-admin/system-admin.module"
import { ProgressionModule } from "./modules/progression/progression.module"
import { EconomyModule } from "./modules/economy/economy.module"
import { LeaderboardModule } from "./modules/leaderboard/leaderboard.module"

@Module({
  imports: [DatabaseModule, AuthModule, EconomyModule, LeaderboardModule, PlayersModule, ProgressionModule, SystemAdminModule],
  controllers: [HealthController, NotesController],
})
export class AppModule {}
