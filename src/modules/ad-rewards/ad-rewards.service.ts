import { Injectable } from "@nestjs/common"

import { ClaimAdRewardTransaction } from "./transactions/claim-ad-reward-transaction"
import { VerifyAdImpressionTransaction } from "./transactions/verify-ad-impression-transaction"
import { ClaimAdRewardDto, CreateAdImpressionDto } from "./dtos/ad-reward.dto"
import { PrismaService } from "../../prisma.service"
import { NotFoundException } from "@nestjs/common"

@Injectable()
export class AdRewardsService {
  constructor(
    private readonly verifyTransaction: VerifyAdImpressionTransaction,
    private readonly claimTransaction: ClaimAdRewardTransaction,
    private readonly prisma: PrismaService,
  ) {}

  createImpression(userId: string, dto: CreateAdImpressionDto) { return this.verifyTransaction.run({ userId, dto }) }
  claim(dto: ClaimAdRewardDto, signature?: string) { return this.claimTransaction.run({ dto, signature }) }

  async getClaim(userId: string, claimId: string) {
    const claim = await this.prisma.adRewardClaim.findFirst({ where: { id: claimId, userId }, select: { id: true, status: true, rewardAmount: true, currency: { select: { code: true } }, grantedAt: true, rejectionReason: true, expiresAt: true, verificationPayload: true } })
    if (!claim) throw new NotFoundException("Ad reward claim not found")
    const verification = claim.verificationPayload && typeof claim.verificationPayload === "object" && !Array.isArray(claim.verificationPayload) ? claim.verificationPayload as Record<string, unknown> : {}
    return { claimId: claim.id, status: claim.status, amount: claim.rewardAmount?.toString() ?? null, currencyCode: claim.currency?.code ?? null, grantedAt: claim.grantedAt, rejectionReason: claim.rejectionReason, expiresAt: claim.expiresAt, rewarded: verification.rewarded === true, remainingDailyAds: typeof verification.remainingDailyAds === "number" ? verification.remainingDailyAds : null, remainingDailyGldCap: typeof verification.remainingDailyGldCap === "string" ? verification.remainingDailyGldCap : null, reason: typeof verification.reason === "string" ? verification.reason : null }
  }
}
