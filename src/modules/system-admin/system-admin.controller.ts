import { Body, Controller, Delete, Get, Header, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from "@nestjs/common"
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger"

import { CurrentUser } from "../../common/decorators/current-user.decorator"
import { SkipAuth } from "../../common/decorators/skip-auth.decorator"
import { UserResponseDto } from "../auth/dtos/user-response.dto"
import { SYSTEM_ADMIN_PAGE } from "./system-admin.page"
import { SystemAdminGuard } from "./system-admin.guard"
import { SystemAdminService } from "./system-admin.service"
import { RegisterRequestDto } from "../auth/dtos/register-request.dto"
import { ResetUserPasswordDto, SystemAdminLoginDto, SystemAdminUsersQueryDto, UpdateUserProfileDto, UpdateUserStatusDto } from "./dtos"

@ApiTags("System Admin")
@Controller("system-admin")
export class SystemAdminController {
  constructor(private readonly systemAdminService: SystemAdminService) {}

  @SkipAuth()
  @Get()
  @Header("Content-Type", "text/html; charset=utf-8")
  page() {
    return SYSTEM_ADMIN_PAGE
  }

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
}
