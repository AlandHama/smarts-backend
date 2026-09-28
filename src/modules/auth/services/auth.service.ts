import { Injectable, UnauthorizedException } from "@nestjs/common"

import { HashHelper } from "../../../common/helpers/hash.helper"
import { SessionsService } from "../../admin/access/sessions/sessions.service"
import { ChangePasswordTransaction } from "../../admin/access/users/transactions/change-password-transaction"
import { UsersService } from "../../admin/access/users/users.service"
import { AuthCredentialsRequestDto, ChangePasswordRequestDto, LoginResponseDto, RegisterRequestDto } from "../dtos"
import { TokenService } from "./token.service"
import { FraudService } from "../../fraud/fraud.service"

@Injectable()
export class AuthService {
  private dummyPasswordHash?: string

  constructor(
    private readonly usersService: UsersService,
    private readonly sessionsService: SessionsService,
    private readonly changePasswordTransaction: ChangePasswordTransaction,
    private readonly tokenService: TokenService,
    private readonly fraudService: FraudService,
  ) {}

  async login(dto: AuthCredentialsRequestDto, request: any): Promise<LoginResponseDto> {
    const identifier = dto.username ?? dto.email
    if (!identifier) throw new UnauthorizedException("Invalid credentials")
    const user = await this.usersService.findByIdentifier(identifier)
    const passwordHash = user?.passwordHash ?? await this.getDummyPasswordHash()
    const passwordMatches = await HashHelper.compare(dto.password, passwordHash)

    if (!user || !passwordMatches) throw new UnauthorizedException("Invalid credentials")
    if (user.status === "BANNED") throw new UnauthorizedException("User is banned")
    if (user.status !== "ACTIVE") throw new UnauthorizedException("User is inactive")

    const token = await this.tokenService.generateAuthToken({ ...user, isSystemAdmin: user.isSystemAdmin }, request, this.isMobile(request))
    await this.usersService.updateLastOnline(user.id)
    const headers = request?.headers ?? {}
    const deviceFingerprint = [headers["x-device-manufacturer"], headers["x-device-model"], headers["x-device-os"], headers["x-device-os-version"]].filter((value) => typeof value === "string" && value.trim()).join("|") || String(headers["user-agent"] ?? "credentials")
    void this.fraudService.observe(user.id, { type: "ABNORMAL_SESSION_SWITCHING", sourceType: "LOGIN", sourceId: `${deviceFingerprint}:${Date.now()}` }).catch(() => undefined)
    void this.fraudService.observeSharedDevice(user.id, deviceFingerprint).catch(() => undefined)
    return { token, user: this.usersService.toResponse(user) }
  }

  async register(dto: RegisterRequestDto, request: any): Promise<LoginResponseDto> {
    const user = await this.usersService.create(dto)
    const token = await this.tokenService.generateAuthToken(user, request, this.isMobile(request))
    await this.usersService.updateLastOnline(user.id)
    const headers = request?.headers ?? {}
    const deviceFingerprint = [headers["x-device-manufacturer"], headers["x-device-model"], headers["x-device-os"], headers["x-device-os-version"]].filter((value) => typeof value === "string" && value.trim()).join("|") || String(headers["user-agent"] ?? "registration")
    void this.fraudService.observe(user.id, { type: "ABNORMAL_SESSION_SWITCHING", sourceType: "REGISTER", sourceId: `${deviceFingerprint}:${Date.now()}` }).catch(() => undefined)
    void this.fraudService.observeSharedDevice(user.id, deviceFingerprint).catch(() => undefined)
    return { token, user: this.usersService.toResponse(user) }
  }

  async me(userId: string) {
    const user = await this.usersService.findById(userId)
    if (!user || user.status !== "ACTIVE") throw new UnauthorizedException("Please login again")
    await this.usersService.updateLastOnline(userId)
    return { user: this.usersService.toResponse(user) }
  }

  logout(userId: string, tokenId: string) {
    return this.sessionsService.terminateByTokenId(userId, tokenId).then(() => undefined)
  }

  async changePassword(userId: string, dto: ChangePasswordRequestDto) {
    return this.changePasswordTransaction.run({ userId, dto })
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
