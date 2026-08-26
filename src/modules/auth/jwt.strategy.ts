import { Injectable, UnauthorizedException } from "@nestjs/common"
import { PassportStrategy } from "@nestjs/passport"
import { Request } from "express"
import { ExtractJwt, Strategy } from "passport-jwt"

import { PrismaService } from "../../prisma.service"
import { SessionsService } from "../admin/access/sessions/sessions.service"
import { getAuthConfig } from "./auth.config"
import type { JwtPayload } from "./dtos/jwt-payload.dto"

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessionsService: SessionsService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: getAuthConfig().accessSecret,
      algorithms: ["HS256"],
      passReqToCallback: true,
    })
  }

  async validate(request: Request, payload: JwtPayload) {
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    if (
      payload.tokenUse !== "ACCESS_TOKEN" ||
      !uuidPattern.test(payload.userId) ||
      !uuidPattern.test(payload.tokenId)
    ) {
      throw new UnauthorizedException("Invalid access token")
    }

    const [user, session] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: payload.userId } }),
      this.prisma.session.findFirst({
        where: {
          userId: payload.userId,
          tokenId: payload.tokenId,
          sessionStatus: "ACTIVE",
          expiresAt: { gt: new Date() },
        },
      }),
    ])

    if (!user || !session) throw new UnauthorizedException("Session is no longer active")
    if (user.status === "BANNED") throw new UnauthorizedException("User is banned")
    if (user.status !== "ACTIVE") throw new UnauthorizedException("User is inactive")

    await this.sessionsService.updateLastActive(session.id)

    ;(request as Request & { authPayload: JwtPayload }).authPayload = payload
    return {
      id: user.id,
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      status: user.status,
      isSystemAdmin: user.isSystemAdmin,
    }
  }
}
