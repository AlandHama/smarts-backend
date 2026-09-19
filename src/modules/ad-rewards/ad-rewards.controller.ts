import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { Request } from "express";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";

import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { SkipAuth } from "../../common/decorators/skip-auth.decorator";
import { UserResponseDto } from "../auth/dtos/user-response.dto";
import { AdRewardsService } from "./ad-rewards.service";
import { ClaimAdRewardDto, CreateAdImpressionDto } from "./dtos/ad-reward.dto";
import { CompleteClientAdEventDto } from "./dtos/ad-event.dto";

@ApiTags("Ad rewards")
@Controller("ad-rewards")
export class AdRewardsController {
  constructor(private readonly adRewardsService: AdRewardsService) {}

  @Post("impressions")
  @ApiBearerAuth("access-token")
  @ApiOperation({
    summary: "Create a one-time server challenge before showing a rewarded ad",
  })
  impression(
    @CurrentUser() user: UserResponseDto,
    @Body() dto: CreateAdImpressionDto,
  ) {
    return this.adRewardsService.createImpression(user.id, dto);
  }

  @Post("events")
  @ApiBearerAuth("access-token")
  @ApiOperation({
    summary: "Complete a challenged ad event reported by the mobile client",
  })
  clientEvent(
    @CurrentUser() user: UserResponseDto,
    @Body() dto: CompleteClientAdEventDto,
  ) {
    return this.adRewardsService.completeClientEvent(user.id, dto);
  }

  @Get("estimate")
  @ApiBearerAuth("access-token")
  @ApiOperation({
    summary: "Get the server-estimated GLD reward and remaining daily limits",
  })
  estimate(
    @CurrentUser() user: UserResponseDto,
    @Query("adFormat") adFormat = "rewarded",
  ) {
    return this.adRewardsService.estimate(user.id, adFormat);
  }

  @SkipAuth()
  @Post("claims")
  @ApiOperation({
    summary: "Verify a provider callback and atomically grant the ad reward",
  })
  claim(
    @Body() dto: ClaimAdRewardDto,
    @Headers("x-ad-reward-signature") signature?: string,
  ) {
    return this.adRewardsService.claim(dto, signature);
  }

  @SkipAuth()
  @Get("admob-ssv")
  @ApiOperation({
    summary:
      "Receive and verify a native Google AdMob rewarded-ad SSV callback",
  })
  admobSsv(@Req() request: Request) {
    return this.adRewardsService.handleAdMobSsv(
      request.originalUrl || request.url,
    );
  }

  @Get("claims/:claimId")
  @ApiBearerAuth("access-token")
  @ApiOperation({
    summary: "Read the authenticated player's server-committed ad reward claim",
  })
  getClaim(
    @CurrentUser() user: UserResponseDto,
    @Param("claimId", ParseUUIDPipe) claimId: string,
  ) {
    return this.adRewardsService.getClaim(user.id, claimId);
  }
}
