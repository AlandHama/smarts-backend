import { BadRequestException, ConflictException, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common"
import { createHash, createHmac, timingSafeEqual } from "node:crypto"
import { Prisma, WalletTransactionSourceType } from "@prisma/client"

import { PrismaTransaction } from "../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../prisma.service"
import { ConfigService } from "../../config/config.service"
import { CreditWalletTransaction } from "../../economy/transactions/credit-wallet-transaction"
import { ClaimAdRewardDto } from "../dtos/ad-reward.dto"

type AdPolicy = {
  currencyCode?: string
  dailyCap?: number
  dailyCapAmount?: string
  cooldownSeconds?: number
  rewards?: Record<string, { amount?: string; multiplierByCountry?: Record<string, string> }>
}

@Injectable()
export class ClaimAdRewardTransaction extends PrismaTransaction<{ dto: ClaimAdRewardDto; signature?: string }, any> {
  constructor(
    prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly creditWallet: CreditWalletTransaction,
  ) { super(prisma) }

  protected async execute(input: { dto: ClaimAdRewardDto; signature?: string }, transaction: Prisma.TransactionClient) {
    const claim = await transaction.adRewardClaim.findUnique({ where: { id: input.dto.claimId }, include: { user: { select: { id: true, status: true, profile: { select: { countryCode: true } } } } } })
    if (!claim || claim.user.status !== "ACTIVE") throw new NotFoundException("Ad reward claim not found")
    if (!input.signature) throw new UnauthorizedException("Provider signature is required")
    const expectedSecret = process.env.AD_REWARD_WEBHOOK_SECRET?.trim()
    if (!expectedSecret) throw new UnauthorizedException("Ad reward verification is not configured")
    const canonical = `${claim.id}:${input.dto.providerEventId.trim()}:${input.dto.adFormat.trim().toLowerCase()}:${input.dto.claimToken}`
    const expected = createHmac("sha256", expectedSecret).update(canonical).digest("hex")
    const supplied = input.signature.trim().toLowerCase()
    if (supplied.length !== expected.length || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) throw new UnauthorizedException("Invalid ad provider signature")
    if (createHash("sha256").update(input.dto.claimToken).digest("hex") !== claim.claimTokenHash) throw new UnauthorizedException("Invalid ad claim token")
    if (claim.adFormat !== input.dto.adFormat.trim().toLowerCase()) throw new BadRequestException("Ad format does not match the claim")

    if (claim.status === "GRANTED") return this.result(claim.rewardAmount, claim.currencyId, claim.grantedAt, "already-granted")
    if (claim.status === "REJECTED") throw new ConflictException(claim.rejectionReason ?? "Ad reward claim was rejected")
    if (claim.expiresAt <= new Date()) return this.reject(transaction, claim.id, "Ad reward claim expired")

    const policy = await this.configService.getActivePrivate<AdPolicy>("ad-reward")
    const reward = policy.privateConfig.rewards?.[claim.adFormat]
    const baseAmount = reward?.amount
    const currencyCode = policy.privateConfig.currencyCode?.trim().toUpperCase()
    if (!currencyCode || !baseAmount || !/^\d+$/.test(baseAmount) || BigInt(baseAmount) <= 0n) return this.reject(transaction, claim.id, "Ad reward policy is not configured")
    let amount = BigInt(baseAmount)
    const country = claim.user.profile?.countryCode?.trim().toUpperCase()
    const multiplier = country ? reward?.multiplierByCountry?.[country] : undefined
    if (multiplier) amount = this.applyMultiplier(amount, multiplier)
    if (amount <= 0n) return this.reject(transaction, claim.id, "Ad reward amount is invalid")

    // Serialize claims per player so cooldown and daily caps cannot be bypassed
    // by concurrent provider callbacks.
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ad-event:${claim.provider}:${input.dto.providerEventId.trim()}`}))`
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${claim.userId || "ad-reward"}))`
    const now = new Date()
    const providerEventId = input.dto.providerEventId.trim()
    const duplicate = await transaction.adRewardClaim.findFirst({ where: { provider: claim.provider, providerEventId, id: { not: claim.id } }, select: { id: true } })
    if (duplicate) throw new ConflictException("This provider ad event was already claimed")
    const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    const grantedToday = await transaction.adRewardClaim.findMany({ where: { userId: claim.userId, status: "GRANTED", grantedAt: { gte: startOfDay } }, select: { rewardAmount: true } })
    if (policy.privateConfig.dailyCap !== undefined && grantedToday.length >= policy.privateConfig.dailyCap) return this.reject(transaction, claim.id, "Daily ad reward limit reached")
    if (policy.privateConfig.dailyCapAmount && /^\d+$/.test(policy.privateConfig.dailyCapAmount) && grantedToday.reduce((sum, row) => sum + (row.rewardAmount ?? 0n), 0n) + amount > BigInt(policy.privateConfig.dailyCapAmount)) return this.reject(transaction, claim.id, "Daily ad reward amount limit reached")
    const latest = await transaction.adRewardClaim.findFirst({ where: { userId: claim.userId, status: "GRANTED" }, orderBy: { grantedAt: "desc" }, select: { grantedAt: true } })
    const cooldown = Math.max(0, policy.privateConfig.cooldownSeconds ?? 0)
    if (latest?.grantedAt && latest.grantedAt.getTime() + cooldown * 1000 > now.getTime()) return this.reject(transaction, claim.id, "Ad reward cooldown is active")

    const ledger = await this.creditWallet.runWithinTransaction({
      userId: claim.userId,
      currencyCode,
      amount,
      sourceId: claim.id,
      sourceType: WalletTransactionSourceType.AD,
      rewardGrantKey: `AD:${claim.id}`,
      policyVersion: String(policy.version),
      metadata: { provider: claim.provider, providerEventId, adFormat: claim.adFormat, countryCode: country ?? null },
    }, transaction)
    const currency = await transaction.currencyDefinition.findUnique({ where: { code: currencyCode }, select: { id: true } })
    const updated = await transaction.adRewardClaim.update({ where: { id: claim.id }, data: { providerEventId, countryCode: country ?? null, currencyId: currency?.id, rewardAmount: amount, status: "GRANTED", verificationPayload: { providerVerified: true }, verifiedAt: now, grantedAt: now } })
    await transaction.outboxEvent.create({ data: { eventType: "ad-reward.granted", aggregateType: "AdRewardClaim", aggregateId: claim.id, payload: { claimId: claim.id, userId: claim.userId, amount: amount.toString(), currencyCode, ledger } as unknown as Prisma.InputJsonValue } })
    return { claimId: updated.id, status: updated.status, amount: amount.toString(), currencyCode, grantedAt: updated.grantedAt }
  }

  private async reject(transaction: Prisma.TransactionClient, claimId: string, reason: string) {
    await transaction.adRewardClaim.update({ where: { id: claimId }, data: { status: "REJECTED", rejectionReason: reason } })
    throw new BadRequestException(reason)
  }

  private applyMultiplier(amount: bigint, value: string) {
    const match = value.match(/^(\d+)(?:\.(\d{1,6}))?$/)
    if (!match) throw new BadRequestException("Ad reward policy multiplier is invalid")
    const scale = 10n ** BigInt(match[2]?.length ?? 0)
    const numerator = BigInt(match[1]) * scale + BigInt(match[2] ?? "0")
    return amount * numerator / scale
  }

  private result(amount: bigint | null, currencyId: string | null, grantedAt: Date | null, status: string) {
    return { status, amount: amount?.toString() ?? null, currencyId, grantedAt }
  }
}
