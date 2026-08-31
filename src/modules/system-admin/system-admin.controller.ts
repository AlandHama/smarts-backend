import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from "@nestjs/common"
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger"

import { CurrentUser } from "../../common/decorators/current-user.decorator"
import { SkipAuth } from "../../common/decorators/skip-auth.decorator"
import { UserResponseDto } from "../auth/dtos/user-response.dto"
import { SystemAdminGuard } from "./system-admin.guard"
import { SystemAdminService } from "./system-admin.service"
import { RegisterRequestDto } from "../auth/dtos/register-request.dto"
import { RegisterAdminDto, ResetUserPasswordDto, SystemAdminLoginDto, SystemAdminUsersQueryDto, UpdateUserProfileDto, UpdateUserStatusDto } from "./dtos"
import { AwardProgressionPointsDto, CreateProgressionDto, CreateProgressionRewardDto, CreateProgressionTierDto, ResetProgressionDto, UpdateProgressionDto, UpdateProgressionRewardDto, UpdateProgressionTierDto } from "../progression/dtos"
import { CreateCurrencyDto, ReverseWalletDto, UpdateCurrencyDto, WalletMutationDto } from "../economy/dtos"
import { ApplyLeaderboardScoreDto, CreateLeaderboardDto, CreateLeaderboardSeasonDto, UpdateLeaderboardDto } from "../leaderboard/dtos"
import { CreateGameContentDto, UpdateGameConfigDto } from "../game/dtos"

@ApiTags("System Admin")
@Controller("system-admin")
export class SystemAdminController {
  constructor(private readonly systemAdminService: SystemAdminService) {}

  @SkipAuth()
  @Post("api/auth/login")
  @HttpCode(200)
  @ApiOperation({ summary: "Sign in to the system administrator console" })
  login(@Body() dto: SystemAdminLoginDto, @Req() request: any) {
    return this.systemAdminService.login(dto, request)
  }

  @UseGuards(SystemAdminGuard)
  @Get("api/overview")
  @ApiBearerAuth("access-token")
  @ApiOperation({ summary: "Get system administrator dashboard counts" })
  overview() {
    return this.systemAdminService.overview()
  }

  @UseGuards(SystemAdminGuard)
  @Get("api/users")
  @ApiBearerAuth("access-token")
  @ApiOperation({ summary: "List and search user accounts" })
  users(@Query() query: SystemAdminUsersQueryDto) {
    return this.systemAdminService.listUsers(query)
  }

  @UseGuards(SystemAdminGuard)
  @Post("api/users")
  @ApiBearerAuth("access-token")
  @ApiOperation({ summary: "Create a player account from the admin console" })
  createUser(@Body() dto: RegisterRequestDto) {
    return this.systemAdminService.createUser(dto)
  }

  @UseGuards(SystemAdminGuard)
  @Post("api/admins")
  @ApiBearerAuth("access-token")
  @ApiOperation({ summary: "Create an active system administrator account" })
  createAdmin(@Body() dto: RegisterAdminDto) {
    return this.systemAdminService.createAdmin(dto)
  }

  @UseGuards(SystemAdminGuard)
  @Get("api/users/:userId")
  @ApiBearerAuth("access-token")
  @ApiOperation({ summary: "View a complete player account, wallet, and session summary" })
  getUser(@Param("userId", ParseUUIDPipe) userId: string) {
    return this.systemAdminService.getUserDetails(userId)
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
    return this.systemAdminService.updateUserProfile(userId, admin.id, dto)
  }

  @UseGuards(SystemAdminGuard)
  @Post("api/users/:userId/reset-password")
  @ApiBearerAuth("access-token")
  @ApiOperation({ summary: "Reset a player's password and terminate active sessions" })
  resetPassword(
    @Param("userId", ParseUUIDPipe) userId: string,
    @CurrentUser() admin: UserResponseDto,
    @Body() dto: ResetUserPasswordDto,
  ) {
    return this.systemAdminService.resetUserPassword(userId, admin.id, dto)
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
    return this.systemAdminService.updateStatus(userId, admin.id, dto)
  }

