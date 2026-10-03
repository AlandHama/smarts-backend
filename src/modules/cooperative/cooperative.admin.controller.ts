import { Body, Controller, Get, Param, Post, Put, Query, UseGuards } from "@nestjs/common"
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger"

import { CurrentUser } from "../../common/decorators/current-user.decorator"
import { UserResponseDto } from "../auth/dtos/user-response.dto"
import { SystemAdminGuard } from "../system-admin/system-admin.guard"
import { CooperativePolicyDto } from "./dtos"
import { CooperativeService } from "./cooperative.service"
import { CooperativeMatchService } from "./cooperative-match.service"

@ApiTags("System Admin cooperative matches")
@ApiBearerAuth("access-token")
@UseGuards(SystemAdminGuard)
@Controller("system-admin/api/cooperative")
export class CooperativeAdminController {
  constructor(private readonly cooperative: CooperativeService, private readonly matches: CooperativeMatchService) {}

  @Get("policy") policy() { return this.cooperative.policy() }
  @Put("policy") update(@Body() dto: CooperativePolicyDto, @CurrentUser() admin: UserResponseDto) { return this.cooperative.updatePolicy(dto, admin.id) }
  @Get("overview") overview() { return this.cooperative.overview() }
  @Get("matches") matchesList(@Query("status") status?: string, @Query("limit") limit?: string) { return this.matches.adminMatches({ status, limit: limit ? Number(limit) : undefined }) }
  @Get("settlements") settlements(@Query("status") status?: string, @Query("mode") mode?: string, @Query("limit") limit?: string) { return this.cooperative.settlements({ status, mode, limit: limit ? Number(limit) : undefined }) }
  @Get("metrics") metrics(@Query("from") from?: string, @Query("to") to?: string) { return this.cooperative.metrics(from, to) }
  @Get("export") export(@Query("from") from?: string, @Query("to") to?: string, @Query("mode") mode?: string) { return this.cooperative.exportHistory(from, to, mode) }
  @Get("alerts") alerts() { return this.cooperative.operationalAlerts() }
  @Post("settlements/:matchId/retry") retry(@Param("matchId") matchId: string, @CurrentUser() admin: UserResponseDto) { return this.cooperative.retrySettlement(matchId, admin.id) }
  @Post("settlements/:matchId/review") review(@Param("matchId") matchId: string, @Body() body: { reason?: string }, @CurrentUser() admin: UserResponseDto) { return this.cooperative.flagSettlementReview(matchId, admin.id, body.reason || "Administrator requested cooperative settlement review") }
}
