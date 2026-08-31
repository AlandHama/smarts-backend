import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from "@nestjs/common"
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger"

import { CurrentUser } from "../../common/decorators/current-user.decorator"
import { UserResponseDto } from "../auth/dtos/user-response.dto"
import { CompleteMatchDto, CreateMatchDto, MatchEventDto } from "./dtos"
import { MatchService } from "./match.service"

@ApiTags("Matches")
@ApiBearerAuth("access-token")
@Controller("matches")
export class MatchController {
  constructor(private readonly matchService: MatchService) {}

  @Post()
  @ApiOperation({ summary: "Create a server-owned match and issue its challenge assignments" })
  create(@CurrentUser() user: UserResponseDto, @Body() dto: CreateMatchDto) { return this.matchService.create(user.id, dto) }

  @Get(":matchId")
  get(@Param("matchId", ParseUUIDPipe) matchId: string, @CurrentUser() user: UserResponseDto) { return this.matchService.get(matchId, user.id) }

  @Post(":matchId/events")
  @ApiOperation({ summary: "Submit a bounded gameplay event; answers are verified against server content" })
  event(@Param("matchId", ParseUUIDPipe) matchId: string, @CurrentUser() user: UserResponseDto, @Body() dto: MatchEventDto) { return this.matchService.recordEventForPlayer(matchId, user.id, dto) }

  @Post(":matchId/complete")
  @ApiOperation({ summary: "Finish and atomically settle a match when all players have submitted" })
  complete(@Param("matchId", ParseUUIDPipe) matchId: string, @CurrentUser() user: UserResponseDto, @Body() dto: CompleteMatchDto) { return this.matchService.complete(matchId, user.id, dto) }

  @Get(":matchId/settlement")
  settlement(@Param("matchId", ParseUUIDPipe) matchId: string, @CurrentUser() user: UserResponseDto) { return this.matchService.getSettlement(matchId, user.id) }
}
