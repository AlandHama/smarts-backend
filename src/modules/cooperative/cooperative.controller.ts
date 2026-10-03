import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post } from "@nestjs/common"
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger"

import { CurrentUser } from "../../common/decorators/current-user.decorator"
import { UserResponseDto } from "../auth/dtos/user-response.dto"
import { CreatePartyInviteDto, QueuePartyDto } from "./dtos"
import { PartyService } from "./party.service"
import { CooperativeMatchService } from "./cooperative-match.service"

@ApiTags("Cooperative parties")
@ApiBearerAuth("access-token")
@Controller("cooperative")
export class CooperativeController {
  constructor(private readonly parties: PartyService, private readonly matches: CooperativeMatchService) {}

  @Post("parties") create(@CurrentUser() user: UserResponseDto) { return this.parties.create(user.id) }
  @Get("parties/current") async current(@CurrentUser() user: UserResponseDto) { return { party: await this.parties.current(user.id) } }
  @Get("stats") stats(@CurrentUser() user: UserResponseDto) { return this.parties.stats(user.id) }
  @Get("policy") async policy() { const policy = await this.parties.policy(); return { enabled: policy.enabled, randomEnabled: policy.randomEnabled, rankedEnabled: policy.rankedEnabled, cooperativePartyEnabled: policy.cooperativePartyEnabled, cooperativeRandomEnabled: policy.cooperativeRandomEnabled, cooperativeRankedEnabled: policy.cooperativeRankedEnabled, cooperativeVoiceEnabled: policy.cooperativeVoiceEnabled, cooperativeRewardsEnabled: policy.cooperativeRewardsEnabled, voiceEnabled: policy.voiceEnabled, rankedEntryFeeGld: policy.rankedEntryFeeGld, rankedStakeAmountGld: policy.rankedStakeAmountGld, rankedPayoutPercent: policy.rankedPayoutPercent } }
  @Get("party-invites") invites(@CurrentUser() user: UserResponseDto) { return this.parties.invites(user.id) }
  @Post("parties/:partyId/invites") invite(@CurrentUser() user: UserResponseDto, @Param("partyId", ParseUUIDPipe) partyId: string, @Body() dto: CreatePartyInviteDto) { return this.parties.invite(user.id, partyId, dto) }
  @Post("party-invites/:inviteId/accept") accept(@CurrentUser() user: UserResponseDto, @Param("inviteId", ParseUUIDPipe) inviteId: string) { return this.parties.acceptInvite(user.id, inviteId) }
  @Post("party-invites/:inviteId/decline") decline(@CurrentUser() user: UserResponseDto, @Param("inviteId", ParseUUIDPipe) inviteId: string) { return this.parties.declineInvite(user.id, inviteId) }
  @Post("parties/:partyId/queue") queue(@CurrentUser() user: UserResponseDto, @Param("partyId", ParseUUIDPipe) partyId: string, @Body() dto: QueuePartyDto) { return this.parties.queue(user.id, partyId, dto) }
  @Post("parties/:partyId/queue/cancel") cancelQueue(@CurrentUser() user: UserResponseDto, @Param("partyId", ParseUUIDPipe) partyId: string) { return this.parties.cancelQueue(user.id, partyId) }
  @Post("parties/:partyId/heartbeat") heartbeat(@CurrentUser() user: UserResponseDto, @Param("partyId", ParseUUIDPipe) partyId: string) { return this.parties.heartbeat(user.id, partyId) }
  @Post("parties/:partyId/leave") leave(@CurrentUser() user: UserResponseDto, @Param("partyId", ParseUUIDPipe) partyId: string) { return this.parties.leave(user.id, partyId) }
  @Get("matches/:matchId") match(@CurrentUser() user: UserResponseDto, @Param("matchId", ParseUUIDPipe) matchId: string) { return this.matches.getForPlayer(user.id, matchId) }
  @Post("matches/:matchId/confirm") confirm(@CurrentUser() user: UserResponseDto, @Param("matchId", ParseUUIDPipe) matchId: string) { return this.matches.confirm(user.id, matchId) }
}
