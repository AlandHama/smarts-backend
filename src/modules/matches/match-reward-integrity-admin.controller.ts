import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from "@nestjs/common"
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger"
import { CurrentUser } from "../../common/decorators/current-user.decorator"
import { UserResponseDto } from "../auth/dtos/user-response.dto"
import { SystemAdminGuard } from "../system-admin/system-admin.guard"
import { MatchRewardCorrectionDto, MatchRewardReviewDto, UpdateMatchIntegrityPolicyDto } from "./dtos"
import { MatchRewardIntegrityAdminService } from "./match-reward-integrity-admin.service"

@ApiTags("System admin match integrity")
@ApiBearerAuth("access-token")
@UseGuards(SystemAdminGuard)
@Controller("system-admin/api/match-integrity")
export class MatchRewardIntegrityAdminController {
  constructor(private readonly integrity: MatchRewardIntegrityAdminService) {}

  @Get("policies") policies() { return this.integrity.policies() }
  @Patch("policies") updatePolicy(@Body() dto: UpdateMatchIntegrityPolicyDto, @CurrentUser() admin: UserResponseDto) { return this.integrity.updatePolicy(dto, admin.id) }
  @Get("dashboard") dashboard() { return this.integrity.dashboard() }
  @Get("holds") holds(@Query("status") status?: string) { return this.integrity.listHolds(status) }
  @Post("holds/:holdId/release") release(@Param("holdId", ParseUUIDPipe) holdId: string, @Body() dto: MatchRewardReviewDto, @CurrentUser() admin: UserResponseDto) { return this.integrity.releaseHold(holdId, dto, admin.id) }
  @Post("holds/:holdId/cancel") cancel(@Param("holdId", ParseUUIDPipe) holdId: string, @Body() dto: MatchRewardReviewDto, @CurrentUser() admin: UserResponseDto) { return this.integrity.cancelHold(holdId, dto, admin.id) }
  @Post("matches/:matchId/retry") retry(@Param("matchId", ParseUUIDPipe) matchId: string, @CurrentUser() admin: UserResponseDto) { return this.integrity.retrySettlement(matchId, admin.id) }
  @Get("matches/:matchId/replay") replay(@Param("matchId", ParseUUIDPipe) matchId: string) { return this.integrity.replay(matchId) }
  @Post("users/:userId/progression-correction") correction(@Param("userId", ParseUUIDPipe) userId: string, @Body() dto: MatchRewardCorrectionDto, @CurrentUser() admin: UserResponseDto) { return this.integrity.correctProgression(userId, dto, admin.id) }
}
