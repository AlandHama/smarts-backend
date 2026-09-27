import { Injectable, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common"
import { OAuth2Client } from "google-auth-library"
import { PlayerAuditActorType } from "@prisma/client"

import { PrismaService } from "../../../prisma.service"
import { UpdateGoogleAuthConfigDto } from "../dtos/google-auth.dto"
import { AuthenticateGoogleTransaction, GoogleIdentityClaims } from "../transactions/authenticate-google-transaction"
import { LinkGoogleIdentityTransaction, UnlinkGoogleIdentityTransaction } from "../transactions/manage-google-identity-transaction"
import { UsersService } from "../../admin/access/users/users.service"
import { TokenService } from "./token.service"

@Injectable()
export class GoogleAuthService {
  private readonly oauthClient = new OAuth2Client()

  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly authenticateGoogleTransaction: AuthenticateGoogleTransaction,
    private readonly tokenService: TokenService,
    private readonly linkGoogleIdentityTransaction: LinkGoogleIdentityTransaction,
    private readonly unlinkGoogleIdentityTransaction: UnlinkGoogleIdentityTransaction,
  ) {}

  async login(idToken: string, request: any) {
    const claims = await this.verifyIdToken(idToken)
    const user = await this.authenticateGoogleTransaction.run({ claims })
    if (user.status === "BANNED") throw new UnauthorizedException("User is banned")
    if (user.status !== "ACTIVE") throw new UnauthorizedException("User is inactive")
    const token = await this.tokenService.generateAuthToken({ ...user, isSystemAdmin: user.isSystemAdmin }, request, this.isMobile(request))
    await this.usersService.updateLastOnline(user.id)
    return { token, user: this.usersService.toResponse(user) }
  }

  async verifyIdToken(idToken: string): Promise<GoogleIdentityClaims> {
    const config = await this.configRecord()
    if (!config?.enabled) throw new ServiceUnavailableException("Google sign-in is disabled")
    const audiences = [config.webClientId, config.androidClientId, config.iosClientId, config.desktopClientId].filter((value): value is string => Boolean(value?.trim()))
    if (!audiences.length) throw new ServiceUnavailableException("Google sign-in is not configured")

    try {
      const ticket = await this.oauthClient.verifyIdToken({ idToken, audience: audiences })
      const payload = ticket.getPayload()
      if (!payload?.sub || !payload.email || payload.email_verified !== true) throw new UnauthorizedException("Google account email is not verified")
      const fullName = payload.name?.trim() || null
      const nameParts = fullName?.split(/\s+/) ?? []
      return {
        subject: payload.sub,
        email: payload.email.trim().toLowerCase(),
        name: fullName,
        firstName: payload.given_name?.trim() || nameParts[0] || null,
        lastName: payload.family_name?.trim() || (nameParts.length > 1 ? nameParts.slice(1).join(" ") : null),
        avatarUrl: payload.picture?.trim() || null,
      }
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error
      throw new UnauthorizedException("Invalid Google sign-in token")
    }
  }

  async getAdminConfig() {
    const config = await this.configRecord()
    return this.serialize(config)
  }

  async getPublicConfig() {
    const config = await this.configRecord()
    return {
      enabled: config?.enabled ?? false,
      webClientId: config?.webClientId ?? null,
      serverClientId: config?.webClientId ?? null,
      androidClientId: config?.androidClientId ?? null,
      iosClientId: config?.iosClientId ?? null,
      desktopClientId: config?.desktopClientId ?? null,
      packageName: config?.packageName ?? null,
    }
  }

  async link(userId: string, idToken: string) {
    const claims = await this.verifyIdToken(idToken)
    return this.linkGoogleIdentityTransaction.run({ userId, claims })
  }

  getLinkStatus(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        accountOrigin: true,
        externalIdentities: {
          where: { provider: "google" },
          orderBy: { createdAt: "asc" },
          take: 1,
          select: { email: true, displayName: true, avatarUrl: true, createdAt: true },
        },
      },
    }).then((user) => {
      const identity = user?.externalIdentities[0] ?? null
      return {
        accountOrigin: user?.accountOrigin ?? "WHITELABEL",
        linked: Boolean(identity),
        canUnlink: Boolean(identity) && user?.accountOrigin !== "GOOGLE",
        identity,
      }
    })
  }

  unlink(userId: string, actorId = userId, actorType: PlayerAuditActorType = PlayerAuditActorType.PLAYER) {
    return this.unlinkGoogleIdentityTransaction.run({ userId, actorId, actorType })
  }

  updateConfig(dto: UpdateGoogleAuthConfigDto) {
    return this.prisma.googleAuthConfig.upsert({
      where: { key: "default" },
      create: {
        key: "default",
        enabled: dto.enabled,
        webClientId: this.clean(dto.webClientId),
        androidClientId: this.clean(dto.androidClientId),
        iosClientId: this.clean(dto.iosClientId),
        desktopClientId: this.clean(dto.desktopClientId),
        packageName: this.clean(dto.packageName),
      },
      update: {
        enabled: dto.enabled,
        webClientId: this.clean(dto.webClientId),
        androidClientId: this.clean(dto.androidClientId),
        iosClientId: this.clean(dto.iosClientId),
        desktopClientId: this.clean(dto.desktopClientId),
        packageName: this.clean(dto.packageName),
      },
    }).then((config) => this.serialize(config))
  }

  private configRecord() {
    return this.prisma.googleAuthConfig.findUnique({ where: { key: "default" } })
  }

  private clean(value: string | null | undefined) {
    const normalized = value?.trim()
    return normalized ? normalized : null
  }

  private serialize<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T
  }

  private isMobile(request: any) {
    const userAgent = String(request?.headers?.["user-agent"] ?? "").toLowerCase()
    return request?.headers?.["x-client-platform"] === "mobile" || /android|iphone|ipad|mobile/.test(userAgent)
  }
}
