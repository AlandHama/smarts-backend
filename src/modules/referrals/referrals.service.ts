import { Injectable, NotFoundException } from "@nestjs/common"
import { randomBytes } from "node:crypto"
import { Prisma, ReferralStatus, WalletTransactionSourceType } from "@prisma/client"

import { PrismaService } from "../../prisma.service"
import { writeAdminAudit } from "../../common/helpers/admin-audit"
import { CreditWalletTransaction } from "../economy/transactions/credit-wallet-transaction"
import { ClaimReferralTransaction } from "./transactions/claim-referral-transaction"
import { UpdateReferralConfigTransaction } from "./transactions/update-referral-config-transaction"
import { ClaimReferralDto, UpdateReferralConfigDto, UpdateReferralPlayerOverrideDto } from "./dtos"
import { FraudService } from "../fraud/fraud.service"

@Injectable()
export class ReferralsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly claimTransaction: ClaimReferralTransaction,
    private readonly updateConfigTransaction: UpdateReferralConfigTransaction,
    private readonly creditWallet: CreditWalletTransaction,
    private readonly fraudService: FraudService,
  ) {}

  async claim(userId: string, dto: ClaimReferralDto) {
    const result = await this.claimTransaction.run({ userId, dto })
    void this.fraudService.observe(userId, { type: "REFERRAL_DEVICE_MATCH", sourceType: "REFERRAL", sourceId: result.referralId, metadata: { code: dto.code.trim().toUpperCase() } }).catch(() => undefined)
    return result
  }

  async getForUser(userId: string) {
    const [config, override] = await Promise.all([
      this.prisma.referralConfig.upsert({ where: { singletonKey: "default" }, create: { singletonKey: "default" }, update: {} }),
      this.prisma.referralPlayerOverride.findUnique({ where: { userId } }),
    ])
    const effective = this.effectiveConfig(config, override)
    const code = await this.ensureCode(userId)
    const startOfDay = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()))
    const [referrals, referral, dailyRewards] = await Promise.all([
      this.prisma.referral.findMany({ where: { referrerId: userId }, orderBy: { createdAt: "desc" }, take: 100, select: { id: true, status: true, referredAdCount: true, totalRewardedGld: true, totalRewardedGldDecimal: true, rewardCount: true, invitedAt: true, qualifiedAt: true, referred: { select: { username: true, profile: { select: { displayName: true, avatarUrl: true } } } } } }),
      this.prisma.referral.findUnique({ where: { referredId: userId }, select: { id: true, status: true, referrer: { select: { username: true, profile: { select: { displayName: true, avatarUrl: true } } } } } }),
      this.prisma.referralReward.aggregate({ where: { referrerId: userId, status: "GRANTED", createdAt: { gte: startOfDay } }, _sum: { rewardAmountDecimal: true }, _count: { _all: true } }),
    ])
    const totalRewarded = referrals.reduce((sum, item) => sum.add(item.totalRewardedGldDecimal), new Prisma.Decimal(0))
    const dailyRewarded = dailyRewards._sum.rewardAmountDecimal ?? new Prisma.Decimal(0)
    const qualified = referrals.filter((item) => item.status === ReferralStatus.QUALIFIED || item.status === ReferralStatus.CAPPED).length
    const shareLink = this.playStoreReferralLink(code.code)
    const webShareBaseUrl = (process.env.SMARTS_SHARE_BASE_URL ?? "https://smarts.app/join").replace(/\/$/, "")
    const webShareLink = `${webShareBaseUrl}?ref=${encodeURIComponent(code.code)}`
    return this.serialize({ enabled: effective.enabled, code: code.code, shareText: `Join SMARTS on Google Play with my referral link. You both unlock more rewards: ${shareLink}`, shareLink, webShareLink, maxInvites: effective.maxInvitesPerUser, invitesUsed: code.inviteCount, invitesRemaining: Math.max(effective.maxInvitesPerUser - code.inviteCount, 0), rewardBps: effective.rewardBps, rewardPercent: effective.rewardBps / 100, maxRewardPerReferral: effective.maxRewardPerReferral, minQualifyingAds: effective.minQualifyingAds, personalized: Boolean(override), settingsSource: override ? "PLAYER" : "GLOBAL", referralsCount: referrals.length, qualifiedCount: qualified, totalRewardedGld: totalRewarded, dailyRewardedGld: dailyRewarded, dailyRewardCount: dailyRewards._count._all, dailyRewardDate: startOfDay.toISOString().slice(0, 10), referredBy: referral ? { referralId: referral.id, status: referral.status, referrerName: referral.referrer.profile?.displayName ?? referral.referrer.username } : null, referrals: referrals.map((item) => ({ id: item.id, name: item.referred.profile?.displayName ?? item.referred.username, status: item.status, referredAdCount: item.referredAdCount, totalRewardedGld: item.totalRewardedGldDecimal, rewardCount: item.rewardCount, invitedAt: item.invitedAt, qualifiedAt: item.qualifiedAt })) })
  }

  updateConfig(dto: UpdateReferralConfigDto, adminId: string) { return this.updateConfigTransaction.run({ dto, adminId }).then((config) => this.serialize(config)) }

  async getAdminState(search = "") {
    const config = await this.prisma.referralConfig.upsert({ where: { singletonKey: "default" }, create: { singletonKey: "default" }, update: {} })
    const [total, active, qualified, capped, rewards, recent, players] = await this.prisma.$transaction([
      this.prisma.referral.count(),
      this.prisma.referral.count({ where: { status: ReferralStatus.ACTIVE } }),
      this.prisma.referral.count({ where: { status: ReferralStatus.QUALIFIED } }),
      this.prisma.referral.count({ where: { status: ReferralStatus.CAPPED } }),
      this.prisma.referralReward.aggregate({ _sum: { rewardAmountDecimal: true }, _count: { _all: true } }),
      this.prisma.referral.findMany({ orderBy: { createdAt: "desc" }, take: 100, select: { id: true, status: true, referredAdCount: true, totalRewardedGld: true, totalRewardedGldDecimal: true, rewardCount: true, createdAt: true, referrer: { select: { id: true, username: true, email: true, profile: { select: { displayName: true, avatarUrl: true } } } }, referred: { select: { id: true, username: true, email: true, profile: { select: { displayName: true, avatarUrl: true } } } } } }),
      this.prisma.user.findMany({
        where: search.trim() ? { OR: [{ username: { contains: search.trim(), mode: "insensitive" } }, { email: { contains: search.trim(), mode: "insensitive" } }, { profile: { displayName: { contains: search.trim(), mode: "insensitive" } } }] } : undefined,
        orderBy: { username: "asc" }, take: 50,
        select: { id: true, username: true, email: true, profile: { select: { displayName: true, avatarUrl: true } }, referralPolicyOverride: true },
      }),
    ])
    return this.serialize({ config, stats: { total, active, qualified, capped, rewardCount: rewards._count._all, totalRewardedGld: rewards._sum.rewardAmountDecimal ?? new Prisma.Decimal(0) }, referrals: recent.map((item) => ({ id: item.id, status: item.status, referredAdCount: item.referredAdCount, totalRewardedGld: item.totalRewardedGldDecimal, rewardCount: item.rewardCount, createdAt: item.createdAt, referrer: this.person(item.referrer), referred: this.person(item.referred) })), players: players.map((player) => ({ ...this.person(player), override: player.referralPolicyOverride })) })
  }

  async applyAdRewardShare(transaction: Prisma.TransactionClient, input: { referredUserId: string; adRewardClaimId: string; grossAmount: bigint; grossAmountDecimal?: string; currencyCode: string }) {
    const grossAmountDecimal = new Prisma.Decimal(input.grossAmountDecimal ?? input.grossAmount.toString())
    if (input.currencyCode.trim().toUpperCase() !== "GLD" || grossAmountDecimal.lte(0)) return { playerAmount: input.grossAmount, playerAmountDecimal: grossAmountDecimal.toString(), referralRewardAmount: 0n, referralRewardAmountDecimal: "0", referralId: null as string | null }
    const config = await transaction.referralConfig.findUnique({ where: { singletonKey: "default" } })
    const referral = await transaction.referral.findUnique({ where: { referredId: input.referredUserId }, select: { id: true, referrerId: true, referredId: true, status: true, referredAdCount: true, totalRewardedGld: true, totalRewardedGldDecimal: true, qualifiedAt: true, cappedAt: true } })
    const override = referral ? await transaction.referralPlayerOverride.findUnique({ where: { userId: referral.referrerId } }) : null
    const effective = this.effectiveConfig(config, override)
    if (!effective.enabled || !referral || referral.status === ReferralStatus.REVOKED) return { playerAmount: input.grossAmount, playerAmountDecimal: grossAmountDecimal.toString(), referralRewardAmount: 0n, referralRewardAmountDecimal: "0", referralId: referral?.id ?? null }

    const referredAdCount = referral.referredAdCount + 1
    const cap = new Prisma.Decimal(effective.maxRewardPerReferral.toString())
    const remainingCap = cap.gt(referral.totalRewardedGldDecimal) ? cap.sub(referral.totalRewardedGldDecimal) : new Prisma.Decimal(0)
    let reward = referredAdCount >= effective.minQualifyingAds ? grossAmountDecimal.mul(effective.rewardBps.toString()).div(10_000) : new Prisma.Decimal(0)
    if (reward.gt(remainingCap)) reward = remainingCap
    const qualified = referredAdCount >= effective.minQualifyingAds
    const capped = remainingCap.lte(0) || (qualified && reward.gte(remainingCap))
    const status = capped ? ReferralStatus.CAPPED : qualified ? ReferralStatus.QUALIFIED : ReferralStatus.ACTIVE
    const rewardLegacy = BigInt(reward.floor().toFixed(0))
    await transaction.referral.update({ where: { id: referral.id }, data: { referredAdCount, status, ...(qualified && !referral.qualifiedAt ? { qualifiedAt: new Date() } : {}), ...(capped && !referral.cappedAt ? { cappedAt: new Date() } : {}), ...(reward.gt(0) ? { totalRewardedGld: { increment: rewardLegacy }, totalRewardedGldDecimal: { increment: reward }, rewardCount: { increment: 1 } } : {}) } })
    if (reward.lte(0)) return { playerAmount: input.grossAmount, playerAmountDecimal: grossAmountDecimal.toString(), referralRewardAmount: 0n, referralRewardAmountDecimal: "0", referralId: referral.id }
    const rewardRow = await transaction.referralReward.create({ data: { referralId: referral.id, adRewardClaimId: input.adRewardClaimId, referrerId: referral.referrerId, referredId: referral.referredId, grossAdReward: input.grossAmount, rewardAmount: rewardLegacy, grossAdRewardDecimal: grossAmountDecimal, rewardAmountDecimal: reward } })
    await this.creditWallet.runWithinTransaction({ userId: referral.referrerId, currencyCode: "GLD", amount: rewardLegacy, amountDecimal: reward.toString(), sourceId: rewardRow.id, sourceType: WalletTransactionSourceType.REFERRAL, rewardGrantKey: `REFERRAL:${rewardRow.id}`, metadata: { referralId: referral.id, referredUserId: referral.referredId, adRewardClaimId: input.adRewardClaimId, grossAdReward: grossAmountDecimal.toString(), rewardBps: effective.rewardBps } }, transaction)
    await transaction.outboxEvent.create({ data: { eventType: "referral.rewarded", aggregateType: "ReferralReward", aggregateId: rewardRow.id, payload: { userId: referral.referrerId, referralId: referral.id, referredUserId: referral.referredId, amount: reward.toString(), grossAdReward: grossAmountDecimal.toString() } as unknown as Prisma.InputJsonValue } })
    const playerAmountDecimal = grossAmountDecimal.sub(reward)
    return { playerAmount: BigInt(playerAmountDecimal.floor().toFixed(0)), playerAmountDecimal: playerAmountDecimal.toString(), referralRewardAmount: rewardLegacy, referralRewardAmountDecimal: reward.toString(), referralId: referral.id }
  }

  async updatePlayerOverride(userId: string, dto: UpdateReferralPlayerOverrideDto, adminId: string) {
    return this.prisma.$transaction(async (tx) => {
      const player = await tx.user.findUnique({ where: { id: userId }, select: { id: true } })
      if (!player) throw new NotFoundException("Player account not found")
      if (dto.clear) {
        await tx.referralPlayerOverride.deleteMany({ where: { userId } })
        await writeAdminAudit(tx, { actorId: adminId, action: "REFERRAL_PLAYER_OVERRIDE_CLEARED", entityType: "User", entityId: userId, reason: dto.reason })
        return { userId, override: null }
      }
      const override = await tx.referralPlayerOverride.upsert({ where: { userId }, create: { userId }, update: {}, })
      const updated = await tx.referralPlayerOverride.update({ where: { id: override.id }, data: {
        ...(dto.enabled === undefined ? {} : { enabled: dto.enabled }),
        ...(dto.maxInvitesPerUser === undefined ? {} : { maxInvitesPerUser: dto.maxInvitesPerUser }),
        ...(dto.rewardBps === undefined ? {} : { rewardBps: dto.rewardBps }),
        ...(dto.maxRewardPerReferral === undefined ? {} : { maxRewardPerReferral: dto.maxRewardPerReferral === null ? null : BigInt(dto.maxRewardPerReferral) }),
        ...(dto.minQualifyingAds === undefined ? {} : { minQualifyingAds: dto.minQualifyingAds }),
        updatedById: adminId,
      } })
      await writeAdminAudit(tx, { actorId: adminId, action: "REFERRAL_PLAYER_OVERRIDE_UPDATED", entityType: "ReferralPlayerOverride", entityId: updated.id, reason: dto.reason, metadata: { userId, override: this.serialize(updated) } })
      return { userId, override: updated }
    }).then((value) => this.serialize(value))
  }

  private async ensureCode(userId: string) {
    const existing = await this.prisma.referralCode.findUnique({ where: { userId } })
    if (existing) return existing
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try { return await this.prisma.referralCode.create({ data: { userId, code: `SMARTS-${randomBytes(4).toString("hex").toUpperCase()}` } }) } catch (error) {
        if (attempt === 2) throw error
      }
    }
    throw new NotFoundException("Unable to create referral code")
  }

  private person(person: any) { return { id: person.id, username: person.username, email: person.email, name: person.profile?.displayName ?? person.username, avatarUrl: person.profile?.avatarUrl ?? null } }
  private playStoreReferralLink(code: string) {
    const configuredStoreUrl = process.env.SMARTS_PLAY_STORE_URL?.trim()
    const storeUrl = configuredStoreUrl || "https://play.google.com/store/apps/details?id=com.pheonix.gaemverse"
    const separator = storeUrl.includes("?") ? "&" : "?"
    const referrer = new URLSearchParams({ referral_code: code, source: "smarts" }).toString()
    return `${storeUrl}${separator}referrer=${encodeURIComponent(referrer)}`
  }
  private effectiveConfig(config: any, override: any) {
    return {
      enabled: override?.enabled ?? config?.enabled ?? true,
      maxInvitesPerUser: override?.maxInvitesPerUser ?? config?.maxInvitesPerUser ?? 25,
      rewardBps: override?.rewardBps ?? config?.rewardBps ?? 1000,
      maxRewardPerReferral: override?.maxRewardPerReferral ?? config?.maxRewardPerReferral ?? 1000n,
      minQualifyingAds: override?.minQualifyingAds ?? config?.minQualifyingAds ?? 1,
    }
  }
  private serialize<T>(value: T): T { return JSON.parse(JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item)) as T }
}
