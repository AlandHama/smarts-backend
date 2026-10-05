import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from "@nestjs/common"
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger"
import { CurrentUser } from "../../common/decorators/current-user.decorator"
import { UserResponseDto } from "../auth/dtos/user-response.dto"
import { GemBlitzMoveDto } from "./dtos/gem-blitz.dto"
import { GemBlitzService } from "./gem-blitz.service"

@ApiTags("Gem Blitz")
@ApiBearerAuth("access-token")
@Controller("gem-blitz")
export class GemBlitzController {
  constructor(private readonly service: GemBlitzService) {}
  @Get("matches/:matchId") snapshot(@Param("matchId", ParseUUIDPipe) matchId: string, @CurrentUser() user: UserResponseDto) { return this.service.snapshot(user.id, matchId) }
  @Post("matches/:matchId/start") start(@Param("matchId", ParseUUIDPipe) matchId: string, @CurrentUser() user: UserResponseDto) { return this.service.start(user.id, matchId) }
  @Post("matches/:matchId/moves") move(@Param("matchId", ParseUUIDPipe) matchId: string, @CurrentUser() user: UserResponseDto, @Body() dto: GemBlitzMoveDto) { return this.service.move(user.id, matchId, dto) }
  @Post("matches/:matchId/forfeit") forfeit(@Param("matchId", ParseUUIDPipe) matchId: string, @CurrentUser() user: UserResponseDto) { return this.service.forfeit(user.id, matchId) }
}
