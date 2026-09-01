import { Module } from "@nestjs/common"

import { DatabaseModule } from "../../database/database.module"
import { AcceptFriendRequestTransaction } from "./transactions/accept-friend-request-transaction"
import { BlockPlayerTransaction } from "./transactions/block-player-transaction"
import { CreateFriendRequestTransaction } from "./transactions/create-friend-request-transaction"
import { HeartbeatPresenceTransaction } from "./transactions/heartbeat-presence-transaction"
import { RemoveFriendshipTransaction } from "./transactions/remove-friendship-transaction"
import { RespondFriendRequestTransaction } from "./transactions/respond-friend-request-transaction"
import { UnblockPlayerTransaction } from "./transactions/unblock-player-transaction"
import { FriendsController } from "./friends.controller"
import { FriendsService } from "./friends.service"

@Module({ imports: [DatabaseModule], controllers: [FriendsController], providers: [FriendsService, CreateFriendRequestTransaction, AcceptFriendRequestTransaction, RespondFriendRequestTransaction, RemoveFriendshipTransaction, BlockPlayerTransaction, UnblockPlayerTransaction, HeartbeatPresenceTransaction], exports: [FriendsService] })
export class FriendsModule {}
