import { Module } from "@nestjs/common"

import { DatabaseModule } from "../../database/database.module"
import { MatchesModule } from "../matches/matches.module"
import { AcceptFriendInviteTransaction } from "./transactions/accept-friend-invite-transaction"
import { CancelTicketTransaction } from "./transactions/cancel-ticket-transaction"
import { ClaimMatchmakingPairTransaction } from "./transactions/claim-matchmaking-pair-transaction"
import { CreateFriendInviteTransaction } from "./transactions/create-friend-invite-transaction"
import { EnqueuePlayerTransaction } from "./transactions/enqueue-player-transaction"
import { ExpireMatchmakingTicketsTransaction } from "./transactions/expire-matchmaking-tickets-transaction"
import { HeartbeatTicketTransaction } from "./transactions/heartbeat-ticket-transaction"
import { RespondFriendInviteTransaction } from "./transactions/respond-friend-invite-transaction"
import { MatchmakingController } from "./matchmaking.controller"
import { MatchmakingService } from "./matchmaking.service"
import { MatchmakingWorkerService } from "./matchmaking-worker.service"

@Module({
  imports: [DatabaseModule, MatchesModule],
  controllers: [MatchmakingController],
  providers: [MatchmakingService, MatchmakingWorkerService, EnqueuePlayerTransaction, HeartbeatTicketTransaction, CancelTicketTransaction, ExpireMatchmakingTicketsTransaction, ClaimMatchmakingPairTransaction, CreateFriendInviteTransaction, AcceptFriendInviteTransaction, RespondFriendInviteTransaction],
  exports: [MatchmakingService],
})
export class MatchmakingModule {}
