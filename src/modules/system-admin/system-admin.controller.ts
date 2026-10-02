import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";

import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { SkipAuth } from "../../common/decorators/skip-auth.decorator";
import { UserResponseDto } from "../auth/dtos/user-response.dto";
import { SystemAdminGuard } from "./system-admin.guard";
import { SystemAdminService } from "./system-admin.service";
import { RegisterRequestDto } from "../auth/dtos/register-request.dto";
import {
  PlayerAuditsQueryDto,
  RegisterAdminDto,
  ResetUserPasswordDto,
  SystemAdminAnalyticsQueryDto,
  SystemAdminLoginDto,
  SystemAdminMatchesQueryDto,
  SystemAdminSessionsQueryDto,
  SystemAdminUsersQueryDto,
  UpdateUserProfileDto,
  UpdateUserStatusDto,
  CreateSocialGiftDto,
  UpdateSocialGiftDto,
} from "./dtos";
import {
  AwardProgressionPointsDto,
  CreateProgressionDto,
  CreateProgressionRewardDto,
  CreateProgressionTierDto,
  ResetProgressionDto,
  UpdateProgressionDto,
  UpdateProgressionRewardDto,
  UpdateProgressionTierDto,
} from "../progression/dtos";
import {
  CreateCurrencyDto,
  ReverseWalletDto,
  UpdateCurrencyDto,
  WalletMutationDto,
} from "../economy/dtos";
import {
  ApplyLeaderboardScoreDto,
  CreateLeaderboardDto,
  CreateLeaderboardSeasonDto,
  UpdateLeaderboardDto,
} from "../leaderboard/dtos";
import { CreateGameContentDto, ImportGameContentDto, UpdateGameConfigDto } from "../game/dtos";
import {
  BulkRedeemCodeDto,
  CreateAssetDto,
  CreateCatalogDto,
  CreateCatalogItemDto,
  InventoryMutationDto,
  InventoryQueryDto,
  PaidRewardDecisionDto,
  UpdateAssetDto,
  UpdateCatalogDto,
  UpdateCatalogItemDto,
} from "../commerce/dtos";
import {
  FeedbackQueryDto,
  SystemAdminStorageQueryDto,
  UpdateFeedbackDto,
  UpdatePlayerStorageDto,
  UploadFileDto,
} from "../storage/dtos";
import type { UploadedImage } from "../storage/types";
import { AdminFriendsQueryDto } from "../friends/dtos/friends.dto";
import { PublishRewardPolicyDto } from "../config/dtos/reward-policy.dto";
import { UpdateAppConfigurationDto } from "../config/dtos/update-app-configuration.dto";
import { ConfigService } from "../config/config.service";
import { RefreshTokenRequestDto } from "../auth/dtos/refresh-token-request.dto";
import { TokenService } from "../auth/services/token.service";
import { AdMobService } from "../admob/admob.service";
import { AdMobReportQueryDto } from "../admob/dtos/admob.dto";
import { GldService } from "../gld/gld.service";
import { GldRevenueService } from "../gld/gld.revenue.service";
import { GldReconciliationService } from "../gld/gld.reconciliation.service";
import { UpdateGldControlsDto } from "../gld/dtos/gld-admin.dto";
import { GldSimulationDto } from "../gld/dtos/gld-simulation.dto";
import { GldManualBackingDto } from "../gld/dtos/gld-manual-backing.dto";
import { UpsertGldAdRewardPolicyDto } from "../gld/dtos/gld-ad-reward-policy.dto";
import {
  UpdateReferralConfigDto,
  UpdateReferralPlayerOverrideDto,
} from "../referrals/dtos";
import { UpdateGoogleAuthConfigDto } from "../auth/dtos/google-auth.dto";
import { GoogleAuthService } from "../auth/services/google-auth.service";
import { PlayerAuditActorType } from "@prisma/client";
import { NotificationsService } from "../notifications/notifications.service";
import { SendGlobalNotificationDto } from "../notifications/dtos";
import { AnalyticsReportingService } from "./analytics-reporting.service";
import { AnalyticsAlertRuleDto, AnalyticsPlayerExplorerQueryDto, AnalyticsSavedReportDto, AnalyticsScheduledReportDto } from "./dtos/analytics-report.dto";

@ApiTags("System Admin")
@Controller("system-admin")
export class SystemAdminController {
  constructor(
    private readonly systemAdminService: SystemAdminService,
    private readonly tokenService: TokenService,
    private readonly adMobService: AdMobService,
    private readonly gldService: GldService,
    private readonly gldRevenueService: GldRevenueService,
    private readonly gldReconciliationService: GldReconciliationService,
    private readonly googleAuthService: GoogleAuthService,
    private readonly notificationsService: NotificationsService,
    private readonly configService: ConfigService,
    private readonly analyticsReportingService: AnalyticsReportingService,
  ) {}

