import { Body, Controller, Headers, Post } from "@nestjs/common"
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger"

import { CurrentUser } from "../../common/decorators/current-user.decorator"
import { SkipAuth } from "../../common/decorators/skip-auth.decorator"
import { UserResponseDto } from "../auth/dtos/user-response.dto"
import { AdRewardsService } from "./ad-rewards.service"
import { ClaimAdRewardDto, CreateAdImpressionDto } from "./dtos/ad-reward.dto"

@ApiTags("Ad rewards")
@Controller("ad-rewards")
export class AdRewardsController {
  constructor(private readonly adRewardsService: AdRewardsService) {}

  @Post("impressions")
  @ApiBearerAuth("access-token")
  @ApiOperation({ summary: "Create a one-time server challenge before showing a rewarded ad" })
  impression(@CurrentUser() user: UserResponseDto, @Body() dto: CreateAdImpressionDto) { return this.adRewardsService.createImpression(user.id, dto) }

  @SkipAuth()
  @Post("claims")
  @ApiOperation({ summary: "Verify a provider callback and atomically grant the ad reward" })
  claim(@Body() dto: ClaimAdRewardDto, @Headers("x-ad-reward-signature") signature?: string) { return this.adRewardsService.claim(dto, signature) }
}
