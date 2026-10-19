import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from "@nestjs/common"
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger"

import { CurrentUser } from "../../common/decorators/current-user.decorator"
import { UserResponseDto } from "../auth/dtos/user-response.dto"
import { PerfectTimingTapDto } from "./dtos/perfect-timing.dto"
import { PerfectTimingService } from "./perfect-timing.service"

@ApiTags("Perfect Timing")
@ApiBearerAuth("access-token")
@Controller("perfect-timing")
export class PerfectTimingController {
  constructor(private readonly service: PerfectTimingService) {}

  @Get("clock")
  clock() { return this.service.clock() }

  @Get("matches/:matchId")
  snapshot(@Param("matchId", ParseUUIDPipe) matchId: string, @CurrentUser() user: UserResponseDto) { return this.service.snapshot(user.id, matchId) }

  @Post("matches/:matchId/start")
  start(@Param("matchId", ParseUUIDPipe) matchId: string, @CurrentUser() user: UserResponseDto) { return this.service.start(user.id, matchId) }

  @Post("matches/:matchId/taps")
  tap(@Param("matchId", ParseUUIDPipe) matchId: string, @CurrentUser() user: UserResponseDto, @Body() dto: PerfectTimingTapDto) { return this.service.tap(user.id, matchId, dto) }

  @Post("matches/:matchId/reconcile")
  reconcile(@Param("matchId", ParseUUIDPipe) matchId: string, @CurrentUser() user: UserResponseDto) { return this.service.snapshot(user.id, matchId) }

  @Post("matches/:matchId/forfeit")
  forfeit(@Param("matchId", ParseUUIDPipe) matchId: string, @CurrentUser() user: UserResponseDto) { return this.service.forfeit(user.id, matchId) }
}
