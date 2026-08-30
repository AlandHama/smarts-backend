import { Controller, Get, Param, Query } from "@nestjs/common"
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger"

import { CurrentUser } from "../../common/decorators/current-user.decorator"
import { UserResponseDto } from "../auth/dtos/user-response.dto"
import { ProgressionService } from "./progression.service"

@ApiTags("Progression")
@ApiBearerAuth("access-token")
@Controller("progressions")
export class ProgressionController {
  constructor(private readonly progressionService: ProgressionService) {}

  @Get()
  @ApiOperation({ summary: "List active progression definitions" })
  definitions() { return this.progressionService.listDefinitions(false) }

  @Get("me")
  @ApiOperation({ summary: "Get all active progressions for the authenticated player" })
  me(@CurrentUser() user: UserResponseDto) { return this.progressionService.getForPlayer(user.id) }

  @Get(":key/tiers")
  @ApiOperation({ summary: "Get a paginated progression tier definition with rewards" })
  tiers(@Param("key") key: string, @Query("limit") limit?: string, @Query("offset") offset?: string) {
    return this.progressionService.getTiers(key, limit ? Number(limit) : 25, offset ? Number(offset) : 0)
  }

  @Get(":key")
  @ApiOperation({ summary: "Get one active progression for the authenticated player" })
  playerProgression(@CurrentUser() user: UserResponseDto, @Param("key") key: string) { return this.progressionService.getPlayerProgression(user.id, key) }
}
