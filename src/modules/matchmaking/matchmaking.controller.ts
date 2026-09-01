import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post } from "@nestjs/common"
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger"

import { CurrentUser } from "../../common/decorators/current-user.decorator"
import { UserResponseDto } from "../auth/dtos/user-response.dto"
import { CreateFriendInviteDto, EnqueuePlayerDto } from "./dtos"
import { MatchmakingService } from "./matchmaking.service"

@ApiTags("Matchmaking")
@ApiBearerAuth("access-token")
@Controller("matchmaking")
export class MatchmakingController {
  constructor(private readonly matchmakingService: MatchmakingService) {}

  @Post("queue")
  @ApiOperation({ summary: "Queue the authenticated player using server-owned matchmaking policy" })
  enqueue(@CurrentUser() user: UserResponseDto, @Body() dto: EnqueuePlayerDto) { return this.matchmakingService.enqueue(user.id, dto) }

  @Get("status")
  status(@CurrentUser() user: UserResponseDto) { return this.matchmakingService.status(user.id) }

  @Post("tickets/:ticketId/heartbeat")
  heartbeat(@CurrentUser() user: UserResponseDto, @Param("ticketId", ParseUUIDPipe) ticketId: string) { return this.matchmakingService.heartbeat(user.id, ticketId) }

  @Delete("tickets/:ticketId")
  cancel(@CurrentUser() user: UserResponseDto, @Param("ticketId", ParseUUIDPipe) ticketId: string) { return this.matchmakingService.cancel(user.id, ticketId) }

  @Get("friend-invites")
  invites(@CurrentUser() user: UserResponseDto) { return this.matchmakingService.invites(user.id) }

  @Post("friend-invites")
  createInvite(@CurrentUser() user: UserResponseDto, @Body() dto: CreateFriendInviteDto) { return this.matchmakingService.createInvite(user.id, dto) }

  @Post("friend-invites/:inviteId/accept")
  acceptInvite(@CurrentUser() user: UserResponseDto, @Param("inviteId", ParseUUIDPipe) inviteId: string) { return this.matchmakingService.acceptInvite(user.id, inviteId) }

  @Post("friend-invites/:inviteId/decline")
  declineInvite(@CurrentUser() user: UserResponseDto, @Param("inviteId", ParseUUIDPipe) inviteId: string) { return this.matchmakingService.declineInvite(user.id, inviteId) }

  @Delete("friend-invites/:inviteId")
  cancelInvite(@CurrentUser() user: UserResponseDto, @Param("inviteId", ParseUUIDPipe) inviteId: string) { return this.matchmakingService.cancelInvite(user.id, inviteId) }
}
