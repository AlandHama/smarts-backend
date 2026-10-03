import { Module } from "@nestjs/common"

import { DatabaseModule } from "../../database/database.module"
import { AuthModule } from "../auth/auth.module"
import { ChatsModule } from "../chats/chats.module"
import { FriendsModule } from "../friends/friends.module"
import { NotificationsModule } from "../notifications/notifications.module"
import { EconomyModule } from "../economy/economy.module"
import { MatchesModule } from "../matches/matches.module"
import { SystemAdminGuard } from "../system-admin/system-admin.guard"
import { SystemAdminModule } from "../system-admin/system-admin.module"
import { CooperativeAdminController } from "./cooperative.admin.controller"
import { CooperativeController } from "./cooperative.controller"
import { CooperativeService } from "./cooperative.service"
import { PartyService } from "./party.service"
import { CooperativeMatchService } from "./cooperative-match.service"
import { CooperativeMatchmakingWorker } from "./cooperative-matchmaking.worker"

@Module({
  imports: [DatabaseModule, AuthModule, FriendsModule, ChatsModule, NotificationsModule, EconomyModule, MatchesModule, SystemAdminModule],
  controllers: [CooperativeController, CooperativeAdminController],
  providers: [PartyService, CooperativeService, CooperativeMatchService, CooperativeMatchmakingWorker, SystemAdminGuard],
  exports: [PartyService, CooperativeService, CooperativeMatchService],
})
export class CooperativeModule {}
