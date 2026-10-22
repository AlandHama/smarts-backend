import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from "@nestjs/common"
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger"

import { CurrentUser } from "../../common/decorators/current-user.decorator"
import { UserResponseDto } from "../auth/dtos/user-response.dto"
import { AllyService } from "./ally.service"
import { CreateAllyDto, JoinAllyDto } from "./dtos"

@ApiTags("Allies")
@ApiBearerAuth("access-token")
@Controller("allies")
export class AllyController {
  constructor(private readonly allies: AllyService) {}

  @Get("me") me(@CurrentUser() user: UserResponseDto) { return this.allies.me(user.id) }
  @Get("leaderboard") leaderboard() { return this.allies.leaderboard() }
  @Post() create(@CurrentUser() user: UserResponseDto, @Body() dto: CreateAllyDto) { return this.allies.create(user.id, dto) }
  @Post("leave") leave(@CurrentUser() user: UserResponseDto) { return this.allies.leave(user.id) }
  @Post("join") joinByTag(@CurrentUser() user: UserResponseDto, @Body() dto: JoinAllyDto) { return this.allies.joinByTag(user.id, dto.tag) }
  @Post(":allyId/join") join(@CurrentUser() user: UserResponseDto, @Param("allyId", ParseUUIDPipe) allyId: string) { return this.allies.join(user.id, allyId) }
}
