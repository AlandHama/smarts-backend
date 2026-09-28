import { Injectable, UnauthorizedException } from "@nestjs/common"
import { JwtService } from "@nestjs/jwt"
import { randomUUID } from "node:crypto"

import { HashHelper } from "../../../common/helpers/hash.helper"
import { SessionsService } from "../../admin/access/sessions/sessions.service"
import { CreateSessionTransaction, SessionCreateData } from "../../admin/access/sessions/transactions/create-session-transaction"
import { RotateSessionTransaction } from "../../admin/access/sessions/transactions/rotate-session-transaction"
import { UsersService } from "../../admin/access/users/users.service"
import { getAuthConfig } from "../auth.config"
import { TOKEN_TYPE } from "../constants"
import { TokenType } from "../enums"
import type { JwtPayload } from "../dtos/jwt-payload.dto"
import type { TokenDto } from "../dtos/token.dto"

@Injectable()
export class TokenService {
  private readonly config = getAuthConfig()

  constructor(
    private readonly jwtService: JwtService,
    private readonly sessionsService: SessionsService,
    private readonly usersService: UsersService,
    private readonly createSessionTransaction: CreateSessionTransaction,
    private readonly rotateSessionTransaction: RotateSessionTransaction,
  ) {}

  async generateAuthToken(user: { id: string; username: string; isSystemAdmin?: boolean }, request?: any, isMobile = false): Promise<TokenDto> {
    return this.createTokenPair(user, request, isMobile, isMobile)
  }

  async generateRefreshToken(refreshToken: string, request?: any, isMobile = false): Promise<TokenDto> {
    try {
      const payload = this.verify(refreshToken, TokenType.RefreshToken)
      if (payload.tokenUse !== TokenType.RefreshToken) throw new UnauthorizedException("Invalid refresh token")
      const user = await this.usersService.findById(payload.userId)
      if (!user || user.status !== "ACTIVE") throw new UnauthorizedException("Invalid refresh token")

      const replacement = await this.createTokenPairData(
        { id: user.id, username: user.username, isSystemAdmin: user.isSystemAdmin },
        request,
        isMobile,
        false,
      )
      await this.rotateSessionTransaction.run({
        userId: payload.userId,
        tokenId: payload.tokenId,
        refreshToken,
        replacement: replacement.session,
      })
      return replacement.token
    } catch (error) {
      // Old, revoked, malformed, or already-rotated refresh tokens are an
      // authentication failure. Never expose a transaction/hash error as a
      // 500, because the mobile client must clear the local session and show
      // the login screen.
      if (error instanceof UnauthorizedException) throw error
      throw new UnauthorizedException("Invalid or expired refresh token")
    }
  }

  verifyAccessToken(token: string): JwtPayload {
    const payload = this.verify(token, TokenType.AccessToken)
    if (payload.tokenUse !== TokenType.AccessToken) throw new UnauthorizedException("Invalid access token")
    return payload
  }

  async validateToken(token: string): Promise<{ valid: boolean }> {
    try {
      const payload = this.verifyAccessToken(token)
      const session = await this.sessionsService.findActive(payload.userId, payload.tokenId)
      if (!session) return { valid: false }
      const user = await this.usersService.findById(payload.userId)
      return { valid: user?.status === "ACTIVE" }
    } catch {
      return { valid: false }
    }
  }

  private verify(token: string, type: TokenType): JwtPayload {
    try {
      return this.jwtService.verify<JwtPayload>(token, {
        secret: type === TokenType.RefreshToken ? this.config.refreshSecret : this.config.accessSecret,
        algorithms: ["HS256"],
      })
    } catch {
      throw new UnauthorizedException(type === TokenType.RefreshToken ? "Invalid or expired refresh token" : "Invalid or expired access token")
    }
  }

  private async createTokenPair(
    user: { id: string; username: string; isSystemAdmin?: boolean },
    request: any,
    isMobile: boolean,
    enforceSingleMobileSession: boolean,
  ): Promise<TokenDto> {
    const pair = await this.createTokenPairData(user, request, isMobile, enforceSingleMobileSession)
    await this.createSessionTransaction.run(pair.session)
    return pair.token
  }

  private async createTokenPairData(
    user: { id: string; username: string; isSystemAdmin?: boolean },
    request: any,
    isMobile: boolean,
    enforceSingleMobileSession: boolean,
  ): Promise<{ token: TokenDto; session: SessionCreateData }> {
    const tokenId = randomUUID()
    const payload = { sub: user.id, userId: user.id, username: user.username, isSystemAdmin: user.isSystemAdmin === true, tokenId }
    const accessExpiresIn = user.isSystemAdmin ? this.config.adminAccessExpiresIn : this.config.accessExpiresIn
    const accessExpiresInSeconds = user.isSystemAdmin ? this.config.adminAccessExpiresInSeconds : this.config.accessExpiresInSeconds
    const accessToken = this.jwtService.sign({ ...payload, tokenUse: TokenType.AccessToken }, {
      secret: this.config.accessSecret,
      expiresIn: accessExpiresIn as any,
      algorithm: "HS256",
    })
    const refreshToken = this.jwtService.sign({ ...payload, tokenUse: TokenType.RefreshToken }, {
      secret: this.config.refreshSecret,
      expiresIn: this.config.refreshExpiresIn as any,
      algorithm: "HS256",
    })
    const headers = request?.headers ?? {}
    const raw = (value: unknown, max = 500) => typeof value === "string" ? value.trim().slice(0, max) || undefined : undefined
    const expiresAt = new Date(Date.now() + this.config.refreshExpiresInSeconds * 1000)
    return {
      token: {
        tokenType: TOKEN_TYPE,
        accessToken,
        accessTokenExpires: accessExpiresInSeconds,
        refreshToken,
        refreshTokenExpires: this.config.refreshExpiresInSeconds,
      },
      session: {
        userId: user.id,
        tokenId,
        refreshTokenHash: await HashHelper.encrypt(refreshToken),
        expiresAt,
        isMobileSession: isMobile,
        clientVersion: raw(headers["x-client-version"] ?? headers["x-app-version"], 32),
        appBuildNumber: raw(headers["x-app-build"], 32),
        platform: raw(headers["x-client-platform"], 32),
        osName: raw(headers["x-device-os"], 40),
        osVersion: raw(headers["x-device-os-version"], 80),
        deviceType: raw(headers["x-device-type"], 40),
        deviceModel: raw(headers["x-device-model"], 120),
        deviceManufacturer: raw(headers["x-device-manufacturer"], 80),
        deviceLocale: raw(headers["x-device-locale"], 40),
        deviceTimezone: raw(headers["x-device-timezone"], 80),
        isPhysicalDevice: headers["x-physical-device"] === "true" ? true : headers["x-physical-device"] === "false" ? false : undefined,
        deviceInfo: raw(headers["user-agent"]),
        ipAddress: raw(headers["x-forwarded-for"] ?? request?.ip)?.split(",")[0],
        deviceName: raw(headers["device-name"]) ?? (isMobile ? "Mobile Device" : "Browser"),
        location: raw(headers.location),
        enforceSingleMobileSession,
      },
    }
  }
}
