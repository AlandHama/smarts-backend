import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from "@nestjs/common"
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger"
import { CurrentUser } from "../../common/decorators/current-user.decorator"
import { UserResponseDto } from "../auth/dtos/user-response.dto"
import { SystemAdminGuard } from "../system-admin/system-admin.guard"
import { FraudService } from "./fraud.service"
import { FraudActionDto, FraudProfilesQueryDto, UpdateFraudRuleDto } from "./dtos"

@ApiTags("System admin fraud")
@ApiBearerAuth("access-token")
@UseGuards(SystemAdminGuard)
@Controller("system-admin/api/fraud")
export class FraudAdminController {
  constructor(private readonly fraud: FraudService) {}

  @Get("summary") summary() { return this.fraud.summary() }
  @Get("profiles") profiles(@Query() query: FraudProfilesQueryDto) { return this.fraud.listProfiles(query) }
  @Get("profiles/:userId") profile(@Param("userId", ParseUUIDPipe) userId: string) { return this.fraud.detail(userId) }
  @Post("profiles/:userId/recalculate") recalculate(@Param("userId", ParseUUIDPipe) userId: string) { return this.fraud.recalculate(userId) }
  @Post("profiles/:userId/actions") action(@Param("userId", ParseUUIDPipe) userId: string, @Body() dto: FraudActionDto, @CurrentUser() admin: UserResponseDto) { return this.fraud.action(userId, dto, admin.id) }
  @Post("profiles/:userId/cases/:caseId/actions") caseAction(@Param("userId", ParseUUIDPipe) userId: string, @Param("caseId", ParseUUIDPipe) caseId: string, @Body() dto: FraudActionDto, @CurrentUser() admin: UserResponseDto) { return this.fraud.action(userId, dto, admin.id, caseId) }
  @Get("rules") rules() { return this.fraud.listRules() }
  @Patch("rules/:id") updateRule(@Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateFraudRuleDto, @CurrentUser() admin: UserResponseDto) { return this.fraud.updateRule(id, dto, admin.id) }
}
