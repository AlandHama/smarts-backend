import { ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common"
import { AuthGuard } from "@nestjs/passport"
import { Reflector } from "@nestjs/core"

import { SKIP_AUTH } from "../decorators/skip-auth.decorator"
import { TokenService } from "../../modules/auth/services/token.service"
import { ExtractJwt } from "passport-jwt"

@Injectable()
export class JwtAuthGuard extends AuthGuard("jwt") {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokenService: TokenService,
  ) {
    super()
  }

  canActivate(context: ExecutionContext) {
    const skipAuth = this.reflector.getAllAndOverride<boolean>(SKIP_AUTH, [
      context.getHandler(),
      context.getClass(),
    ])

    if (skipAuth) return true
    const request = context.switchToHttp().getRequest()
    const accessToken = ExtractJwt.fromAuthHeaderAsBearerToken()(request)
    if (!accessToken) throw new UnauthorizedException("Access token is required")
    this.tokenService.verifyAccessToken(accessToken)
    return super.canActivate(context)
  }

  handleRequest<TUser = any>(error: any, user: any, _info: any, _context: ExecutionContext): TUser {
    if (error) throw error
    if (!user) throw new UnauthorizedException("Authentication failed")
    return user as TUser
  }
}
