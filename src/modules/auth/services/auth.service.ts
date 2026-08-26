import { Injectable, UnauthorizedException } from "@nestjs/common"

import { HashHelper } from "../../../common/helpers/hash.helper"
import { PrismaService } from "../../../prisma.service"
import { SessionsService } from "../../admin/access/sessions/sessions.service"
import { UsersService } from "../../admin/access/users/users.service"
import { AuthCredentialsRequestDto, ChangePasswordRequestDto, LoginResponseDto, RegisterRequestDto } from "../dtos"
import { TokenService } from "./token.service"

@Injectable()
export class AuthService {
  private dummyPasswordHash?: string

  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly sessionsService: SessionsService,
    private readonly tokenService: TokenService,
  ) {}

  async login(dto: AuthCredentialsRequestDto, request: any): Promise<LoginResponseDto> {
    const user = await this.usersService.findByUsername(dto.username)
    const passwordHash = user?.passwordHash ?? await this.getDummyPasswordHash()
    const passwordMatches = await HashHelper.compare(dto.password, passwordHash)

    if (!user || !passwordMatches) throw new UnauthorizedException("Invalid credentials")
    if (user.status === "BANNED") throw new UnauthorizedException("User is banned")
    if (user.status !== "ACTIVE") throw new UnauthorizedException("User is inactive")

    const token = await this.tokenService.generateAuthToken(user, request, this.isMobile(request))
    await this.prisma.user.update({ where: { id: user.id }, data: { lastOnline: new Date() } })
    return { token, user: this.usersService.toResponse(user) }
  }

  async register(dto: RegisterRequestDto, request: any): Promise<LoginResponseDto> {
    const user = await this.usersService.create(dto)
    const token = await this.tokenService.generateAuthToken(user, request, this.isMobile(request))
    return { token, user: this.usersService.toResponse(user) }
  }

  async me(userId: string) {
    const user = await this.usersService.findById(userId)
    if (!user || user.status !== "ACTIVE") throw new UnauthorizedException("Please login again")
    await this.prisma.user.update({ where: { id: userId }, data: { lastOnline: new Date() } })
    return { user: this.usersService.toResponse(user) }
  }

  logout(userId: string, tokenId: string) {
    return this.sessionsService.terminateByTokenId(userId, tokenId).then(() => undefined)
  }

  async changePassword(userId: string, dto: ChangePasswordRequestDto) {
    const user = await this.usersService.findById(userId)
    if (!user || !(await HashHelper.compare(dto.currentPassword, user.passwordHash))) {
      throw new UnauthorizedException("Current password is invalid")
    }
    const passwordHash = await HashHelper.encrypt(dto.newPassword)
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { passwordHash } }),
      this.prisma.session.updateMany({ where: { userId, sessionStatus: "ACTIVE" }, data: { sessionStatus: "TERMINATED" } }),
    ])
    return { message: "Password changed. Please login again." }
  }

  private isMobile(request: any): boolean {
    const userAgent = String(request?.headers?.["user-agent"] ?? "").toLowerCase()
    return request?.headers?.["x-client-platform"] === "mobile" || /android|iphone|ipad|mobile/.test(userAgent)
  }

  private async getDummyPasswordHash(): Promise<string> {
    this.dummyPasswordHash ??= await HashHelper.encrypt("constant-time-invalid-password")
    return this.dummyPasswordHash
  }
}
