import { Body, Controller, Get, Param, ParseUUIDPipe, Patch } from "@nestjs/common"
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger"

import { CurrentUser } from "../../common/decorators/current-user.decorator"
import { UserResponseDto } from "../auth/dtos/user-response.dto"
import { PlayerResponseDto, PublicPlayerResponseDto, UpdateProfileDto } from "./dtos"
import { PlayersService } from "./players.service"
import { ProgressionService } from "../progression/progression.service"

@ApiTags("Players")
@ApiBearerAuth("access-token")
@Controller("players")
export class PlayersController {
  constructor(private readonly playersService: PlayersService, private readonly progressionService: ProgressionService) {}

  @Get("me")
  @ApiOperation({ summary: "Get the authenticated player's profile and stats" })
  me(@CurrentUser() user: UserResponseDto): Promise<PlayerResponseDto> {
    return this.playersService.findById(user.id)
  }

  @Get("me/progressions")
  @ApiOperation({ summary: "Get all current progressions for the authenticated player" })
  progressions(@CurrentUser() user: UserResponseDto) { return this.progressionService.getForPlayer(user.id) }

  @Get("me/progressions/:key")
  @ApiOperation({ summary: "Get one current progression for the authenticated player" })
  progression(@CurrentUser() user: UserResponseDto, @Param("key") key: string) { return this.progressionService.getPlayerProgression(user.id, key) }

  @Patch("me")
  @ApiOperation({ summary: "Update user-controlled player profile fields" })
  updateMe(@CurrentUser() user: UserResponseDto, @Body() dto: UpdateProfileDto): Promise<PlayerResponseDto> {
    return this.playersService.updatePublicProfile(user.id, dto)
  }

  @Get(":userId")
  @ApiOperation({ summary: "Get a public player profile" })
  publicProfile(@Param("userId", new ParseUUIDPipe()) userId: string): Promise<PublicPlayerResponseDto> {
    return this.playersService.findPublicProfile(userId)
  }
}