  @UseGuards(SystemAdminGuard)
  @Post("api/uploads")
  @ApiBearerAuth("access-token")
  @UseInterceptors(
    FileInterceptor("file", { limits: { fileSize: 10 * 1024 * 1024 } }),
  )
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        file: { type: "string", format: "binary" },
        purpose: { type: "string" },
        visibility: { type: "string", enum: ["PUBLIC", "PRIVATE"] },
      },
      required: ["file", "purpose"],
    },
  })
  uploadFile(
    @UploadedFile() file: UploadedImage,
    @Body() dto: UploadFileDto,
    @CurrentUser() admin: UserResponseDto,
  ) {
    return this.systemAdminService.uploadFile(file, dto, admin.id);
  }

  @UseGuards(SystemAdminGuard)
  @Get("api/files/:fileId/url")
  @ApiBearerAuth("access-token")
  getFileUrl(@Param("fileId", ParseUUIDPipe) fileId: string) {
    return this.systemAdminService.fileUrl(fileId).then((url) => ({ url }));
  }

  @UseGuards(SystemAdminGuard)
  @Delete("api/files/:fileId")
  @ApiBearerAuth("access-token")
  deleteFile(
    @Param("fileId", ParseUUIDPipe) fileId: string,
    @CurrentUser() admin: UserResponseDto,
  ) {
    return this.systemAdminService.deleteFile(fileId, admin.id);
  }

  @UseGuards(SystemAdminGuard)
  @Get("api/storage")
  @ApiBearerAuth("access-token")
  @ApiOperation({ summary: "List player storage entries and uploaded files" })
  listStorage(@Query() query: SystemAdminStorageQueryDto) {
    return this.systemAdminService.listStorage(query);
  }

  @UseGuards(SystemAdminGuard)
  @Get("api/friends")
  @ApiBearerAuth("access-token")
  @ApiOperation({ summary: "List friendships, requests, and online presence" })
  listFriends(@Query() query: AdminFriendsQueryDto) {
    return this.systemAdminService.listFriends(query);
  }

  @UseGuards(SystemAdminGuard)
  @Get("api/referrals")
  @ApiBearerAuth("access-token")
  @ApiOperation({
    summary: "Inspect referral configuration, attribution, and rewards",
  })
  listReferrals(@Query("search") search?: string) {
    return this.systemAdminService.listReferrals(search);
  }

  @UseGuards(SystemAdminGuard)
  @Patch("api/referrals/config")
  @ApiBearerAuth("access-token")
  @ApiOperation({ summary: "Update the server-owned referral policy" })
  updateReferralConfig(
    @Body() dto: UpdateReferralConfigDto,
    @CurrentUser() admin: UserResponseDto,
  ) {
    return this.systemAdminService.updateReferralConfig(dto, admin.id);
  }

  @UseGuards(SystemAdminGuard)
  @Patch("api/referrals/players/:userId")
  @ApiBearerAuth("access-token")
  @ApiOperation({
    summary: "Update or clear a player's referral policy override",
  })
  updateReferralPlayerOverride(
    @Param("userId", ParseUUIDPipe) userId: string,
    @Body() dto: UpdateReferralPlayerOverrideDto,
    @CurrentUser() admin: UserResponseDto,
  ) {
    return this.systemAdminService.updateReferralPlayerOverride(
      userId,
      dto,
      admin.id,
    );
  }

  @UseGuards(SystemAdminGuard)
  @Post("api/friends/:userId/:friendId")
  @ApiBearerAuth("access-token")
  @ApiOperation({
    summary: "Create an accepted friendship between two players",
  })
  makeFriends(
    @Param("userId", ParseUUIDPipe) userId: string,
    @Param("friendId", ParseUUIDPipe) friendId: string,
  ) {
    return this.systemAdminService.makeFriends(userId, friendId);
  }

  @UseGuards(SystemAdminGuard)
  @Delete("api/friends/:userId/:friendId")
  @ApiBearerAuth("access-token")
  removeFriend(
    @Param("userId", ParseUUIDPipe) userId: string,
    @Param("friendId", ParseUUIDPipe) friendId: string,
  ) {
    return this.systemAdminService.removeFriend(userId, friendId);
  }

  @UseGuards(SystemAdminGuard)
  @Post("api/friends/:userId/:friendId/block")
  @ApiBearerAuth("access-token")
  blockFriend(
    @Param("userId", ParseUUIDPipe) userId: string,
    @Param("friendId", ParseUUIDPipe) friendId: string,
  ) {
    return this.systemAdminService.blockFriend(userId, friendId);
  }

  @UseGuards(SystemAdminGuard)
  @Delete("api/friends/:userId/:friendId/block")
  @ApiBearerAuth("access-token")
  unblockFriend(
    @Param("userId", ParseUUIDPipe) userId: string,
    @Param("friendId", ParseUUIDPipe) friendId: string,
  ) {
    return this.systemAdminService.unblockFriend(userId, friendId);
  }

  @UseGuards(SystemAdminGuard)
  @Get("api/feedback")
  @ApiBearerAuth("access-token")
  listFeedback(@Query() query: FeedbackQueryDto) {
    return this.systemAdminService.listFeedback(query);
  }

  @UseGuards(SystemAdminGuard)
  @Patch("api/feedback/:feedbackId")
  @ApiBearerAuth("access-token")
  updateFeedback(
    @Param("feedbackId", ParseUUIDPipe) feedbackId: string,
    @Body() dto: UpdateFeedbackDto,
    @CurrentUser() admin: UserResponseDto,
  ) {
    return this.systemAdminService.updateFeedback(feedbackId, dto, admin.id);
  }

  @SkipAuth()
  @Post("api/auth/login")
  @HttpCode(200)
  @ApiOperation({ summary: "Sign in to the system administrator console" })
  login(@Body() dto: SystemAdminLoginDto, @Req() request: any) {
    return this.systemAdminService.login(dto, request);
  }

  @SkipAuth()
  @Post("api/auth/refresh")
  @HttpCode(200)
  @ApiOperation({
    summary: "Rotate a system administrator console refresh token",
  })
  refresh(@Body() dto: RefreshTokenRequestDto, @Req() request: any) {
    return this.tokenService.generateRefreshToken(
      dto.refreshToken,
      request,
      false,
    );
  }

  @UseGuards(SystemAdminGuard)
  @Get("api/overview")
  @ApiBearerAuth("access-token")
  @ApiOperation({ summary: "Get system administrator dashboard counts" })
  overview() {
    return this.systemAdminService.overview();
  }

  @UseGuards(SystemAdminGuard)
  @Get("api/analytics")
  @ApiBearerAuth("access-token")
  @ApiOperation({
    summary:
      "Get server-owned SMARTS engagement, retention, gameplay, progression, economy, and reliability analytics",
  })
  analytics(@Query() query: SystemAdminAnalyticsQueryDto, @CurrentUser() admin: UserResponseDto) {
    return this.systemAdminService.analytics(query, admin.id);
  }

  @UseGuards(SystemAdminGuard)
  @Get("api/analytics/export.csv")
  @ApiBearerAuth("access-token")
  @ApiOperation({ summary: "Export the filtered analytics overview as CSV" })
  async analyticsCsv(@Query() query: SystemAdminAnalyticsQueryDto, @CurrentUser() admin: UserResponseDto, @Res() response: any) {
    const csv = await this.systemAdminService.analyticsCsv(query, admin.id);
    response.setHeader("Content-Type", "text/csv; charset=utf-8");
    response.setHeader("Content-Disposition", `attachment; filename="smarts-analytics-${new Date().toISOString().slice(0, 10)}.csv"`);
    return response.send(csv);
  }

  @UseGuards(SystemAdminGuard)
  @Get("api/analytics/reports/:key")
  @ApiBearerAuth("access-token")
  featureAnalytics(@Param("key") key: string, @Query() query: SystemAdminAnalyticsQueryDto, @CurrentUser() admin: UserResponseDto) {
    return this.analyticsReportingService.report(key, query, admin.id)
  }

  @UseGuards(SystemAdminGuard)
  @Get("api/analytics/player-explorer")
  @ApiBearerAuth("access-token")
  playerExplorer(@Query() query: AnalyticsPlayerExplorerQueryDto, @CurrentUser() admin: UserResponseDto) {
    return this.analyticsReportingService.playerExplorer(query, admin.id)
  }

  @UseGuards(SystemAdminGuard)
  @Get("api/analytics/data-quality")
  @ApiBearerAuth("access-token")
  dataQuality() { return this.analyticsReportingService.quality() }

  @UseGuards(SystemAdminGuard)
  @Get("api/analytics/definitions")
  @ApiBearerAuth("access-token")
  analyticsDefinitions() { return this.analyticsReportingService.definitions() }

  @UseGuards(SystemAdminGuard)
  @Get("api/analytics/saved-reports")
  @ApiBearerAuth("access-token")
  savedReports(@CurrentUser() admin: UserResponseDto) { return this.analyticsReportingService.saved(admin.id) }

  @UseGuards(SystemAdminGuard)
  @Post("api/analytics/saved-reports")
  @ApiBearerAuth("access-token")
  createSavedReport(@Body() dto: AnalyticsSavedReportDto, @CurrentUser() admin: UserResponseDto) { return this.analyticsReportingService.save(dto, admin.id) }

  @UseGuards(SystemAdminGuard)
  @Patch("api/analytics/saved-reports/:id")
  @ApiBearerAuth("access-token")
  updateSavedReport(@Param("id", ParseUUIDPipe) id: string, @Body() dto: AnalyticsSavedReportDto, @CurrentUser() admin: UserResponseDto) { return this.analyticsReportingService.save(dto, admin.id, id) }

  @UseGuards(SystemAdminGuard)
  @Delete("api/analytics/saved-reports/:id")
  @ApiBearerAuth("access-token")
  deleteSavedReport(@Param("id", ParseUUIDPipe) id: string, @CurrentUser() admin: UserResponseDto) { return this.analyticsReportingService.removeSaved(id, admin.id) }

  @UseGuards(SystemAdminGuard)
  @Get("api/analytics/scheduled-reports")
  @ApiBearerAuth("access-token")
  scheduledReports(@CurrentUser() admin: UserResponseDto) { return this.analyticsReportingService.schedules(admin.id) }

  @UseGuards(SystemAdminGuard)
  @Post("api/analytics/scheduled-reports")
  @ApiBearerAuth("access-token")
  createScheduledReport(@Body() dto: AnalyticsScheduledReportDto, @CurrentUser() admin: UserResponseDto) { return this.analyticsReportingService.schedule(dto, admin.id) }

  @UseGuards(SystemAdminGuard)
  @Delete("api/analytics/scheduled-reports/:id")
  @ApiBearerAuth("access-token")
  deleteScheduledReport(@Param("id", ParseUUIDPipe) id: string, @CurrentUser() admin: UserResponseDto) { return this.analyticsReportingService.removeSchedule(id, admin.id) }

  @UseGuards(SystemAdminGuard)
  @Patch("api/analytics/scheduled-reports/:id")
  @ApiBearerAuth("access-token")
  updateScheduledReport(@Param("id", ParseUUIDPipe) id: string, @Body() dto: AnalyticsScheduledReportDto, @CurrentUser() admin: UserResponseDto) { return this.analyticsReportingService.updateSchedule(id, dto, admin.id) }

  @UseGuards(SystemAdminGuard)
  @Get("api/analytics/alerts")
  @ApiBearerAuth("access-token")
  analyticsAlerts() { return this.analyticsReportingService.alerts() }

  @UseGuards(SystemAdminGuard)
  @Post("api/analytics/alerts")
  @ApiBearerAuth("access-token")
  createAnalyticsAlert(@Body() dto: AnalyticsAlertRuleDto, @CurrentUser() admin: UserResponseDto) { return this.analyticsReportingService.saveAlert(dto, admin.id) }

  @UseGuards(SystemAdminGuard)
  @Patch("api/analytics/alerts/:id")
  @ApiBearerAuth("access-token")
  updateAnalyticsAlert(@Param("id", ParseUUIDPipe) id: string, @Body() dto: AnalyticsAlertRuleDto, @CurrentUser() admin: UserResponseDto) { return this.analyticsReportingService.saveAlert(dto, admin.id, id) }

  @UseGuards(SystemAdminGuard)
  @Post("api/analytics/alerts/events/:id/acknowledge")
  @ApiBearerAuth("access-token")
  acknowledgeAnalyticsAlert(@Param("id", ParseUUIDPipe) id: string, @CurrentUser() admin: UserResponseDto) { return this.analyticsReportingService.acknowledgeAlert(id, admin.id) }

  @UseGuards(SystemAdminGuard)
  @Post("api/analytics/exports")
  @ApiBearerAuth("access-token")
  createAnalyticsExport(@Body() body: { reportKey?: string; format?: string; query?: SystemAdminAnalyticsQueryDto }, @CurrentUser() admin: UserResponseDto) { return this.analyticsReportingService.createExport(body, admin.id) }

  @UseGuards(SystemAdminGuard)
  @Get("api/analytics/exports/:id")
  @ApiBearerAuth("access-token")
  getAnalyticsExport(@Param("id", ParseUUIDPipe) id: string, @CurrentUser() admin: UserResponseDto) { return this.analyticsReportingService.exportJob(id, admin.id) }

  @UseGuards(SystemAdminGuard)
  @Get("api/app-config")
  @ApiBearerAuth("access-token")
  @ApiOperation({ summary: "Read public mobile app configuration" })
  appConfiguration() {
    return this.configService.getAppUpdateConfig();
  }

  @UseGuards(SystemAdminGuard)
  @Put("api/app-config")
  @ApiBearerAuth("access-token")
  @ApiOperation({ summary: "Configure mobile app version policy" })
  updateAppConfiguration(@Body() dto: UpdateAppConfigurationDto) {
    return this.configService.updateAppConfiguration(dto);
  }

  @UseGuards(SystemAdminGuard)
  @Get("api/admob/connect")
  @ApiBearerAuth("access-token")
  @ApiOperation({
    summary: "Create the Google OAuth URL for the AdMob reporting account",
  })
  admobConnect(@CurrentUser() admin: UserResponseDto) {
    return this.adMobService.getAuthorizationUrl(admin.id);
  }

  @SkipAuth()
  @Get("api/admob/oauth/callback")
  @ApiOperation({
    summary: "Complete the Google OAuth callback for AdMob reporting",
  })
  async admobOAuthCallback(
    @Query("code") code: string,
    @Query("state") state: string,
    @Query("error") error: string | undefined,
    @Res() response: any,
  ) {
    try {
      await this.adMobService.handleCallback(code, state, error);
      return response.redirect("/system-admin/admob/?admob=connected");
    } catch (reason) {
      const message =
        reason instanceof Error ? reason.message : "AdMob authorization failed";
      return response.redirect(
        `/system-admin/admob/?admob=error&message=${encodeURIComponent(message)}`,
      );
    }
  }

  @UseGuards(SystemAdminGuard)
  @Get("api/admob")
  @ApiBearerAuth("access-token")
  @ApiOperation({
    summary:
      "Get synchronized AdMob connection, performance, and earnings analytics",
  })
  admob(@Query() query: AdMobReportQueryDto) {
    return this.adMobService.analytics(query.days);
  }

  @UseGuards(SystemAdminGuard)
  @Post("api/admob/sync")
  @ApiBearerAuth("access-token")
  @ApiOperation({ summary: "Synchronize recent AdMob network report rows" })
  admobSync(@Query() query: AdMobReportQueryDto) {
    return this.adMobService.sync(query.days);
  }

  @UseGuards(SystemAdminGuard)
  @Delete("api/admob")
  @ApiBearerAuth("access-token")
  @ApiOperation({ summary: "Disconnect the AdMob reporting account" })
  admobDisconnect() {
    return this.adMobService.disconnect();
  }

  @UseGuards(SystemAdminGuard)
  @Get("api/gld")
  @ApiBearerAuth("access-token")
  @ApiOperation({
    summary:
      "Inspect the GLD economy state, reserve, supply, emissions, and revenue snapshots",
  })
  gld() {
    return this.gldService.getAdminState();
  }

  @UseGuards(SystemAdminGuard)
  @Post("api/gld/recalculate")
  @ApiBearerAuth("access-token")
  @ApiOperation({
    summary: "Recalculate the GLD market value and daily emission budget",
  })
  gldRecalculate() {
    return this.gldService.recalculate("admin");
  }

  @UseGuards(SystemAdminGuard)
  @Get("api/gld/history")
  @ApiBearerAuth("access-token")
  @ApiOperation({
    summary: "Get GLD price history at minute, hour, or day granularity",
  })
  gldHistory(
    @Query("days") days?: string,
    @Query("granularity") granularity?: string,
    @Query("range") range?: string,
  ) {
    return this.gldService.getHistory(Number(days) || 30, granularity, range);
  }

  @UseGuards(SystemAdminGuard)
  @Post("api/gld/simulate")
  @ApiBearerAuth("access-token")
  @ApiOperation({
    summary:
      "Simulate a GLD price from reserve and circulating supply without changing the economy",
  })
  gldSimulate(@Body() dto: GldSimulationDto) {
    return this.gldService.simulate(dto);
  }

  @UseGuards(SystemAdminGuard)
  @Post("api/gld/backing")
  @ApiBearerAuth("access-token")
  @ApiOperation({
    summary: "Add audited administrator-supplied reserve backing to GLD",
  })
  async gldManualBacking(
    @Body() dto: GldManualBackingDto,
    @CurrentUser() admin: UserResponseDto,
  ) {
    const backing = await this.gldService.addManualBacking(dto, admin.id);
    return {
      backing,
      economy: await this.gldService.recalculate("manual-backing"),
    };
  }

  @UseGuards(SystemAdminGuard)
  @Post("api/gld/revenue/materialize")
  @ApiBearerAuth("access-token")
  @ApiOperation({
    summary: "Materialize mature AdMob earnings into the GLD treasury",
  })
  async gldMaterializeRevenue() {
    const materialized =
      await this.gldRevenueService.materializeMaturedAdMobRevenue();
    return {
      materialized,
      economy: await this.gldService.recalculate(
        "admin-revenue-materialization",
      ),
    };
  }

  @UseGuards(SystemAdminGuard)
  @Post("api/gld/reconcile")
  @ApiBearerAuth("access-token")
  @ApiOperation({
    summary: "Reconcile cached GLD supply against active wallet balances",
  })
  gldReconcile() {
    return this.gldReconciliationService.reconcile();
  }

  @UseGuards(SystemAdminGuard)
  @Patch("api/gld/controls")
  @ApiBearerAuth("access-token")
  @ApiOperation({ summary: "Update persisted GLD emergency controls" })
  gldControls(
    @Body() dto: UpdateGldControlsDto,
    @CurrentUser() admin: UserResponseDto,
  ) {
    return this.gldService.updateControls(dto, admin.id);
  }

  @UseGuards(SystemAdminGuard)
  @Get("api/gld/ad-reward-policies")
  @ApiBearerAuth("access-token")
  @ApiOperation({
    summary: "List GLD ad rewards by ad format, event, and country/region",
  })
  gldAdRewardPolicies() {
    return this.gldService.listAdRewardPolicies();
  }

  @UseGuards(SystemAdminGuard)
  @Put("api/gld/ad-reward-policies")
  @ApiBearerAuth("access-token")
  @ApiOperation({ summary: "Create or update a GLD ad reward policy" })
  gldAdRewardPolicy(
    @Body() dto: UpsertGldAdRewardPolicyDto,
    @CurrentUser() admin: UserResponseDto,
  ) {
    return this.gldService.upsertAdRewardPolicy(dto, admin.id);
  }

  @UseGuards(SystemAdminGuard)
  @Delete("api/gld/ad-reward-policies/:id")
  @ApiBearerAuth("access-token")
  @ApiOperation({ summary: "Delete a GLD ad reward policy" })
  gldAdRewardPolicyDelete(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() admin: UserResponseDto,
  ) {
    return this.gldService.deleteAdRewardPolicy(id, admin.id);
  }

  @UseGuards(SystemAdminGuard)
  @Get("api/operations")
  @ApiBearerAuth("access-token")
  @ApiOperation({
    summary:
      "Inspect operational health, queues, failures, ledgers, and recent audit events",
  })
  operations() {
    return this.systemAdminService.operations();
  }

  @UseGuards(SystemAdminGuard)
  @Get("api/audit")
  @ApiBearerAuth("access-token")
  @ApiOperation({ summary: "List immutable system administrator audit events" })
  audit(@Query("limit") limit?: string) {
    return this.systemAdminService.listAudit(limit ? Number(limit) : 100);
  }

  @UseGuards(SystemAdminGuard)
  @Get("api/player-audits")
  @ApiBearerAuth("access-token")
  @ApiOperation({
    summary: "List server-owned player activity history with filters",
  })
  playerAudits(@Query() query: PlayerAuditsQueryDto) {
    return this.systemAdminService.listPlayerAudits(query);
  }

  @UseGuards(SystemAdminGuard)
  @Get("api/users")
  @ApiBearerAuth("access-token")
  @ApiOperation({ summary: "List and search user accounts" })
  users(@Query() query: SystemAdminUsersQueryDto) {
    return this.systemAdminService.listUsers(query);
  }

  @UseGuards(SystemAdminGuard)
  @Post("api/users")
  @ApiBearerAuth("access-token")
  @ApiOperation({ summary: "Create a player account from the admin console" })
  createUser(
    @Body() dto: RegisterRequestDto,
    @CurrentUser() admin: UserResponseDto,
  ) {
    return this.systemAdminService.createUser(dto, admin.id);
  }

  @UseGuards(SystemAdminGuard)
  @Post("api/admins")
  @ApiBearerAuth("access-token")
  @ApiOperation({ summary: "Create an active system administrator account" })
  createAdmin(
    @Body() dto: RegisterAdminDto,
    @CurrentUser() admin: UserResponseDto,
  ) {
    return this.systemAdminService.createAdmin(dto, admin.id);
  }

  @UseGuards(SystemAdminGuard)
  @Get("api/sessions")
  @ApiBearerAuth("access-token")
  @ApiOperation({ summary: "List player and administrator session history" })
  sessions(@Query() query: SystemAdminSessionsQueryDto) {
    return this.systemAdminService.listSessions(query);
  }

  @UseGuards(SystemAdminGuard)
  @Delete("api/sessions/:sessionId")
  @ApiBearerAuth("access-token")
  @ApiOperation({
    summary: "Terminate an active player or administrator session",
  })
  terminateSession(
    @Param("sessionId", ParseUUIDPipe) sessionId: string,
    @CurrentUser() admin: UserResponseDto,
  ) {
    return this.systemAdminService.terminateSession(sessionId, admin.id);
  }

  @UseGuards(SystemAdminGuard)
  @Get("api/matches")
  @ApiBearerAuth("access-token")
  @ApiOperation({
    summary: "List match history for the system administrator console",
  })
  matches(@Query() query: SystemAdminMatchesQueryDto) {
    return this.systemAdminService.listMatches(query);
  }

  @UseGuards(SystemAdminGuard)
  @Get("api/matches/:matchId/360")
  @ApiBearerAuth("access-token")
  @ApiOperation({ summary: "Inspect a complete server-owned match timeline" })
  match360(@Param("matchId", ParseUUIDPipe) matchId: string) {
    return this.systemAdminService.getMatch360(matchId);
  }

  @UseGuards(SystemAdminGuard)
  @Get("api/users/:userId/360")
  @ApiBearerAuth("access-token")
  @ApiOperation({ summary: "View the complete Player 360 account workspace" })
  getPlayer360(@Param("userId", ParseUUIDPipe) userId: string) {
    return this.systemAdminService.getPlayer360(userId);
  }

  @UseGuards(SystemAdminGuard)
  @Delete("api/users/:userId/google-link")
  @ApiBearerAuth("access-token")
  @ApiOperation({ summary: "Unlink a player's Google identity" })
  unlinkPlayerGoogle(
    @Param("userId", ParseUUIDPipe) userId: string,
    @CurrentUser() admin: UserResponseDto,
  ) {
    return this.googleAuthService.unlink(userId, admin.id, PlayerAuditActorType.ADMIN);
  }

  @UseGuards(SystemAdminGuard)
  @Get("api/users/:userId/audits")
  @ApiBearerAuth("access-token")
  @ApiOperation({ summary: "List one player's complete activity history" })
  playerAuditsForUser(
    @Param("userId", ParseUUIDPipe) userId: string,
    @Query() query: PlayerAuditsQueryDto,
  ) {
    return this.systemAdminService.listPlayerAudits({
      ...query,
      playerId: userId,
    });
  }

  @UseGuards(SystemAdminGuard)
  @Post("api/users/:userId/game-stats/rebuild")
  @ApiBearerAuth("access-token")
  @ApiOperation({
    summary:
      "Rebuild one player's game statistics from settled matches and accepted answer events",
  })
  rebuildPlayerGameStats(
    @Param("userId", ParseUUIDPipe) userId: string,
    @Query("gameKey") gameKey: string,
  ) {
    return this.systemAdminService.rebuildPlayerGameStats(userId, gameKey);
  }

  @UseGuards(SystemAdminGuard)
  @Post("api/users/:userId/cognitive-stats/reset")
  @ApiBearerAuth("access-token")
  @ApiOperation({
    summary: "Reset one player's server-owned cognitive skill profile",
  })
  resetPlayerCognitiveStats(
    @Param("userId", ParseUUIDPipe) userId: string,
    @CurrentUser() admin: UserResponseDto,
  ) {
    return this.systemAdminService.resetPlayerCognitiveStats(userId, admin.id);
  }

  @UseGuards(SystemAdminGuard)
  @Get("api/users/:userId")
  @ApiBearerAuth("access-token")
  @ApiOperation({
    summary: "View a complete player account, wallet, and session summary",
  })
  getUser(@Param("userId", ParseUUIDPipe) userId: string) {
    return this.systemAdminService.getUserDetails(userId);
  }

  @UseGuards(SystemAdminGuard)
  @Patch("api/users/:userId/profile")
  @ApiBearerAuth("access-token")
  @ApiOperation({ summary: "Edit account and player profile settings" })
  updateProfile(
    @Param("userId", ParseUUIDPipe) userId: string,
    @CurrentUser() admin: UserResponseDto,
    @Body() dto: UpdateUserProfileDto,
  ) {
    return this.systemAdminService.updateUserProfile(userId, admin.id, dto);
  }

  @UseGuards(SystemAdminGuard)
  @Post("api/users/:userId/storage")
  @ApiBearerAuth("access-token")
  updatePlayerStorage(
    @Param("userId", ParseUUIDPipe) userId: string,
    @Body() dto: UpdatePlayerStorageDto,
  ) {
    return this.systemAdminService.updatePlayerStorage(userId, dto);
  }

  @UseGuards(SystemAdminGuard)
  @Delete("api/users/:userId/storage/:key")
  @ApiBearerAuth("access-token")
  deletePlayerStorage(
    @Param("userId", ParseUUIDPipe) userId: string,
    @Param("key") key: string,
  ) {
    return this.systemAdminService.deletePlayerStorage(userId, key);
  }

  @UseGuards(SystemAdminGuard)
  @Post("api/users/:userId/files")
  @ApiBearerAuth("access-token")
  @UseInterceptors(
    FileInterceptor("file", { limits: { fileSize: 10 * 1024 * 1024 } }),
  )
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        file: { type: "string", format: "binary" },
        purpose: { type: "string" },
        visibility: { type: "string", enum: ["PUBLIC", "PRIVATE"] },
      },
      required: ["file", "purpose"],
    },
  })
  uploadPlayerFile(
    @Param("userId", ParseUUIDPipe) userId: string,
    @UploadedFile() file: UploadedImage,
    @Body() dto: UploadFileDto,
    @CurrentUser() admin: UserResponseDto,
  ) {
    return this.systemAdminService.uploadPlayerFile(
      file,
      userId,
      dto,
      admin.id,
    );
  }

  @UseGuards(SystemAdminGuard)
  @Get("api/users/:userId/files/:fileId/url")
  @ApiBearerAuth("access-token")
  playerFileUrl(
    @Param("userId", ParseUUIDPipe) userId: string,
    @Param("fileId", ParseUUIDPipe) fileId: string,
  ) {
    return this.systemAdminService
      .playerFileUrl(fileId, userId)
      .then((url) => ({ url }));
  }

  @UseGuards(SystemAdminGuard)
  @Delete("api/users/:userId/files/:fileId")
  @ApiBearerAuth("access-token")
  deletePlayerFile(
    @Param("userId", ParseUUIDPipe) userId: string,
    @Param("fileId", ParseUUIDPipe) fileId: string,
    @CurrentUser() admin: UserResponseDto,
  ) {
    return this.systemAdminService.deletePlayerFile(fileId, userId, admin.id);
  }

  @UseGuards(SystemAdminGuard)
  @Post("api/users/:userId/reset-password")
  @ApiBearerAuth("access-token")
  @ApiOperation({
    summary: "Reset a player's password and terminate active sessions",
  })
  resetPassword(
    @Param("userId", ParseUUIDPipe) userId: string,
    @CurrentUser() admin: UserResponseDto,
    @Body() dto: ResetUserPasswordDto,
  ) {
    return this.systemAdminService.resetUserPassword(userId, admin.id, dto);
  }

  @UseGuards(SystemAdminGuard)
  @Patch("api/users/:userId/status")
  @ApiBearerAuth("access-token")
  @ApiOperation({ summary: "Activate, deactivate, or ban an account" })
  updateStatus(
    @Param("userId", ParseUUIDPipe) userId: string,
    @CurrentUser() admin: UserResponseDto,
    @Body() dto: UpdateUserStatusDto,
  ) {
    return this.systemAdminService.updateStatus(userId, admin.id, dto);
  }

  @UseGuards(SystemAdminGuard)
  @Delete("api/users/:userId")
  @ApiBearerAuth("access-token")
  @ApiOperation({ summary: "Permanently delete a user account" })
  deleteUser(
    @Param("userId", ParseUUIDPipe) userId: string,
    @CurrentUser() admin: UserResponseDto,
  ) {
    return this.systemAdminService.deleteUser(userId, admin.id);
  }

  @UseGuards(SystemAdminGuard)
  @Get("api/progressions")
  @ApiBearerAuth("access-token")
  @ApiOperation({
    summary: "List progression definitions, tiers, and configured rewards",
  })
  progressions(@Query("includeInactive") includeInactive?: string) {
    return this.systemAdminService.listProgressions(includeInactive === "true");
  }

  @UseGuards(SystemAdminGuard)
  @Post("api/progressions")
  @ApiBearerAuth("access-token")
  @ApiOperation({ summary: "Create a progression definition" })
  createProgression(@Body() dto: CreateProgressionDto) {
    return this.systemAdminService.createProgression(dto);
  }

  @UseGuards(SystemAdminGuard)
  @Get("api/progressions/:progressionId")
  @ApiBearerAuth("access-token")
  getProgression(@Param("progressionId", ParseUUIDPipe) progressionId: string) {
    return this.systemAdminService.getProgression(progressionId);
  }

  @UseGuards(SystemAdminGuard)
  @Patch("api/progressions/:progressionId")
  @ApiBearerAuth("access-token")
  updateProgression(
    @Param("progressionId", ParseUUIDPipe) progressionId: string,
    @Body() dto: UpdateProgressionDto,
  ) {
    return this.systemAdminService.updateProgression(progressionId, dto);
  }

  @UseGuards(SystemAdminGuard)
  @Post("api/progressions/:progressionId/tiers")
  @ApiBearerAuth("access-token")
  createProgressionTier(
    @Param("progressionId", ParseUUIDPipe) progressionId: string,
    @Body() dto: CreateProgressionTierDto,
  ) {
    return this.systemAdminService.createProgressionTier(progressionId, dto);
  }

  @UseGuards(SystemAdminGuard)
  @Patch("api/progression-tiers/:tierId")
  @ApiBearerAuth("access-token")
  updateProgressionTier(
    @Param("tierId", ParseUUIDPipe) tierId: string,
    @Body() dto: UpdateProgressionTierDto,
  ) {
    return this.systemAdminService.updateProgressionTier(tierId, dto);
  }

  @UseGuards(SystemAdminGuard)
  @Delete("api/progression-tiers/:tierId")
  @ApiBearerAuth("access-token")
  deleteProgressionTier(@Param("tierId", ParseUUIDPipe) tierId: string) {
    return this.systemAdminService.deleteProgressionTier(tierId);
  }

  @UseGuards(SystemAdminGuard)
  @Post("api/progression-tiers/:tierId/rewards")
  @ApiBearerAuth("access-token")
  createProgressionReward(
    @Param("tierId", ParseUUIDPipe) tierId: string,
    @Body() dto: CreateProgressionRewardDto,
  ) {
    return this.systemAdminService.createProgressionReward(tierId, dto);
  }

  @UseGuards(SystemAdminGuard)
  @Patch("api/progression-rewards/:rewardId")
  @ApiBearerAuth("access-token")
  updateProgressionReward(
    @Param("rewardId", ParseUUIDPipe) rewardId: string,
    @Body() dto: UpdateProgressionRewardDto,
  ) {
    return this.systemAdminService.updateProgressionReward(rewardId, dto);
  }

  @UseGuards(SystemAdminGuard)
  @Delete("api/progression-rewards/:rewardId")
  @ApiBearerAuth("access-token")
  deleteProgressionReward(@Param("rewardId", ParseUUIDPipe) rewardId: string) {
    return this.systemAdminService.deleteProgressionReward(rewardId);
  }

  @UseGuards(SystemAdminGuard)
  @Post("api/users/:userId/progressions/:key/award")
  @ApiBearerAuth("access-token")
  awardProgression(
    @Param("userId", ParseUUIDPipe) userId: string,
    @Param("key") key: string,
    @Body() dto: AwardProgressionPointsDto,
    @CurrentUser() admin: UserResponseDto,
  ) {
    return this.systemAdminService.awardProgression(userId, key, dto, admin.id);
  }

  @UseGuards(SystemAdminGuard)
  @Post("api/users/:userId/progressions/:key/reset")
  @ApiBearerAuth("access-token")
  resetProgression(
    @Param("userId", ParseUUIDPipe) userId: string,
    @Param("key") key: string,
    @Body() dto: ResetProgressionDto,
    @CurrentUser() admin: UserResponseDto,
  ) {
    return this.systemAdminService.resetProgression(userId, key, dto, admin.id);
  }

  @UseGuards(SystemAdminGuard)
  @Get("api/economy/currencies")
  @ApiBearerAuth("access-token")
  @ApiOperation({ summary: "List all currency definitions and wallet usage" })
  currencies() {
    return this.systemAdminService.listCurrencies();
  }

  @UseGuards(SystemAdminGuard)
  @Get("api/transactions")
  @ApiBearerAuth("access-token")
  @ApiOperation({ summary: "Search the complete wallet transaction ledger" })
  transactions(
    @Query("q") q?: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ) {
    return this.systemAdminService.searchTransactions({
      q,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }

  @UseGuards(SystemAdminGuard)
  @Get("api/transactions/:transactionId")
  @ApiBearerAuth("access-token")
  @ApiOperation({ summary: "View one wallet transaction in Transaction 360" })
  transaction(@Param("transactionId", ParseUUIDPipe) transactionId: string) {
    return this.systemAdminService.getAdminTransaction(transactionId);
  }

  @UseGuards(SystemAdminGuard)
  @Post("api/economy/currencies")
  @ApiBearerAuth("access-token")
  createCurrency(@Body() dto: CreateCurrencyDto) {
    return this.systemAdminService.createCurrency(dto);
  }

  @UseGuards(SystemAdminGuard)
  @Patch("api/economy/currencies/:currencyId")
  @ApiBearerAuth("access-token")
  updateCurrency(
    @Param("currencyId", ParseUUIDPipe) currencyId: string,
    @Body() dto: UpdateCurrencyDto,
  ) {
    return this.systemAdminService.updateCurrency(currencyId, dto);
  }

  @UseGuards(SystemAdminGuard)
  @Get("api/users/:userId/wallet")
  @ApiBearerAuth("access-token")
  getWallet(@Param("userId", ParseUUIDPipe) userId: string) {
    return this.systemAdminService.getAdminWallet(userId);
  }

  @UseGuards(SystemAdminGuard)
  @Post("api/users/:userId/wallet/credit")
  @ApiBearerAuth("access-token")
  creditWallet(
    @Param("userId", ParseUUIDPipe) userId: string,
    @CurrentUser() admin: UserResponseDto,
    @Body() dto: WalletMutationDto,
  ) {
    return this.systemAdminService.creditWallet(userId, dto, admin.id);
  }

  @UseGuards(SystemAdminGuard)
  @Post("api/users/:userId/wallet/debit")
  @ApiBearerAuth("access-token")
  debitWallet(
    @Param("userId", ParseUUIDPipe) userId: string,
    @CurrentUser() admin: UserResponseDto,
    @Body() dto: WalletMutationDto,
  ) {
    return this.systemAdminService.debitWallet(userId, dto, admin.id);
  }

  @UseGuards(SystemAdminGuard)
  @Post("api/users/:userId/wallet/reverse")
  @ApiBearerAuth("access-token")
  reverseWallet(
    @Param("userId", ParseUUIDPipe) userId: string,
    @Body() dto: ReverseWalletDto,
    @CurrentUser() admin: UserResponseDto,
  ) {
    return this.systemAdminService.reverseWallet(userId, dto, admin.id);
  }

  @UseGuards(SystemAdminGuard)
  @Get("api/leaderboards")
  @ApiBearerAuth("access-token")
  @ApiOperation({ summary: "List leaderboard definitions and active seasons" })
  leaderboards(@Query("includeInactive") includeInactive?: string) {
    return this.systemAdminService.listLeaderboards(includeInactive === "true");
  }

  @UseGuards(SystemAdminGuard)
  @Post("api/leaderboards")
  @ApiBearerAuth("access-token")
  createLeaderboard(@Body() dto: CreateLeaderboardDto) {
    return this.systemAdminService.createLeaderboard(dto);
  }

  @UseGuards(SystemAdminGuard)
  @Patch("api/leaderboards/:leaderboardId")
  @ApiBearerAuth("access-token")
  updateLeaderboard(
    @Param("leaderboardId", ParseUUIDPipe) leaderboardId: string,
    @Body() dto: UpdateLeaderboardDto,
  ) {
    return this.systemAdminService.updateLeaderboard(leaderboardId, dto);
  }

  @UseGuards(SystemAdminGuard)
  @Post("api/leaderboards/:leaderboardId/seasons")
  @ApiBearerAuth("access-token")
  createLeaderboardSeason(
    @Param("leaderboardId", ParseUUIDPipe) leaderboardId: string,
    @Body() dto: CreateLeaderboardSeasonDto,
  ) {
    return this.systemAdminService.createLeaderboardSeason(leaderboardId, dto);
  }

  @UseGuards(SystemAdminGuard)
  @Post("api/leaderboard-seasons/:seasonId/close")
  @ApiBearerAuth("access-token")
  closeLeaderboardSeason(@Param("seasonId", ParseUUIDPipe) seasonId: string) {
    return this.systemAdminService.closeLeaderboardSeason(seasonId);
  }

  @UseGuards(SystemAdminGuard)
  @Post("api/leaderboards/:key/score")
  @ApiBearerAuth("access-token")
  applyLeaderboardScore(
    @Param("key") key: string,
    @Body() dto: ApplyLeaderboardScoreDto,
    @CurrentUser() admin: UserResponseDto,
  ) {
    return this.systemAdminService.applyLeaderboardScore(key, dto, admin.id);
  }

  @UseGuards(SystemAdminGuard)
  @Get("api/leaderboards/:key/top-players")
  @ApiBearerAuth("access-token")
  leaderboardTopPlayers(
    @Param("key") key: string,
    @Query("limit") limit?: string,
  ) {
    return this.systemAdminService.topLeaderboardPlayers(
      key,
      limit ? Number(limit) : 10,
    );
  }

  @UseGuards(SystemAdminGuard)
  @Post("api/leaderboards/:key/rebuild")
  @ApiBearerAuth("access-token")
  @ApiOperation({
    summary: "Rebuild leaderboard projections from immutable score events",
  })
  rebuildLeaderboard(@Param("key") key: string) {
    return this.systemAdminService.rebuildLeaderboard(key);
  }

  @UseGuards(SystemAdminGuard)
  @Get("api/progressions/:progressionKey/top-players")
  @ApiBearerAuth("access-token")
  progressionTopPlayers(
    @Param("progressionKey") key: string,
    @Query("limit") limit?: string,
  ) {
    return this.systemAdminService.topProgressionPlayers(
      key,
      limit ? Number(limit) : 10,
    );
  }

  @UseGuards(SystemAdminGuard)
  @Get("api/economy/currencies/:currencyCode/top-players")
  @ApiBearerAuth("access-token")
  currencyTopPlayers(
    @Param("currencyCode") code: string,
    @Query("limit") limit?: string,
  ) {
    return this.systemAdminService.topCurrencyPlayers(
      code,
      limit ? Number(limit) : 10,
    );
  }

  @UseGuards(SystemAdminGuard)
  @Get("api/game-config")
  @ApiBearerAuth("access-token")
  @ApiOperation({
    summary: "List versioned game definitions and reward configuration",
  })
  gameConfigs() {
    return this.systemAdminService.listGameConfigs();
  }

  @UseGuards(SystemAdminGuard)
  @Patch("api/game-config/:gameKey")
  @ApiBearerAuth("access-token")
  @ApiOperation({
    summary: "Update a game reward/match policy and increment its version",
  })
  updateGameConfig(
    @Param("gameKey") gameKey: string,
    @Body() dto: UpdateGameConfigDto,
  ) {
    return this.systemAdminService.updateGameConfig(gameKey, dto);
  }

  @UseGuards(SystemAdminGuard)
  @Get("api/notifications/status")
  @ApiBearerAuth("access-token")
  @ApiOperation({ summary: "Read FCM configuration and registered device status" })
  notificationPushStatus() {
    return this.notificationsService.pushStatus();
  }

  @UseGuards(SystemAdminGuard)
  @Get("api/notifications/broadcasts")
  @ApiBearerAuth("access-token")
  @ApiOperation({ summary: "List global notification broadcasts" })
  notificationBroadcasts() {
    return this.notificationsService.listBroadcasts();
  }

  @UseGuards(SystemAdminGuard)
  @Post("api/notifications/broadcast")
  @ApiBearerAuth("access-token")
  @ApiOperation({ summary: "Send a global notification to all active players" })
  sendNotificationBroadcast(
    @Body() dto: SendGlobalNotificationDto,
    @CurrentUser() admin: UserResponseDto,
  ) {
    return this.notificationsService.sendGlobalBroadcast(admin.id, dto);
  }

  @UseGuards(SystemAdminGuard)
  @Get("api/google-auth")
  @ApiBearerAuth("access-token")
  @ApiOperation({ summary: "Read the Google Sign-In client configuration" })
  googleAuthConfig() {
    return this.systemAdminService.getGoogleAuthConfig();
  }

  @UseGuards(SystemAdminGuard)
  @Patch("api/google-auth")
  @ApiBearerAuth("access-token")
  @ApiOperation({ summary: "Enable Google Sign-In and configure its OAuth client IDs" })
  updateGoogleAuthConfig(@Body() dto: UpdateGoogleAuthConfigDto) {
    return this.systemAdminService.updateGoogleAuthConfig(dto);
  }

  @UseGuards(SystemAdminGuard)
  @Post("api/game-content")
  @ApiBearerAuth("access-token")
  @ApiOperation({
    summary: "Add server-owned game content with a hidden answer key",
  })
  createGameContent(@Body() dto: CreateGameContentDto) {
    return this.systemAdminService.createGameContent(dto);
  }

  @UseGuards(SystemAdminGuard)
  @Post("api/game-content/import")
  @ApiBearerAuth("access-token")
  @ApiOperation({ summary: "Import and deduplicate multilingual server game content" })
  importGameContent(@Body() dto: ImportGameContentDto) {
    return this.systemAdminService.importGameContent(dto);
  }

  @UseGuards(SystemAdminGuard)
  @Get("api/game-config/:gameKey/content")
  @ApiBearerAuth("access-token")
  listGameContent(@Param("gameKey") gameKey: string) {
    return this.systemAdminService.listGameContent(gameKey);
  }

  @UseGuards(SystemAdminGuard)
  @Get("api/reward-policies")
  @ApiBearerAuth("access-token")
  @ApiOperation({
    summary:
      "List versioned reward policies and their server-side settings for administrators",
  })
  rewardPolicies() {
    return this.systemAdminService.listRewardPolicies();
  }

  @UseGuards(SystemAdminGuard)
  @Post("api/reward-policies")
  @ApiBearerAuth("access-token")
  @ApiOperation({
    summary: "Publish a new version of a server-owned reward policy",
  })
  publishRewardPolicy(@Body() dto: PublishRewardPolicyDto) {
    return this.systemAdminService.publishRewardPolicy(dto);
  }

  @UseGuards(SystemAdminGuard)
  @Delete("api/reward-policies/:key")
  @ApiBearerAuth("access-token")
  @ApiOperation({
    summary:
      "Deactivate a reward policy while retaining its immutable version history",
  })
  deactivateRewardPolicy(@Param("key") key: string) {
    return this.systemAdminService.deactivateRewardPolicy(key);
  }

  @UseGuards(SystemAdminGuard)
  @Get("api/ad-rewards/claims")
  @ApiBearerAuth("access-token")
  @ApiOperation({
    summary: "Inspect verified, rejected, and granted ad reward claims",
  })
  adRewardClaims() {
    return this.systemAdminService.listAdRewardClaims();
  }

  @UseGuards(SystemAdminGuard)
  @Get("api/paid-rewards/requests")
  @ApiBearerAuth("access-token")
  @ApiOperation({ summary: "List player paid reward requests for review" })
  paidRewardRequests(@Query("status") status?: string) {
    return this.systemAdminService.listPaidRewardRequests(status);
  }

  @UseGuards(SystemAdminGuard)
  @Patch("api/paid-rewards/requests/:requestId")
  @ApiBearerAuth("access-token")
  @ApiOperation({ summary: "Fulfil or refuse a player paid reward request" })
  decidePaidRewardRequest(
    @Param("requestId", ParseUUIDPipe) requestId: string,
    @Body() dto: PaidRewardDecisionDto,
    @CurrentUser() admin: UserResponseDto,
  ) {
    return this.systemAdminService.decidePaidRewardRequest(
      requestId,
      dto,
      admin.id,
    );
  }

  @UseGuards(SystemAdminGuard)
  @Get("api/commerce/catalogs")
  @ApiBearerAuth("access-token")
  commerceCatalogs() {
    return this.systemAdminService.listCommerceCatalogs();
  }

  @UseGuards(SystemAdminGuard)
  @Get("api/social-gifts")
  @ApiBearerAuth("access-token")
  @ApiOperation({ summary: "List independent social gift definitions" })
  socialGifts() {
    return this.systemAdminService.listSocialGifts();
  }

  @UseGuards(SystemAdminGuard)
  @Post("api/social-gifts")
  @ApiBearerAuth("access-token")
  @ApiOperation({ summary: "Create an independent social gift definition" })
  createSocialGift(@Body() dto: CreateSocialGiftDto) {
    return this.systemAdminService.createSocialGift(dto);
  }

  @UseGuards(SystemAdminGuard)
  @Patch("api/social-gifts/:id")
  @ApiBearerAuth("access-token")
  @ApiOperation({ summary: "Update an independent social gift definition" })
  updateSocialGift(@Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateSocialGiftDto) {
    return this.systemAdminService.updateSocialGift(id, dto);
  }

  @UseGuards(SystemAdminGuard)
  @Post("api/commerce/catalogs")
  @ApiBearerAuth("access-token")
  createCommerceCatalog(@Body() dto: CreateCatalogDto) {
    return this.systemAdminService.createCommerceCatalog(dto);
  }

  @UseGuards(SystemAdminGuard)
  @Patch("api/commerce/catalogs/:catalogId")
  @ApiBearerAuth("access-token")
  updateCommerceCatalog(
    @Param("catalogId", ParseUUIDPipe) catalogId: string,
    @Body() dto: UpdateCatalogDto,
  ) {
    return this.systemAdminService.updateCommerceCatalog(catalogId, dto);
  }

  @UseGuards(SystemAdminGuard)
  @Get("api/commerce/assets")
  @ApiBearerAuth("access-token")
  commerceAssets() {
    return this.systemAdminService.listCommerceAssets();
  }

  @UseGuards(SystemAdminGuard)
  @Post("api/commerce/assets")
  @ApiBearerAuth("access-token")
  createCommerceAsset(@Body() dto: CreateAssetDto) {
    return this.systemAdminService.createCommerceAsset(dto);
  }

  @UseGuards(SystemAdminGuard)
  @Patch("api/commerce/assets/:assetId")
  @ApiBearerAuth("access-token")
  updateCommerceAsset(
    @Param("assetId", ParseUUIDPipe) assetId: string,
    @Body() dto: UpdateAssetDto,
  ) {
    return this.systemAdminService.updateCommerceAsset(assetId, dto);
  }

  @UseGuards(SystemAdminGuard)
  @Post("api/commerce/assets/redeem-codes")
  @ApiBearerAuth("access-token")
  @ApiOperation({ summary: "Bulk insert single-use asset redeem codes" })
  bulkInsertRedeemCodes(
    @Body() dto: BulkRedeemCodeDto,
    @CurrentUser() admin: UserResponseDto,
  ) {
    return this.systemAdminService.bulkInsertRedeemCodes(dto, admin.id);
  }

  @UseGuards(SystemAdminGuard)
  @Get("api/commerce/assets/redeem-codes")
  @ApiBearerAuth("access-token")
  @ApiOperation({
    summary:
      "List full asset redeem codes and assignments for authorized administrators",
  })
  redeemCodes(
    @Query("assetKey") assetKey?: string,
    @Query("status") status?: string,
  ) {
    return this.systemAdminService.listRedeemCodes(assetKey, status);
  }

  @UseGuards(SystemAdminGuard)
  @Post("api/commerce/items")
  @ApiBearerAuth("access-token")
  createCommerceItem(@Body() dto: CreateCatalogItemDto) {
    return this.systemAdminService.createCommerceItem(dto);
  }

  @UseGuards(SystemAdminGuard)
  @Patch("api/commerce/items/:itemId")
  @ApiBearerAuth("access-token")
  updateCommerceItem(
    @Param("itemId", ParseUUIDPipe) itemId: string,
    @Body() dto: UpdateCatalogItemDto,
  ) {
    return this.systemAdminService.updateCommerceItem(itemId, dto);
  }

  @UseGuards(SystemAdminGuard)
  @Get("api/commerce/inventory")
  @ApiBearerAuth("access-token")
  commerceInventory(@Query() query: InventoryQueryDto) {
    return this.systemAdminService.listCommerceInventory(query);
  }

  @UseGuards(SystemAdminGuard)
  @Get("api/commerce/purchases")
  @ApiBearerAuth("access-token")
  commercePurchases(@Query("userId") userId?: string) {
    return this.systemAdminService.listCommercePurchases(userId);
  }

  @UseGuards(SystemAdminGuard)
  @Get("api/users/:userId/commerce/entitlements")
  @ApiBearerAuth("access-token")
  commerceEntitlements(@Param("userId", ParseUUIDPipe) userId: string) {
    return this.systemAdminService.playerEntitlements(userId);
  }

  @UseGuards(SystemAdminGuard)
  @Post("api/users/:userId/commerce/inventory/grant")
  @ApiBearerAuth("access-token")
  grantCommerceInventory(
    @Param("userId", ParseUUIDPipe) userId: string,
    @CurrentUser() admin: UserResponseDto,
    @Body() dto: InventoryMutationDto,
  ) {
    return this.systemAdminService.grantCommerceInventory(
      userId,
      dto,
      admin.id,
    );
  }

  @UseGuards(SystemAdminGuard)
  @Post("api/users/:userId/commerce/inventory/revoke")
  @ApiBearerAuth("access-token")
  revokeCommerceInventory(
    @Param("userId", ParseUUIDPipe) userId: string,
    @CurrentUser() admin: UserResponseDto,
    @Body() dto: InventoryMutationDto,
  ) {
    return this.systemAdminService.revokeCommerceInventory(
      userId,
      dto,
      admin.id,
    );
  }
}