  @UseGuards(SystemAdminGuard)
  @Delete("api/users/:userId")
  @ApiBearerAuth("access-token")
  @ApiOperation({ summary: "Permanently delete a user account" })
  deleteUser(@Param("userId", ParseUUIDPipe) userId: string, @CurrentUser() admin: UserResponseDto) {
    return this.systemAdminService.deleteUser(userId, admin.id)
  }

  @UseGuards(SystemAdminGuard)
  @Get("api/progressions")
  @ApiBearerAuth("access-token")
  @ApiOperation({ summary: "List progression definitions, tiers, and configured rewards" })
  progressions(@Query("includeInactive") includeInactive?: string) {
    return this.systemAdminService.listProgressions(includeInactive === "true")
  }

  @UseGuards(SystemAdminGuard)
  @Post("api/progressions")
  @ApiBearerAuth("access-token")
  @ApiOperation({ summary: "Create a progression definition" })
  createProgression(@Body() dto: CreateProgressionDto) { return this.systemAdminService.createProgression(dto) }

  @UseGuards(SystemAdminGuard)
  @Get("api/progressions/:progressionId")
  @ApiBearerAuth("access-token")
  getProgression(@Param("progressionId", ParseUUIDPipe) progressionId: string) { return this.systemAdminService.getProgression(progressionId) }

  @UseGuards(SystemAdminGuard)
  @Patch("api/progressions/:progressionId")
  @ApiBearerAuth("access-token")
  updateProgression(@Param("progressionId", ParseUUIDPipe) progressionId: string, @Body() dto: UpdateProgressionDto) { return this.systemAdminService.updateProgression(progressionId, dto) }

  @UseGuards(SystemAdminGuard)
  @Post("api/progressions/:progressionId/tiers")
  @ApiBearerAuth("access-token")
  createProgressionTier(@Param("progressionId", ParseUUIDPipe) progressionId: string, @Body() dto: CreateProgressionTierDto) { return this.systemAdminService.createProgressionTier(progressionId, dto) }

  @UseGuards(SystemAdminGuard)
  @Patch("api/progression-tiers/:tierId")
  @ApiBearerAuth("access-token")
  updateProgressionTier(@Param("tierId", ParseUUIDPipe) tierId: string, @Body() dto: UpdateProgressionTierDto) { return this.systemAdminService.updateProgressionTier(tierId, dto) }

  @UseGuards(SystemAdminGuard)
  @Delete("api/progression-tiers/:tierId")
  @ApiBearerAuth("access-token")
  deleteProgressionTier(@Param("tierId", ParseUUIDPipe) tierId: string) { return this.systemAdminService.deleteProgressionTier(tierId) }

  @UseGuards(SystemAdminGuard)
  @Post("api/progression-tiers/:tierId/rewards")
  @ApiBearerAuth("access-token")
  createProgressionReward(@Param("tierId", ParseUUIDPipe) tierId: string, @Body() dto: CreateProgressionRewardDto) { return this.systemAdminService.createProgressionReward(tierId, dto) }

  @UseGuards(SystemAdminGuard)
  @Patch("api/progression-rewards/:rewardId")
  @ApiBearerAuth("access-token")
  updateProgressionReward(@Param("rewardId", ParseUUIDPipe) rewardId: string, @Body() dto: UpdateProgressionRewardDto) { return this.systemAdminService.updateProgressionReward(rewardId, dto) }

  @UseGuards(SystemAdminGuard)
  @Delete("api/progression-rewards/:rewardId")
  @ApiBearerAuth("access-token")
  deleteProgressionReward(@Param("rewardId", ParseUUIDPipe) rewardId: string) { return this.systemAdminService.deleteProgressionReward(rewardId) }

