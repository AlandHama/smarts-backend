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

  async generateAuthToken(user: { id: string; username: string }, request?: any, isMobile = false): Promise<TokenDto> {
    return this.createTokenPair(user, request, isMobile)
  }

  async generateRefreshToken(refreshToken: string, request?: any, isMobile = false): Promise<TokenDto> {
    const payload = this.verify(refreshToken, TokenType.RefreshToken)
    if (payload.tokenUse !== TokenType.RefreshToken) throw new UnauthorizedException("Invalid refresh token")

    const replacement = await this.createTokenPairData(
      { id: payload.userId, username: payload.username },
      request,
      isMobile,
    )
    await this.rotateSessionTransaction.run({
      userId: payload.userId,
      tokenId: payload.tokenId,
      refreshToken,
      replacement: replacement.session,
    })
    return replacement.token
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
    user: { id: string; username: string },
    request: any,
    isMobile: boolean,
  ): Promise<TokenDto> {
    const pair = await this.createTokenPairData(user, request, isMobile)
    await this.createSessionTransaction.run(pair.session)
    return pair.token
  }

  private async createTokenPairData(
    user: { id: string; username: string },
    request: any,
    isMobile: boolean,
  ): Promise<{ token: TokenDto; session: SessionCreateData }> {
    const tokenId = randomUUID()
    const payload = { sub: user.id, userId: user.id, username: user.username, tokenId }
    const accessToken = this.jwtService.sign({ ...payload, tokenUse: TokenType.AccessToken }, {
      secret: this.config.accessSecret,
      expiresIn: this.config.accessExpiresIn as any,
      algorithm: "HS256",
    })
    const refreshToken = this.jwtService.sign({ ...payload, tokenUse: TokenType.RefreshToken }, {
      secret: this.config.refreshSecret,
      expiresIn: this.config.refreshExpiresIn as any,
      algorithm: "HS256",
    })
    const headers = request?.headers ?? {}
    const raw = (value: unknown) => typeof value === "string" ? value.trim().slice(0, 500) || undefined : undefined
    const expiresAt = new Date(Date.now() + this.config.refreshExpiresInSeconds * 1000)
    return {
      token: {
        tokenType: TOKEN_TYPE,
        accessToken,
        accessTokenExpires: this.config.accessExpiresInSeconds,
        refreshToken,
        refreshTokenExpires: this.config.refreshExpiresInSeconds,
      },
      session: {
        userId: user.id,
        tokenId,
        refreshTokenHash: await HashHelper.encrypt(refreshToken),
        expiresAt,
        isMobileSession: isMobile,
        clientVersion: raw(headers["x-client-version"] ?? headers["x-app-version"])?.slice(0, 32),
        deviceInfo: raw(headers["user-agent"]),
        ipAddress: raw(headers["x-forwarded-for"] ?? request?.ip)?.split(",")[0],
        deviceName: raw(headers["device-name"]) ?? (isMobile ? "Mobile Device" : "Browser"),
        location: raw(headers.location),
      },
    }
  }
}
