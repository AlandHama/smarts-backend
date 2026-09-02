import { Controller, Get, Param } from "@nestjs/common"
import { ApiOperation, ApiTags } from "@nestjs/swagger"

import { GameService } from "./game.service"

@ApiTags("Games")
@Controller("game-definitions")
export class GameController {
  constructor(private readonly gameService: GameService) {}

  @Get()
  @ApiOperation({ summary: "List active game definitions and safe configuration" })
  definitions() { return this.gameService.listDefinitions(false) }

  @Get(":key")
  definition(@Param("key") key: string) { return this.gameService.getDefinition(key) }

}
