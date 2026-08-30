import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common"
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger"

import { CurrentUser } from "../../common/decorators/current-user.decorator"
import { UserResponseDto } from "../auth/dtos/user-response.dto"
import { LeaderboardMembersDto, LeaderboardQueryDto } from "./dtos"
import { LeaderboardService } from "./leaderboard.service"

@ApiTags("Leaderboards")
@ApiBearerAuth("access-token")
@Controller("leaderboards")
export class LeaderboardController {
  constructor(private readonly leaderboardService: LeaderboardService) {}

  @Get()
  @ApiOperation({ summary: "List active leaderboard definitions" })
  definitions() { return this.leaderboardService.listDefinitions(false) }

  @Get(":key")
  @ApiOperation({ summary: "List the current season leaderboard with deterministic ranks" })
  list(@Param("key") key: string, @Query() query: LeaderboardQueryDto, @CurrentUser() user: UserResponseDto) { return this.leaderboardService.list(key, query, user.id) }

  @Post(":key/members")
  @ApiOperation({ summary: "Get selected members from the current leaderboard season" })
  members(@Param("key") key: string, @Body() dto: LeaderboardMembersDto) { return this.leaderboardService.members(key, dto) }
}
