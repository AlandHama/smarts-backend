import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from "@nestjs/common"
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger"

import { CurrentUser } from "../../common/decorators/current-user.decorator"
import { UserResponseDto } from "../auth/dtos/user-response.dto"
import { ClaimAchievementDto } from "./dtos"
import { MissionsService } from "./missions.service"

@ApiTags("Missions and achievements")
@ApiBearerAuth("access-token")
@Controller()
export class MissionsController {
  constructor(private readonly missions: MissionsService) {}

  @Get("missions/me")
  @ApiOperation({ summary: "Get the authenticated player's current missions and achievements" })
  me(@CurrentUser() user: UserResponseDto) { return this.missions.getForPlayer(user.id) }

  @Post("missions/:missionId/claim")
  claimMission(@CurrentUser() user: UserResponseDto, @Param("missionId", ParseUUIDPipe) missionId: string) { return this.missions.claimMission(user.id, missionId) }

  @Post("achievements/:achievementId/claim")
  claimAchievement(@CurrentUser() user: UserResponseDto, @Param("achievementId", ParseUUIDPipe) achievementId: string, @Body() dto: ClaimAchievementDto) { return this.missions.claimAchievement(user.id, achievementId, dto) }
}
