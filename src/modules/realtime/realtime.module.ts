import { Module } from "@nestjs/common"

import { AuthModule } from "../auth/auth.module"
import { DatabaseModule } from "../../database/database.module"
import { MatchesModule } from "../matches/matches.module"
import { MatchmakingModule } from "../matchmaking/matchmaking.module"
import { ChatsModule } from "../chats/chats.module"
import { RealtimeGateway } from "./realtime.gateway"

@Module({
  imports: [DatabaseModule, AuthModule, MatchesModule, MatchmakingModule, ChatsModule],
  providers: [RealtimeGateway],
})
export class RealtimeModule {}
