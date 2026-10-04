import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from "@nestjs/common"
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger"
import { SystemAdminGuard } from "../system-admin/system-admin.guard"
import { CreateWinStreakMilestoneDto, UpdateWinStreakConfigurationDto, UpdateWinStreakMilestoneDto } from "./dtos"
import { WinStreaksService } from "./win-streaks.service"

@ApiTags("System admin win streaks")
@ApiBearerAuth("access-token")
@UseGuards(SystemAdminGuard)
@Controller("system-admin/api/win-streaks")
export class WinStreaksAdminController {
  constructor(private readonly winStreaks: WinStreaksService) {}
  @Get("configuration") configuration() { return this.winStreaks.getConfiguration() }
  @Patch("configuration") updateConfiguration(@Body() dto: UpdateWinStreakConfigurationDto) { return this.winStreaks.updateConfiguration(dto) }
  @Post("milestones") createMilestone(@Body() dto: CreateWinStreakMilestoneDto) { return this.winStreaks.createMilestone(dto) }
  @Patch("milestones/:id") updateMilestone(@Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateWinStreakMilestoneDto) { return this.winStreaks.updateMilestone(id, dto) }
  @Delete("milestones/:id") deleteMilestone(@Param("id", ParseUUIDPipe) id: string) { return this.winStreaks.deleteMilestone(id) }
}
