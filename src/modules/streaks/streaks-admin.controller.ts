import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from "@nestjs/common"
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger"
import { SystemAdminGuard } from "../system-admin/system-admin.guard"
import { CreateStreakMilestoneDto, UpdateStreakConfigurationDto, UpdateStreakMilestoneDto } from "./dtos"
import { StreaksService } from "./streaks.service"

@ApiTags("System admin daily streaks")
@ApiBearerAuth("access-token")
@UseGuards(SystemAdminGuard)
@Controller("system-admin/api/streaks")
export class StreaksAdminController {
  constructor(private readonly streaks: StreaksService) {}
  @Get("configuration") configuration() { return this.streaks.getConfiguration() }
  @Patch("configuration") updateConfiguration(@Body() dto: UpdateStreakConfigurationDto) { return this.streaks.updateConfiguration(dto) }
  @Post("milestones") createMilestone(@Body() dto: CreateStreakMilestoneDto) { return this.streaks.createMilestone(dto) }
  @Patch("milestones/:id") updateMilestone(@Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateStreakMilestoneDto) { return this.streaks.updateMilestone(id, dto) }
  @Delete("milestones/:id") deleteMilestone(@Param("id", ParseUUIDPipe) id: string) { return this.streaks.deleteMilestone(id) }
}
