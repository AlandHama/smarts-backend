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
import { GameModule } from "./modules/game/game.module"
import { MatchesModule } from "./modules/matches/matches.module"
import { CommerceModule } from "./modules/commerce/commerce.module"
import { StorageModule } from "./modules/storage/storage.module"
import { FriendsModule } from "./modules/friends/friends.module"
import { MatchmakingModule } from "./modules/matchmaking/matchmaking.module"

@Module({
  imports: [DatabaseModule, AuthModule, EconomyModule, LeaderboardModule, GameModule, MatchesModule, MatchmakingModule, PlayersModule, ProgressionModule, CommerceModule, StorageModule, FriendsModule, SystemAdminModule],
  controllers: [HealthController, NotesController],
})
export class AppModule {}
