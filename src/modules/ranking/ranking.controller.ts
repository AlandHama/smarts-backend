import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query, UseGuards } from "@nestjs/common"
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger"

import { SystemAdminGuard } from "../system-admin/system-admin.guard"
import { UpdateRankingConfigDto } from "./dtos"
import { RankingService } from "./ranking.service"

@ApiTags("Ranking matches")
@ApiBearerAuth("access-token")
@Controller("ranking-matches")
export class RankingController {
  constructor(private readonly ranking: RankingService) {}

  @Get("configs")
  configs() { return this.ranking.listConfigs(false) }
}

@ApiTags("System Admin ranking matches")
@ApiBearerAuth("access-token")
@Controller("system-admin/api/ranking")
@UseGuards(SystemAdminGuard)
export class RankingAdminController {
  constructor(private readonly ranking: RankingService) {}

  @Get("configs")
  configs() { return this.ranking.listConfigs(true) }

  @Patch("configs/:id")
  update(@Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateRankingConfigDto) { return this.ranking.updateConfig(id, dto) }

  @Get("history")
  history(@Query("limit") limit?: string) { return this.ranking.history(Number(limit) || 100) }
}
