import { Controller, Get, Query } from "@nestjs/common"
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger"

import { GldService } from "./gld.service"

@ApiTags("GLD economy")
@ApiBearerAuth("access-token")
@Controller("gld")
export class GldController {
  constructor(private readonly gld: GldService) {}

  @Get()
  @ApiOperation({ summary: "Get the public server-owned GLD market state" })
  state() { return this.gld.getPublicState() }

  @Get("history")
  @ApiOperation({ summary: "Get public GLD value history" })
  history(@Query("days") days?: string, @Query("period") period?: string, @Query("granularity") granularity?: string, @Query("range") range?: string) {
    const value = days ?? period?.replace(/\D/g, "") ?? "30"
    return this.gld.getHistory(Number(value), granularity, range)
  }
}
