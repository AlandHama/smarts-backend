import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from "@nestjs/common"
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger"
import { CurrentUser } from "../../common/decorators/current-user.decorator"
import { UserResponseDto } from "../auth/dtos/user-response.dto"
import { DominoActionDto, DominoPlayTileDto } from "./dtos/domino.dto"
import { DominoService } from "./domino.service"

@ApiTags("Domino")
@ApiBearerAuth("access-token")
@Controller("domino")
export class DominoController {
  constructor(private readonly service: DominoService) {}
  @Get("matches/:matchId") snapshot(@Param("matchId", ParseUUIDPipe) id: string, @CurrentUser() user: UserResponseDto) { return this.service.snapshot(user.id, id) }
  @Post("matches/:matchId/start") start(@Param("matchId", ParseUUIDPipe) id: string, @CurrentUser() user: UserResponseDto) { return this.service.start(user.id, id) }
  @Post("matches/:matchId/actions/play") play(@Param("matchId", ParseUUIDPipe) id: string, @CurrentUser() user: UserResponseDto, @Body() dto: DominoPlayTileDto) { return this.service.play(user.id, id, dto) }
  @Post("matches/:matchId/actions/draw") draw(@Param("matchId", ParseUUIDPipe) id: string, @CurrentUser() user: UserResponseDto, @Body() dto: DominoActionDto) { return this.service.draw(user.id, id, dto) }
  @Post("matches/:matchId/actions/pass") pass(@Param("matchId", ParseUUIDPipe) id: string, @CurrentUser() user: UserResponseDto, @Body() dto: DominoActionDto) { return this.service.pass(user.id, id, dto) }
  @Post("matches/:matchId/heartbeat") heartbeat(@Param("matchId", ParseUUIDPipe) id: string, @CurrentUser() user: UserResponseDto) { return this.service.snapshot(user.id, id) }
  @Post("matches/:matchId/reconcile") reconcile(@Param("matchId", ParseUUIDPipe) id: string, @CurrentUser() user: UserResponseDto) { return this.service.snapshot(user.id, id) }
  @Post("matches/:matchId/forfeit") forfeit(@Param("matchId", ParseUUIDPipe) id: string, @CurrentUser() user: UserResponseDto) { return this.service.forfeit(user.id, id) }
  @Get("matches/:matchId/results") results(@Param("matchId", ParseUUIDPipe) id: string, @CurrentUser() user: UserResponseDto) { return this.service.results(user.id, id) }
}
