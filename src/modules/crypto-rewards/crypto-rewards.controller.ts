import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Req } from "@nestjs/common"
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger"

import { CurrentUser } from "../../common/decorators/current-user.decorator"
import { SkipAuth } from "../../common/decorators/skip-auth.decorator"
import { UserResponseDto } from "../auth/dtos"
import { CryptoRewardsService } from "./crypto-rewards.service"
import { CryptoAddressValidationDto, CreateCryptoPayoutRequestDto, CryptoRewardQuoteDto } from "./dtos"

@ApiTags("crypto-rewards")
@ApiBearerAuth("access-token")
@Controller("crypto-rewards")
export class CryptoRewardsController {
  constructor(private readonly rewards: CryptoRewardsService) {}

  @Get("config") config() { return this.rewards.getPublicConfig() }
  @Post("addresses/validate") validate(@CurrentUser() user: UserResponseDto, @Body() dto: CryptoAddressValidationDto) { return this.rewards.validateAddress(user.id, dto) }
  @Post("quote") quote(@CurrentUser() user: UserResponseDto, @Body() dto: CryptoRewardQuoteDto) { return this.rewards.quote(user.id, dto) }
  @Post("requests") create(@CurrentUser() user: UserResponseDto, @Body() dto: CreateCryptoPayoutRequestDto) { return this.rewards.createRequest(user.id, dto) }
  @Get("requests") list(@CurrentUser() user: UserResponseDto) { return this.rewards.listPlayerRequests(user.id) }
  @Get("requests/:requestId") get(@CurrentUser() user: UserResponseDto, @Param("requestId", ParseUUIDPipe) requestId: string) { return this.rewards.getPlayerRequest(user.id, requestId) }
  @Post("requests/:requestId/cancel") cancel(@CurrentUser() user: UserResponseDto, @Param("requestId", ParseUUIDPipe) requestId: string) { return this.rewards.cancel(user.id, requestId) }

  @SkipAuth()
  @Post("webhooks/nowpayments")
  webhook(@Req() request: any, @Headers("x-nowpayments-sig") signature?: string) {
    const rawBody = typeof request.rawBody === "string" ? request.rawBody : JSON.stringify(request.body ?? {})
    return this.rewards.handleProviderIpn(rawBody, signature)
  }
}
