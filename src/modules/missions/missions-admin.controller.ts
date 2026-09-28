import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from "@nestjs/common"
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger"

import { CurrentUser } from "../../common/decorators/current-user.decorator"
import { UserResponseDto } from "../auth/dtos/user-response.dto"
import { SystemAdminGuard } from "../system-admin/system-admin.guard"
import { CreateAchievementDto, CreateAchievementTierDto, CreateMissionDto, UpdateAchievementDto, UpdateAchievementTierDto, UpdateMissionDto } from "./dtos"
import { MissionsService } from "./missions.service"

@ApiTags("System admin missions and achievements")
@ApiBearerAuth("access-token")
@UseGuards(SystemAdminGuard)
@Controller("system-admin/api")
export class MissionsAdminController {
  constructor(private readonly missions: MissionsService) {}

  @Get("missions")
  listMissions(@Query("includeInactive") includeInactive?: string) { return this.missions.listMissionDefinitions(includeInactive === "true") }
  @Post("missions")
  createMission(@Body() dto: CreateMissionDto, @CurrentUser() _admin: UserResponseDto) { return this.missions.createMission(dto) }
  @Patch("missions/:id")
  updateMission(@Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateMissionDto) { return this.missions.updateMission(id, dto) }
  @Delete("missions/:id")
  deleteMission(@Param("id", ParseUUIDPipe) id: string) { return this.missions.deleteMission(id) }

  @Get("achievements")
  listAchievements(@Query("includeInactive") includeInactive?: string) { return this.missions.listAchievementDefinitions(includeInactive === "true") }
  @Post("achievements")
  createAchievement(@Body() dto: CreateAchievementDto) { return this.missions.createAchievement(dto) }
  @Patch("achievements/:id")
  updateAchievement(@Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateAchievementDto) { return this.missions.updateAchievement(id, dto) }
  @Delete("achievements/:id")
  deleteAchievement(@Param("id", ParseUUIDPipe) id: string) { return this.missions.deleteAchievement(id) }
  @Post("achievements/:id/tiers")
  createTier(@Param("id", ParseUUIDPipe) id: string, @Body() dto: CreateAchievementTierDto) { return this.missions.createTier(id, dto) }
  @Patch("achievement-tiers/:id")
  updateTier(@Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateAchievementTierDto) { return this.missions.updateTier(id, dto) }
  @Delete("achievement-tiers/:id")
  deleteTier(@Param("id", ParseUUIDPipe) id: string) { return this.missions.deleteTier(id) }
}
