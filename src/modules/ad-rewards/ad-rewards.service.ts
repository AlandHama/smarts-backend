import { Injectable } from "@nestjs/common"

import { ClaimAdRewardTransaction } from "./transactions/claim-ad-reward-transaction"
import { VerifyAdImpressionTransaction } from "./transactions/verify-ad-impression-transaction"
import { ClaimAdRewardDto, CreateAdImpressionDto } from "./dtos/ad-reward.dto"

@Injectable()
export class AdRewardsService {
  constructor(
    private readonly verifyTransaction: VerifyAdImpressionTransaction,
    private readonly claimTransaction: ClaimAdRewardTransaction,
  ) {}

  createImpression(userId: string, dto: CreateAdImpressionDto) { return this.verifyTransaction.run({ userId, dto }) }
  claim(dto: ClaimAdRewardDto, signature?: string) { return this.claimTransaction.run({ dto, signature }) }
}
