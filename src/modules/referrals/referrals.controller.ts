import { Body, Controller, Get, Post } from "@nestjs/common"
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger"

import { CurrentUser } from "../../common/decorators/current-user.decorator"
import { UserResponseDto } from "../auth/dtos/user-response.dto"
import { ClaimReferralDto } from "./dtos"
import { ReferralsService } from "./referrals.service"

@ApiTags("Referrals")
@ApiBearerAuth("access-token")
@Controller("referrals")
export class ReferralsController {
  constructor(private readonly referralsService: ReferralsService) {}

  @Get("me")
  @ApiOperation({ summary: "Get the authenticated player's referral code and referral progress" })
  me(@CurrentUser() user: UserResponseDto) { return this.referralsService.getForUser(user.id) }

  @Post("claim")
  @ApiOperation({ summary: "Apply another player's referral code once" })
  claim(@CurrentUser() user: UserResponseDto, @Body() dto: ClaimReferralDto) { return this.referralsService.claim(user.id, dto) }
}

