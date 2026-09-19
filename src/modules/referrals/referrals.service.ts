import { Injectable, NotFoundException } from "@nestjs/common"
import { randomBytes } from "node:crypto"
import { Prisma, ReferralStatus, WalletTransactionSourceType } from "@prisma/client"

import { PrismaService } from "../../prisma.service"
import { writeAdminAudit } from "../../common/helpers/admin-audit"
import { CreditWalletTransaction } from "../economy/transactions/credit-wallet-transaction"
import { ClaimReferralTransaction } from "./transactions/claim-referral-transaction"
import { UpdateReferralConfigTransaction } from "./transactions/update-referral-config-transaction"
import { ClaimReferralDto, UpdateReferralConfigDto, UpdateReferralPlayerOverrideDto } from "./dtos"

@Injectable()
export class ReferralsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly claimTransaction: ClaimReferralTransaction,
    private readonly updateConfigTransaction: UpdateReferralConfigTransaction,
    private readonly creditWallet: CreditWalletTransaction,
  ) {}

  claim(userId: string, dto: ClaimReferralDto) { return this.claimTransaction.run({ userId, dto }) }

  async getForUser(userId: string) {
    const [config, override] = await Promise.all([
      this.prisma.referralConfig.upsert({ where: { singletonKey: "default" }, create: { singletonKey: "default" }, update: {} }),
      this.prisma.referralPlayerOverride.findUnique({ where: { userId } }),
    ])
    const effective = this.effectiveConfig(config, override)
    const code = await this.ensureCode(userId)
    const [referrals, referral] = await Promise.all([
      this.prisma.referral.findMany({ where: { referrerId: userId }, orderBy: { createdAt: "desc" }, take: 100, select: { id: true, status: true, referredAdCount: true, totalRewardedGld: true, rewardCount: true, invitedAt: true, qualifiedAt: true, referred: { select: { username: true, profile: { select: { displayName: true } } } } } }),
      this.prisma.referral.findUnique({ where: { referredId: userId }, select: { id: true, status: true, referrer: { select: { username: true, profile: { select: { displayName: true } } } } } }),
    ])
    const totalRewarded = referrals.reduce((sum, item) => sum + item.totalRewardedGld, 0n)
    const qualified = referrals.filter((item) => item.status === ReferralStatus.QUALIFIED || item.status === ReferralStatus.CAPPED).length
    return this.serialize({ enabled: effective.enabled, code: code.code, shareText: `Join SMARTS with referral code ${code.code}`, maxInvites: effective.maxInvitesPerUser, invitesUsed: code.inviteCount, invitesRemaining: Math.max(effective.maxInvitesPerUser - code.inviteCount, 0), rewardBps: effective.rewardBps, rewardPercent: effective.rewardBps / 100, maxRewardPerReferral: effective.maxRewardPerReferral, minQualifyingAds: effective.minQualifyingAds, personalized: Boolean(override), settingsSource: override ? "PLAYER" : "GLOBAL", referralsCount: referrals.length, qualifiedCount: qualified, totalRewardedGld: totalRewarded, referredBy: referral ? { referralId: referral.id, status: referral.status, referrerName: referral.referrer.profile?.displayName ?? referral.referrer.username } : null, referrals: referrals.map((item) => ({ id: item.id, name: item.referred.profile?.displayName ?? item.referred.username, status: item.status, referredAdCount: item.referredAdCount, totalRewardedGld: item.totalRewardedGld, rewardCount: item.rewardCount, invitedAt: item.invitedAt, qualifiedAt: item.qualifiedAt })) })
  }

  updateConfig(dto: UpdateReferralConfigDto, adminId: string) { return this.updateConfigTransaction.run({ dto, adminId }).then((config) => this.serialize(config)) }

  async getAdminState(search = "") {
    const config = await this.prisma.referralConfig.upsert({ where: { singletonKey: "default" }, create: { singletonKey: "default" }, update: {} })
    const [total, active, qualified, capped, rewards, recent, players] = await this.prisma.$transaction([
      this.prisma.referral.count(),
      this.prisma.referral.count({ where: { status: ReferralStatus.ACTIVE } }),
      this.prisma.referral.count({ where: { status: ReferralStatus.QUALIFIED } }),
      this.prisma.referral.count({ where: { status: ReferralStatus.CAPPED } }),
      this.prisma.referralReward.aggregate({ _sum: { rewardAmount: true }, _count: { _all: true } }),
      this.prisma.referral.findMany({ orderBy: { createdAt: "desc" }, take: 100, select: { id: true, status: true, referredAdCount: true, totalRewardedGld: true, rewardCount: true, createdAt: true, referrer: { select: { id: true, username: true, email: true, profile: { select: { displayName: true } } } }, referred: { select: { id: true, username: true, email: true, profile: { select: { displayName: true } } } } } }),
      this.prisma.user.findMany({
        where: search.trim() ? { OR: [{ username: { contains: search.trim(), mode: "insensitive" } }, { email: { contains: search.trim(), mode: "insensitive" } }, { profile: { displayName: { contains: search.trim(), mode: "insensitive" } } }] } : undefined,
        orderBy: { username: "asc" }, take: 50,
        select: { id: true, username: true, email: true, profile: { select: { displayName: true } }, referralPolicyOverride: true },
      }),
    ])
    return this.serialize({ config, stats: { total, active, qualified, capped, rewardCount: rewards._count._all, totalRewardedGld: rewards._sum.rewardAmount ?? 0n }, referrals: recent.map((item) => ({ id: item.id, status: item.status, referredAdCount: item.referredAdCount, totalRewardedGld: item.totalRewardedGld, rewardCount: item.rewardCount, createdAt: item.createdAt, referrer: this.person(item.referrer), referred: this.person(item.referred) })), players: players.map((player) => ({ ...this.person(player), override: player.referralPolicyOverride })) })
  }

  async applyAdRewardShare(transaction: Prisma.TransactionClient, input: { referredUserId: string; adRewardClaimId: string; grossAmount: bigint; currencyCode: string }) {
    if (input.currencyCode.trim().toUpperCase() !== "GLD" || input.grossAmount <= 0n) return { playerAmount: input.grossAmount, referralRewardAmount: 0n, referralId: null as string | null }
    const config = await transaction.referralConfig.findUnique({ where: { singletonKey: "default" } })
    const referral = await transaction.referral.findUnique({ where: { referredId: input.referredUserId }, select: { id: true, referrerId: true, referredId: true, status: true, referredAdCount: true, totalRewardedGld: true, qualifiedAt: true, cappedAt: true } })
    const override = referral ? await transaction.referralPlayerOverride.findUnique({ where: { userId: referral.referrerId } }) : null
    const effective = this.effectiveConfig(config, override)
    if (!effective.enabled || !referral || referral.status === ReferralStatus.REVOKED) return { playerAmount: input.grossAmount, referralRewardAmount: 0n, referralId: referral?.id ?? null }

    const referredAdCount = referral.referredAdCount + 1
    const remainingCap = effective.maxRewardPerReferral > referral.totalRewardedGld ? effective.maxRewardPerReferral - referral.totalRewardedGld : 0n
    let reward = referredAdCount >= effective.minQualifyingAds ? input.grossAmount * BigInt(effective.rewardBps) / 10_000n : 0n
    if (reward > remainingCap) reward = remainingCap
    const qualified = referredAdCount >= effective.minQualifyingAds
    const capped = remainingCap <= 0n || (qualified && reward >= remainingCap)
    const status = capped ? ReferralStatus.CAPPED : qualified ? ReferralStatus.QUALIFIED : ReferralStatus.ACTIVE
    await transaction.referral.update({ where: { id: referral.id }, data: { referredAdCount, status, ...(qualified && !referral.qualifiedAt ? { qualifiedAt: new Date() } : {}), ...(capped && !referral.cappedAt ? { cappedAt: new Date() } : {}), ...(reward > 0n ? { totalRewardedGld: { increment: reward }, rewardCount: { increment: 1 } } : {}) } })
    if (reward <= 0n) return { playerAmount: input.grossAmount, referralRewardAmount: 0n, referralId: referral.id }
    const rewardRow = await transaction.referralReward.create({ data: { referralId: referral.id, adRewardClaimId: input.adRewardClaimId, referrerId: referral.referrerId, referredId: referral.referredId, grossAdReward: input.grossAmount, rewardAmount: reward } })
    await this.creditWallet.runWithinTransaction({ userId: referral.referrerId, currencyCode: "GLD", amount: reward, sourceId: rewardRow.id, sourceType: WalletTransactionSourceType.REFERRAL, rewardGrantKey: `REFERRAL:${rewardRow.id}`, metadata: { referralId: referral.id, adRewardClaimId: input.adRewardClaimId, grossAdReward: input.grossAmount.toString(), rewardBps: effective.rewardBps } }, transaction)
    await transaction.outboxEvent.create({ data: { eventType: "referral.rewarded", aggregateType: "ReferralReward", aggregateId: rewardRow.id, payload: { userId: referral.referrerId, referralId: referral.id, referredUserId: referral.referredId, amount: reward.toString(), grossAdReward: input.grossAmount.toString() } as unknown as Prisma.InputJsonValue } })
    return { playerAmount: input.grossAmount - reward, referralRewardAmount: reward, referralId: referral.id }
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

  private person(person: any) { return { id: person.id, username: person.username, email: person.email, name: person.profile?.displayName ?? person.username } }
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
