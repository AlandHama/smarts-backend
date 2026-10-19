import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from "@nestjs/common"
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger"
import { CurrentUser } from "../../common/decorators/current-user.decorator"
import { UserResponseDto } from "../auth/dtos/user-response.dto"
import { BombPathCompleteDto, BombPathStepDto } from "./dtos/bomb-path.dto"
import { BombPathService } from "./bomb-path.service"

@ApiTags("Bomb Path")
@ApiBearerAuth("access-token")
@Controller("bomb-path")
export class BombPathController {
  constructor(private readonly service: BombPathService) {}

  @Get("clock") clock() { return this.service.clock() }
  @Get("matches/:matchId") snapshot(@Param("matchId", ParseUUIDPipe) matchId: string, @CurrentUser() user: UserResponseDto) { return this.service.snapshot(user.id, matchId) }
  @Post("matches/:matchId/start") start(@Param("matchId", ParseUUIDPipe) matchId: string, @CurrentUser() user: UserResponseDto) { return this.service.start(user.id, matchId) }
  @Post("matches/:matchId/actions/step") step(@Param("matchId", ParseUUIDPipe) matchId: string, @CurrentUser() user: UserResponseDto, @Body() dto: BombPathStepDto) { return this.service.step(user.id, matchId, dto) }
  @Post("matches/:matchId/actions/complete") complete(@Param("matchId", ParseUUIDPipe) matchId: string, @CurrentUser() user: UserResponseDto, @Body() dto: BombPathCompleteDto) { return this.service.complete(user.id, matchId, dto) }
  @Post("matches/:matchId/reconcile") reconcile(@Param("matchId", ParseUUIDPipe) matchId: string, @CurrentUser() user: UserResponseDto) { return this.service.snapshot(user.id, matchId) }
  @Post("matches/:matchId/forfeit") forfeit(@Param("matchId", ParseUUIDPipe) matchId: string, @CurrentUser() user: UserResponseDto) { return this.service.forfeit(user.id, matchId) }
}
