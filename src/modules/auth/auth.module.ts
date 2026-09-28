import { Module } from "@nestjs/common"
import { APP_GUARD } from "@nestjs/core"
import { JwtModule } from "@nestjs/jwt"
import { PassportModule } from "@nestjs/passport"

import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard"
import { SessionsModule } from "../admin/access/sessions/sessions.module"
import { UsersModule } from "../admin/access/users/users.module"
import { DatabaseModule } from "../../database/database.module"
import { getAuthConfig } from "./auth.config"
import { AuthController } from "./auth.controller"
import { JwtStrategy } from "./jwt.strategy"
import { AuthService } from "./services/auth.service"
import { TokenService } from "./services/token.service"
import { GoogleAuthService } from "./services/google-auth.service"
import { AuthenticateGoogleTransaction } from "./transactions/authenticate-google-transaction"
import { LinkGoogleIdentityTransaction, UnlinkGoogleIdentityTransaction } from "./transactions/manage-google-identity-transaction"
import { FraudModule } from "../fraud/fraud.module"

@Module({
  imports: [
    DatabaseModule,
    UsersModule,
    SessionsModule,
    PassportModule.register({ defaultStrategy: "jwt" }),
    JwtModule.register({ secret: getAuthConfig().accessSecret }),
    FraudModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenService,
    GoogleAuthService,
    AuthenticateGoogleTransaction,
    LinkGoogleIdentityTransaction,
    UnlinkGoogleIdentityTransaction,
    JwtStrategy,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
  exports: [AuthService, TokenService, GoogleAuthService, JwtStrategy, PassportModule, JwtModule],
})
export class AuthModule {}
