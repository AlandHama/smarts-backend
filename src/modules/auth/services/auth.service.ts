import { ConflictException, Injectable, UnauthorizedException } from "@nestjs/common"
import { randomBytes } from "node:crypto"

import { HashHelper } from "../../../common/helpers/hash.helper"
import { SessionsService } from "../../admin/access/sessions/sessions.service"
import { ChangePasswordTransaction } from "../../admin/access/users/transactions/change-password-transaction"
import { UsersService } from "../../admin/access/users/users.service"
import { AuthCredentialsRequestDto, ChangePasswordRequestDto, LoginResponseDto, RegisterRequestDto, UpgradeGuestRequestDto } from "../dtos"
import { TokenService } from "./token.service"
import { FraudService } from "../../fraud/fraud.service"
import { SignupPolicyService } from "./signup-policy.service"
import { PrismaService } from "../../../prisma.service"
import { ContentSafetyService } from "../../content-safety/content-safety.service"
import { CreateUserInput } from "../../admin/access/users/transactions/create-user-transaction"

@Injectable()
export class AuthService {
  private dummyPasswordHash?: string

  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly sessionsService: SessionsService,
    private readonly changePasswordTransaction: ChangePasswordTransaction,
    private readonly tokenService: TokenService,
    private readonly fraudService: FraudService,
    private readonly signupPolicy: SignupPolicyService,
    private readonly contentSafety: ContentSafetyService,
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
    await this.signupPolicy.assertEnabled()
    const user = await this.usersService.create(dto)
    const token = await this.tokenService.generateAuthToken(user, request, this.isMobile(request))
    await this.usersService.updateLastOnline(user.id)
    const headers = request?.headers ?? {}
    const deviceFingerprint = [headers["x-device-manufacturer"], headers["x-device-model"], headers["x-device-os"], headers["x-device-os-version"]].filter((value) => typeof value === "string" && value.trim()).join("|") || String(headers["user-agent"] ?? "registration")
    void this.fraudService.observe(user.id, { type: "ABNORMAL_SESSION_SWITCHING", sourceType: "REGISTER", sourceId: `${deviceFingerprint}:${Date.now()}` }).catch(() => undefined)
    void this.fraudService.observeSharedDevice(user.id, deviceFingerprint).catch(() => undefined)
    return { token, user: this.usersService.toResponse(user) }
  }

  async createGuest(request: any): Promise<LoginResponseDto> {
    // A guest is a real server-side player. Retrying on the unique username
    // constraint keeps the generated identity safe even under concurrent
    // installs without exposing a predictable sequence.
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const code = randomBytes(6).toString("base64url").replace(/[^a-zA-Z0-9]/g, "").slice(0, 10).toUpperCase()
      const username = `guest_${code.toLowerCase()}`
      try {
        const user = await this.usersService.create({
          username,
          password: randomBytes(32).toString("base64url"),
          email: null,
          displayName: `Guest ${code}`,
          accountOrigin: "GUEST",
          onboardingCompletedAt: new Date(),
          skipSignupBonus: true,
        } as CreateUserInput)
        const token = await this.tokenService.generateAuthToken({ ...user, isSystemAdmin: user.isSystemAdmin }, request, this.isMobile(request))
        await this.usersService.updateLastOnline(user.id)
        return { token, user: this.usersService.toResponse(user) }
      } catch (error) {
        if (error instanceof ConflictException && attempt < 7) continue
        throw error
      }
    }
    throw new ConflictException("Could not create a guest account")
  }

  async upgradeGuest(userId: string, dto: UpgradeGuestRequestDto, request: any): Promise<LoginResponseDto> {
    await this.signupPolicy.assertEnabled()
    const username = dto.username.trim().toLowerCase()
    const email = dto.email.trim().toLowerCase()
    this.contentSafety.assertSafeText(username, "Username")
    this.contentSafety.assertSafeText(dto.displayName, "Display name")
    const guest = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, accountOrigin: true, status: true } })
    if (!guest || guest.status !== "ACTIVE") throw new UnauthorizedException("Please login again")
    if (guest.accountOrigin !== "GUEST") throw new ConflictException("This account has already been upgraded")
    const collision = await this.prisma.user.findFirst({
      where: { NOT: { id: userId }, OR: [{ username }, { email }] },
      select: { id: true },
    })
    if (collision) throw new ConflictException("Username or email is already registered")
    const passwordHash = await HashHelper.encrypt(dto.password)
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          username,
          email,
          passwordHash,
          accountOrigin: "WHITELABEL",
          profile: { update: { displayName: dto.displayName.trim() } },
        },
      })
    })
    const user = await this.usersService.findById(userId)
    if (!user) throw new UnauthorizedException("Please login again")
    const token = await this.tokenService.generateAuthToken({ ...user, isSystemAdmin: user.isSystemAdmin }, request, this.isMobile(request))
    await this.usersService.updateLastOnline(user.id)
    return { token, user: this.usersService.toResponse(user) }
  }

  async me(userId: string) {
    const user = await this.usersService.findById(userId)
    if (!user || user.status !== "ACTIVE") throw new UnauthorizedException("Please login again")
    await this.usersService.updateLastOnline(userId)
    return { user: this.usersService.toResponse(user) }
  }

  async completeOnboarding(userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { onboardingCompletedAt: new Date() },
    })
    return { onboardingCompleted: true }
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
