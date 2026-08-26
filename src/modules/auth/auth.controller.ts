import { Body, Controller, Delete, Get, Param, Post, Req } from "@nestjs/common"
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger"

import { CurrentUser } from "../../common/decorators/current-user.decorator"
import { SkipAuth } from "../../common/decorators/skip-auth.decorator"
import { SessionResponseDto } from "../admin/access/sessions/dtos/session-response.dto"
import { SessionsService } from "../admin/access/sessions/sessions.service"
import { AuthService } from "./services/auth.service"
import { TokenService } from "./services/token.service"
import { AuthCredentialsRequestDto, ChangePasswordRequestDto, LoginResponseDto, RefreshTokenRequestDto, RegisterRequestDto, UserResponseDto, ValidateTokenRequestDto } from "./dtos"

@ApiTags("Auth")
@Controller("auth")
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly tokenService: TokenService,
    private readonly sessionsService: SessionsService,
  ) {}

  @SkipAuth()
  @Post("login")
  @ApiOperation({ summary: "Authenticate with username and password" })
  login(@Body() dto: AuthCredentialsRequestDto, @Req() request: any): Promise<LoginResponseDto> {
    return this.authService.login(dto, request)
  }

  @SkipAuth()
  @Post("register")
  @ApiOperation({ summary: "Register a user and create a session" })
  register(@Body() dto: RegisterRequestDto, @Req() request: any): Promise<LoginResponseDto> {
    return this.authService.register(dto, request)
  }

  @SkipAuth()
  @Post("refresh")
  @Post("token/refresh")
  @ApiOperation({ summary: "Rotate a refresh token and issue a new token pair" })
  refresh(@Body() dto: RefreshTokenRequestDto, @Req() request: any) {
    return this.tokenService.generateRefreshToken(dto.refreshToken, request, this.isMobile(request))
  }

  @SkipAuth()
  @Post("token/validate")
  @ApiOperation({ summary: "Check whether an access token and session are valid" })
  validate(@Body() dto: ValidateTokenRequestDto) {
    return this.tokenService.validateToken(dto.token)
  }

  @Get("me")
  @ApiBearerAuth("access-token")
  @ApiOperation({ summary: "Get the authenticated user" })
  me(@CurrentUser() user: UserResponseDto) {
    return this.authService.me(user.id)
  }

  @Post("logout")
  @ApiBearerAuth("access-token")
  @ApiOperation({ summary: "Terminate the current session" })
  async logout(@Req() request: any) {
    await this.authService.logout(request.user.id, request.authPayload.tokenId)
    return { message: "Logged out successfully" }
  }

  @Post("logout-all")
  @ApiBearerAuth("access-token")
  @ApiOperation({ summary: "Terminate all sessions for the authenticated user" })
  async logoutAll(@CurrentUser() user: UserResponseDto) {
    await this.sessionsService.terminateAllForUser(user.id)
    return { message: "All sessions terminated" }
  }

  @Get("sessions")
  @ApiBearerAuth("access-token")
  @ApiOperation({ summary: "List the authenticated user's sessions" })
  sessions(@CurrentUser() user: UserResponseDto): Promise<SessionResponseDto[]> {
    return this.sessionsService.listForUser(user.id) as Promise<SessionResponseDto[]>
  }

  @Delete("sessions/:sessionId")
  @ApiBearerAuth("access-token")
  @ApiOperation({ summary: "Terminate one of the authenticated user's sessions" })
  revokeSession(@CurrentUser() user: UserResponseDto, @Param("sessionId") sessionId: string) {
    return this.sessionsService.terminateById(user.id, sessionId).then(() => ({ message: "Session terminated" }))
  }

  @Post("password")
  @ApiBearerAuth("access-token")
  @ApiOperation({ summary: "Change the current user's password" })
  changePassword(@CurrentUser() user: UserResponseDto, @Body() dto: ChangePasswordRequestDto) {
    return this.authService.changePassword(user.id, dto)
  }

  private isMobile(request: any): boolean {
    const userAgent = String(request?.headers?.["user-agent"] ?? "").toLowerCase()
    return request?.headers?.["x-client-platform"] === "mobile" || /android|iphone|ipad|mobile/.test(userAgent)
  }
}
