import { Body, ConflictException, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from "@nestjs/common"
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger"

import { SystemAdminGuard } from "../system-admin/system-admin.guard"
import { CreateRankingConfigDto, UpdateRankingConfigDto } from "./dtos"
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

  @Post("configs")
  create(@Body() dto: CreateRankingConfigDto) { return this.ranking.createConfig(dto) }

  @Patch("configs/:id")
  update(@Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateRankingConfigDto) { return this.ranking.updateConfig(id, dto) }

  @Delete("configs/:id")
  async remove(@Param("id", ParseUUIDPipe) id: string) {
    try {
      return await this.ranking.deleteConfig(id)
    } catch (error) {
      if (error instanceof ConflictException) throw error
      throw error
    }
  }

  @Get("history")
  history(@Query("limit") limit?: string) { return this.ranking.history(Number(limit) || 100) }
}
