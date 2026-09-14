import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common"

import { ClaimAdRewardTransaction } from "./transactions/claim-ad-reward-transaction"
import { VerifyAdImpressionTransaction } from "./transactions/verify-ad-impression-transaction"
import { ClaimAdRewardDto, CreateAdImpressionDto } from "./dtos/ad-reward.dto"
import { PrismaService } from "../../prisma.service"
import { ConfigService } from "../config/config.service"
import { GldEmissionService } from "../gld/gld.emission.service"

@Injectable()
export class AdRewardsService {
  constructor(
    private readonly verifyTransaction: VerifyAdImpressionTransaction,
    private readonly claimTransaction: ClaimAdRewardTransaction,
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly gldEmission: GldEmissionService,
  ) {}

  createImpression(userId: string, dto: CreateAdImpressionDto) { return this.verifyTransaction.run({ userId, dto }) }
  claim(dto: ClaimAdRewardDto, signature?: string) { return this.claimTransaction.run({ dto, signature }) }

  async estimate(userId: string, adFormat: string) {
    const normalizedFormat = adFormat.trim().toLowerCase()
    const policy = await this.configService.getActivePrivate<any>("ad-reward")
    const allowedFormats = policy.privateConfig.allowedAdFormats ?? ["rewarded"]
    if (!allowedFormats.includes(normalizedFormat)) throw new BadRequestException("This ad reward placement is not enabled")
    const reward = policy.privateConfig.rewards?.[normalizedFormat]
    const baseAmount = reward?.amount
    const currencyCode = policy.privateConfig.currencyCode?.trim().toUpperCase()
    if (!currencyCode || !baseAmount || !/^\d+$/.test(baseAmount) || BigInt(baseAmount) <= 0n) throw new BadRequestException("Ad reward policy is not configured")
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, status: true, profile: { select: { countryCode: true } } } })
    if (!user || user.status !== "ACTIVE") throw new NotFoundException("Player account not found")
    let amount = BigInt(baseAmount)
    const country = user.profile?.countryCode?.trim().toUpperCase()
    const multiplier = country ? reward?.multiplierByCountry?.[country] : undefined
    if (multiplier) amount = this.applyMultiplier(amount, multiplier)
    if (currencyCode !== "GLD") return { adFormat: normalizedFormat, currencyCode, amount: amount.toString(), remainingDailyAds: null, remainingDailyGldCap: null, eligible: true, reason: null }
    const estimate = await this.prisma.$transaction((tx) => this.gldEmission.estimateAdReward(tx, { userId, baseAmount: amount }))
    return { adFormat: normalizedFormat, currencyCode, amount: estimate.amount.toString(), remainingDailyAds: estimate.remainingDailyAds, remainingDailyGldCap: estimate.remainingDailyGldCap.toString(), eligible: estimate.amount > 0n, reason: estimate.reason }
  }

  async getClaim(userId: string, claimId: string) {
    const claim = await this.prisma.adRewardClaim.findFirst({ where: { id: claimId, userId }, select: { id: true, status: true, rewardAmount: true, currency: { select: { code: true } }, grantedAt: true, rejectionReason: true, expiresAt: true, verificationPayload: true } })
    if (!claim) throw new NotFoundException("Ad reward claim not found")
    const verification = claim.verificationPayload && typeof claim.verificationPayload === "object" && !Array.isArray(claim.verificationPayload) ? claim.verificationPayload as Record<string, unknown> : {}
    return { claimId: claim.id, status: claim.status, amount: claim.rewardAmount?.toString() ?? null, currencyCode: claim.currency?.code ?? null, grantedAt: claim.grantedAt, rejectionReason: claim.rejectionReason, expiresAt: claim.expiresAt, rewarded: verification.rewarded === true, remainingDailyAds: typeof verification.remainingDailyAds === "number" ? verification.remainingDailyAds : null, remainingDailyGldCap: typeof verification.remainingDailyGldCap === "string" ? verification.remainingDailyGldCap : null, reason: typeof verification.reason === "string" ? verification.reason : null }
  }

  private applyMultiplier(amount: bigint, value: string) {
    const match = value.match(/^(\d+)(?:\.(\d{1,6}))?$/)
    if (!match) throw new BadRequestException("Ad reward policy multiplier is invalid")
    const scale = 10n ** BigInt(match[2]?.length ?? 0)
    const numerator = BigInt(match[1]) * scale + BigInt(match[2] ?? "0")
    return amount * numerator / scale
  }
}
