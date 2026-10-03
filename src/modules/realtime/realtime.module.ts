import { Module } from "@nestjs/common"

import { AuthModule } from "../auth/auth.module"
import { DatabaseModule } from "../../database/database.module"
import { MatchesModule } from "../matches/matches.module"
import { MatchmakingModule } from "../matchmaking/matchmaking.module"
import { ChatsModule } from "../chats/chats.module"
import { SupportModule } from "../support/support.module"
import { CooperativeModule } from "../cooperative/cooperative.module"
import { RealtimeGateway } from "./realtime.gateway"

@Module({
  imports: [DatabaseModule, AuthModule, MatchesModule, MatchmakingModule, ChatsModule, SupportModule, CooperativeModule],
  providers: [RealtimeGateway],
})
export class RealtimeModule {}
