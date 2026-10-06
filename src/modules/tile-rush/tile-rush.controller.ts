import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from "@nestjs/common"
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger"
import { CurrentUser } from "../../common/decorators/current-user.decorator"
import { UserResponseDto } from "../auth/dtos/user-response.dto"
import { TileRushActionDto } from "./dtos/tile-rush.dto"
import { TileRushService } from "./tile-rush.service"

@ApiTags("Tile Rush")
@ApiBearerAuth("access-token")
@Controller("tile-rush")
export class TileRushController {
  constructor(private readonly service: TileRushService) {}

  @Get("matches/:matchId")
  snapshot(@Param("matchId", ParseUUIDPipe) matchId: string, @CurrentUser() user: UserResponseDto) {
    return this.service.snapshot(user.id, matchId)
  }

  @Post("matches/:matchId/start")
  start(@Param("matchId", ParseUUIDPipe) matchId: string, @CurrentUser() user: UserResponseDto) {
    return this.service.start(user.id, matchId)
  }

  @Post("matches/:matchId/actions")
  action(@Param("matchId", ParseUUIDPipe) matchId: string, @CurrentUser() user: UserResponseDto, @Body() dto: TileRushActionDto) {
    return this.service.action(user.id, matchId, dto)
  }

  @Post("matches/:matchId/reconcile")
  reconcile(@Param("matchId", ParseUUIDPipe) matchId: string, @CurrentUser() user: UserResponseDto) {
    return this.service.snapshot(user.id, matchId)
  }

  @Post("matches/:matchId/forfeit")
  forfeit(@Param("matchId", ParseUUIDPipe) matchId: string, @CurrentUser() user: UserResponseDto) {
    return this.service.forfeit(user.id, matchId)
  }
}
