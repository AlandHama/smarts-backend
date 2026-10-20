import { Body, Controller, Get, Post, Req } from "@nestjs/common"
import type { Request } from "express"
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger"
import { CurrentUser } from "../../common/decorators/current-user.decorator"
import { UserResponseDto } from "../auth/dtos/user-response.dto"
import { FraudService } from "./fraud.service"
import { RegisterInstallDto } from "./dtos"

@ApiTags("Fraud protection")
@ApiBearerAuth("access-token")
@Controller("fraud")
export class FraudController {
  constructor(private readonly fraud: FraudService) {}

  @Get("me")
  me(@CurrentUser() user: UserResponseDto) { return this.fraud.getMyStatus(user.id) }

  @Post("install")
  registerInstall(@CurrentUser() user: UserResponseDto, @Body() dto: RegisterInstallDto, @Req() request: Request) {
    const forwarded = request.headers["x-forwarded-for"]
    const ipAddress = typeof forwarded === "string" ? forwarded.split(",")[0].trim() : request.ip
    return this.fraud.registerInstall(user.id, dto, ipAddress)
  }
}