  @UseGuards(SystemAdminGuard)
  @Post("api/users/:userId/progressions/:key/award")
  @ApiBearerAuth("access-token")
  awardProgression(@Param("userId", ParseUUIDPipe) userId: string, @Param("key") key: string, @Body() dto: AwardProgressionPointsDto) { return this.systemAdminService.awardProgression(userId, key, dto) }

  @UseGuards(SystemAdminGuard)
  @Post("api/users/:userId/progressions/:key/reset")
  @ApiBearerAuth("access-token")
  resetProgression(@Param("userId", ParseUUIDPipe) userId: string, @Param("key") key: string, @Body() dto: ResetProgressionDto) { return this.systemAdminService.resetProgression(userId, key, dto) }

  @UseGuards(SystemAdminGuard)
  @Get("api/economy/currencies")
  @ApiBearerAuth("access-token")
  @ApiOperation({ summary: "List all currency definitions and wallet usage" })
  currencies() { return this.systemAdminService.listCurrencies() }

  @UseGuards(SystemAdminGuard)
  @Post("api/economy/currencies")
  @ApiBearerAuth("access-token")
  createCurrency(@Body() dto: CreateCurrencyDto) { return this.systemAdminService.createCurrency(dto) }

  @UseGuards(SystemAdminGuard)
  @Patch("api/economy/currencies/:currencyId")
  @ApiBearerAuth("access-token")
  updateCurrency(@Param("currencyId", ParseUUIDPipe) currencyId: string, @Body() dto: UpdateCurrencyDto) { return this.systemAdminService.updateCurrency(currencyId, dto) }

  @UseGuards(SystemAdminGuard)
  @Get("api/users/:userId/wallet")
  @ApiBearerAuth("access-token")
  getWallet(@Param("userId", ParseUUIDPipe) userId: string) { return this.systemAdminService.getAdminWallet(userId) }

  @UseGuards(SystemAdminGuard)
  @Post("api/users/:userId/wallet/credit")
  @ApiBearerAuth("access-token")
  creditWallet(@Param("userId", ParseUUIDPipe) userId: string, @CurrentUser() admin: UserResponseDto, @Body() dto: WalletMutationDto) { return this.systemAdminService.creditWallet(userId, dto, admin.id) }

  @UseGuards(SystemAdminGuard)
  @Post("api/users/:userId/wallet/debit")
  @ApiBearerAuth("access-token")
  debitWallet(@Param("userId", ParseUUIDPipe) userId: string, @CurrentUser() admin: UserResponseDto, @Body() dto: WalletMutationDto) { return this.systemAdminService.debitWallet(userId, dto, admin.id) }

  @UseGuards(SystemAdminGuard)
  @Post("api/users/:userId/wallet/reverse")
  @ApiBearerAuth("access-token")
  reverseWallet(@Param("userId", ParseUUIDPipe) userId: string, @Body() dto: ReverseWalletDto) { return this.systemAdminService.reverseWallet(userId, dto) }

  @UseGuards(SystemAdminGuard)
  @Get("api/leaderboards")
  @ApiBearerAuth("access-token")
  @ApiOperation({ summary: "List leaderboard definitions and active seasons" })
  leaderboards(@Query("includeInactive") includeInactive?: string) { return this.systemAdminService.listLeaderboards(includeInactive === "true") }

  @UseGuards(SystemAdminGuard)
  @Post("api/leaderboards")
  @ApiBearerAuth("access-token")
  createLeaderboard(@Body() dto: CreateLeaderboardDto) { return this.systemAdminService.createLeaderboard(dto) }

  @UseGuards(SystemAdminGuard)
  @Patch("api/leaderboards/:leaderboardId")
  @ApiBearerAuth("access-token")
  updateLeaderboard(@Param("leaderboardId", ParseUUIDPipe) leaderboardId: string, @Body() dto: UpdateLeaderboardDto) { return this.systemAdminService.updateLeaderboard(leaderboardId, dto) }

