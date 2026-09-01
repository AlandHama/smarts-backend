import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common"
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger"

import { CurrentUser } from "../../common/decorators/current-user.decorator"
import { UserResponseDto } from "../auth/dtos/user-response.dto"
import { FriendsQueryDto, PlayerLookupQueryDto } from "./dtos/friends.dto"
import { FriendsService } from "./friends.service"

@ApiTags("Friends and presence")
@ApiBearerAuth("access-token")
@Controller()
export class FriendsController {
  constructor(private readonly friendsService: FriendsService) {}

  @Get("friends")
  @ApiOperation({ summary: "List accepted friends with server-derived presence" })
  friends(@CurrentUser() user: UserResponseDto, @Query() query: FriendsQueryDto) { return this.friendsService.listFriends(user.id, query) }

  @Get("friends/incoming")
  incoming(@CurrentUser() user: UserResponseDto, @Query() query: FriendsQueryDto) { return this.friendsService.listRequests(user.id, "incoming", query) }

  @Get("friends/outgoing")
  outgoing(@CurrentUser() user: UserResponseDto, @Query() query: FriendsQueryDto) { return this.friendsService.listRequests(user.id, "outgoing", query) }

  @Get("friends/lookup")
  lookup(@CurrentUser() user: UserResponseDto, @Query() query: PlayerLookupQueryDto) { return this.friendsService.lookupPlayers(user.id, query) }

  @Post("friends/:playerId")
  request(@CurrentUser() user: UserResponseDto, @Param("playerId", ParseUUIDPipe) playerId: string) { return this.friendsService.requestFriend(user.id, playerId) }

  @Post("friends/incoming/:playerId/accept")
  accept(@CurrentUser() user: UserResponseDto, @Param("playerId", ParseUUIDPipe) playerId: string) { return this.friendsService.acceptFriendRequest(user.id, playerId) }

  @Post("friends/incoming/:playerId/decline")
  decline(@CurrentUser() user: UserResponseDto, @Param("playerId", ParseUUIDPipe) playerId: string) { return this.friendsService.declineFriendRequest(user.id, playerId) }

  @Post("friends/outgoing/:playerId/cancel")
  cancel(@CurrentUser() user: UserResponseDto, @Param("playerId", ParseUUIDPipe) playerId: string) { return this.friendsService.cancelFriendRequest(user.id, playerId) }

  @Delete("friends/:playerId")
  remove(@CurrentUser() user: UserResponseDto, @Param("playerId", ParseUUIDPipe) playerId: string) { return this.friendsService.removeFriend(user.id, playerId) }

  @Post("friends/:playerId/block")
  block(@CurrentUser() user: UserResponseDto, @Param("playerId", ParseUUIDPipe) playerId: string) { return this.friendsService.blockPlayer(user.id, playerId) }

  @Delete("friends/:playerId/block")
  unblock(@CurrentUser() user: UserResponseDto, @Param("playerId", ParseUUIDPipe) playerId: string) { return this.friendsService.unblockPlayer(user.id, playerId) }

  @Post("presence/heartbeat")
  heartbeat(@CurrentUser() user: UserResponseDto) { return this.friendsService.heartbeat(user.id) }

  @Get("presence/me")
  presenceMe(@CurrentUser() user: UserResponseDto) { return this.friendsService.getPresence(user.id, user.id) }

  @Get("players/:userId/presence")
  publicPresence(@CurrentUser() viewer: UserResponseDto, @Param("userId", ParseUUIDPipe) userId: string) { return this.friendsService.getPresence(userId, viewer.id) }
}
