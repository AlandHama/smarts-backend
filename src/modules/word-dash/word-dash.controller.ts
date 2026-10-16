import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from "@nestjs/common"
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger"
import { CurrentUser } from "../../common/decorators/current-user.decorator"
import { UserResponseDto } from "../auth/dtos/user-response.dto"
import { WordDashSubmissionDto } from "./dtos/word-dash.dto"
import { WordDashService } from "./word-dash.service"

@ApiTags("Word Dash")
@ApiBearerAuth("access-token")
@Controller("word-dash")
export class WordDashController {
  constructor(private readonly service: WordDashService) {}

  @Get("matches/:matchId")
  snapshot(@Param("matchId", ParseUUIDPipe) matchId: string, @CurrentUser() user: UserResponseDto) { return this.service.snapshot(user.id, matchId) }

  @Post("matches/:matchId/start")
  start(@Param("matchId", ParseUUIDPipe) matchId: string, @CurrentUser() user: UserResponseDto) { return this.service.start(user.id, matchId) }

  @Post("matches/:matchId/submissions")
  submit(@Param("matchId", ParseUUIDPipe) matchId: string, @CurrentUser() user: UserResponseDto, @Body() dto: WordDashSubmissionDto) { return this.service.submit(user.id, matchId, dto) }

  @Post("matches/:matchId/reconcile")
  reconcile(@Param("matchId", ParseUUIDPipe) matchId: string, @CurrentUser() user: UserResponseDto) { return this.service.snapshot(user.id, matchId) }

  @Post("matches/:matchId/forfeit")
  forfeit(@Param("matchId", ParseUUIDPipe) matchId: string, @CurrentUser() user: UserResponseDto) { return this.service.forfeit(user.id, matchId) }
}