  @UseGuards(SystemAdminGuard)
  @Post("api/leaderboards/:leaderboardId/seasons")
  @ApiBearerAuth("access-token")
  createLeaderboardSeason(@Param("leaderboardId", ParseUUIDPipe) leaderboardId: string, @Body() dto: CreateLeaderboardSeasonDto) { return this.systemAdminService.createLeaderboardSeason(leaderboardId, dto) }

  @UseGuards(SystemAdminGuard)
  @Post("api/leaderboard-seasons/:seasonId/close")
  @ApiBearerAuth("access-token")
  closeLeaderboardSeason(@Param("seasonId", ParseUUIDPipe) seasonId: string) { return this.systemAdminService.closeLeaderboardSeason(seasonId) }

  @UseGuards(SystemAdminGuard)
  @Post("api/leaderboards/:key/score")
  @ApiBearerAuth("access-token")
  applyLeaderboardScore(@Param("key") key: string, @Body() dto: ApplyLeaderboardScoreDto, @CurrentUser() admin: UserResponseDto) { return this.systemAdminService.applyLeaderboardScore(key, dto, admin.id) }

  @UseGuards(SystemAdminGuard)
  @Get("api/leaderboards/:key/top-players")
  @ApiBearerAuth("access-token")
  leaderboardTopPlayers(@Param("key") key: string, @Query("limit") limit?: string) { return this.systemAdminService.topLeaderboardPlayers(key, limit ? Number(limit) : 10) }

  @UseGuards(SystemAdminGuard)
  @Post("api/leaderboards/:key/rebuild")
  @ApiBearerAuth("access-token")
  @ApiOperation({ summary: "Rebuild leaderboard projections from immutable score events" })
  rebuildLeaderboard(@Param("key") key: string) { return this.systemAdminService.rebuildLeaderboard(key) }

  @UseGuards(SystemAdminGuard)
  @Get("api/progressions/:progressionKey/top-players")
  @ApiBearerAuth("access-token")
  progressionTopPlayers(@Param("progressionKey") key: string, @Query("limit") limit?: string) { return this.systemAdminService.topProgressionPlayers(key, limit ? Number(limit) : 10) }

  @UseGuards(SystemAdminGuard)
  @Get("api/economy/currencies/:currencyCode/top-players")
  @ApiBearerAuth("access-token")
  currencyTopPlayers(@Param("currencyCode") code: string, @Query("limit") limit?: string) { return this.systemAdminService.topCurrencyPlayers(code, limit ? Number(limit) : 10) }

  @UseGuards(SystemAdminGuard)
  @Get("api/game-config")
  @ApiBearerAuth("access-token")
  @ApiOperation({ summary: "List versioned game definitions and reward configuration" })
  gameConfigs() { return this.systemAdminService.listGameConfigs() }

  @UseGuards(SystemAdminGuard)
  @Patch("api/game-config/:gameKey")
  @ApiBearerAuth("access-token")
  @ApiOperation({ summary: "Update a game reward/match policy and increment its version" })
  updateGameConfig(@Param("gameKey") gameKey: string, @Body() dto: UpdateGameConfigDto) { return this.systemAdminService.updateGameConfig(gameKey, dto) }

  @UseGuards(SystemAdminGuard)
  @Post("api/game-content")
  @ApiBearerAuth("access-token")
  @ApiOperation({ summary: "Add server-owned game content with a hidden answer key" })
  createGameContent(@Body() dto: CreateGameContentDto) { return this.systemAdminService.createGameContent(dto) }

  @UseGuards(SystemAdminGuard)
  @Get("api/game-config/:gameKey/content")
  @ApiBearerAuth("access-token")
  listGameContent(@Param("gameKey") gameKey: string) { return this.systemAdminService.listGameContent(gameKey) }
}
