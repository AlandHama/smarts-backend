import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common"
import { LeaderboardDirection, Prisma, ProgressionRewardType, WalletTransactionDirection, WalletTransactionSourceType } from "@prisma/client"

import { AwardProgressionPointsTransaction } from "../progression/transactions/award-progression-points-transaction"

type RewardRow = {
  id: string
  rank: number
  sortOrder: number
  rewardType: ProgressionRewardType
  currencyId: string | null
  assetDefinitionId: string | null
  assetVariationId: string | null
  amount: bigint | null
  targetKey: string | null
  metadata: Prisma.JsonValue | null
  currency?: { code: string; name: string } | null
  assetDefinition?: { key: string; name: string } | null
  assetVariation?: { key: string; name: string | null } | null
  progressionDefinition?: { key: string; name: string } | null
}

type EntryRow = { id: string; playerId: string | null; memberKey: string; score: bigint; rank: bigint }

@Injectable()
export class LeaderboardRewardService {
  constructor(private readonly awardProgression: AwardProgressionPointsTransaction) {}

  /** Settles all configured rewards for one season. The caller owns the
   * transaction so closing the season and granting rewards are atomic. */
  async settleSeasonInTransaction(transaction: Prisma.TransactionClient, seasonId: string) {
    const season = await transaction.leaderboardSeason.findUnique({
      where: { id: seasonId },
      include: { leaderboard: { include: { rewards: { orderBy: [{ rank: "asc" }, { sortOrder: "asc" }], include: { currency: { select: { code: true, name: true } }, assetDefinition: { select: { key: true, name: true } }, assetVariation: { select: { key: true, name: true } }, progressionDefinition: { select: { key: true, name: true } } } } } } },
    })
    if (!season) throw new NotFoundException("Leaderboard season not found")
    if (!season.leaderboard.rewards.length) return { seasonId, granted: 0, recipients: 0 }
    if (season.leaderboard.memberType !== "PLAYER") throw new BadRequestException("Only player leaderboards can distribute rewards")

    const order = season.leaderboard.direction === LeaderboardDirection.ASCENDING ? "ASC" : "DESC"
    const entries = await transaction.$queryRaw<EntryRow[]>(Prisma.sql`SELECT "id", "playerId", "memberKey", "score", RANK() OVER (ORDER BY "score" ${Prisma.raw(order)})::bigint AS "rank" FROM "LeaderboardEntry" WHERE "leaderboardId" = ${season.leaderboardId} AND "seasonId" = ${season.id}`)
    const byRank = new Map<string, EntryRow[]>()
    for (const entry of entries) {
      const key = entry.rank.toString()
      const bucket = byRank.get(key) ?? []
      bucket.push(entry)
      byRank.set(key, bucket)
    }

    const rewardsByUser = new Map<string, Array<Record<string, string | number | null>>>()
    let granted = 0
    for (const reward of season.leaderboard.rewards as RewardRow[]) {
      const rankedEntries = byRank.get(String(reward.rank)) ?? []
      for (const entry of rankedEntries) {
        if (!entry.playerId) continue
        const sourceId = `leaderboard:${season.leaderboard.key}:season:${season.id}:entry:${entry.id}:reward:${reward.id}`
        const grantKey = `LEADERBOARD:${season.id}:${entry.id}:${reward.id}`
        const existing = await transaction.rewardGrant.findUnique({ where: { grantKey }, select: { id: true } })
        if (!existing) {
          await transaction.rewardGrant.create({ data: { userId: entry.playerId, sourceType: WalletTransactionSourceType.SYSTEM, sourceId, rewardType: reward.rewardType, grantKey, currencyId: reward.currencyId, amount: reward.amount, targetKey: reward.targetKey, status: "PENDING", policyVersion: "leaderboard-rewards-v1", metadata: { ...(this.objectMetadata(reward.metadata)), leaderboardKey: season.leaderboard.key, seasonId: season.id, rank: reward.rank } } })
          await this.applyReward(transaction, entry.playerId, reward, sourceId, grantKey)
          await transaction.rewardGrant.update({ where: { grantKey }, data: { status: "GRANTED" } })
          granted += 1
        }
        const userRewards = rewardsByUser.get(entry.playerId) ?? []
        userRewards.push(this.serializeReward(reward))
        rewardsByUser.set(entry.playerId, userRewards)
      }
    }

    for (const [userId, rewards] of rewardsByUser) {
      const entry = entries.find((item) => item.playerId === userId)
      if (!entry) continue
      const existingEvent = await transaction.outboxEvent.findFirst({ where: { eventType: "leaderboard.reward.granted", aggregateType: "LeaderboardEntry", aggregateId: entry.id }, select: { id: true } })
      if (existingEvent) continue
      await transaction.outboxEvent.create({ data: { eventType: "leaderboard.reward.granted", aggregateType: "LeaderboardEntry", aggregateId: entry.id, payload: { userId, leaderboardKey: season.leaderboard.key, leaderboardName: season.leaderboard.name, seasonId: season.id, rank: Number(entry.rank), score: entry.score.toString(), rewards } as unknown as Prisma.InputJsonValue } })
    }
    return { seasonId, granted, recipients: rewardsByUser.size }
  }

  private async applyReward(transaction: Prisma.TransactionClient, userId: string, reward: RewardRow, sourceId: string, grantKey: string) {
    if (reward.rewardType === ProgressionRewardType.CURRENCY) {
      if (!reward.currencyId || !reward.amount || reward.amount <= 0n) throw new BadRequestException("Currency leaderboard reward is not configured correctly")
      const wallet = await transaction.wallet.findUnique({ where: { userId }, select: { id: true, status: true } })
      if (!wallet || wallet.status !== "ACTIVE") throw new BadRequestException("Player wallet is not active")
      const balance = await transaction.walletBalance.upsert({ where: { walletId_currencyId: { walletId: wallet.id, currencyId: reward.currencyId } }, create: { walletId: wallet.id, currencyId: reward.currencyId, amount: 0n }, update: {} })
      await transaction.$queryRaw`SELECT "id" FROM "WalletBalance" WHERE "id" = ${balance.id} FOR UPDATE`
      const locked = await transaction.walletBalance.findUniqueOrThrow({ where: { id: balance.id } })
      const after = locked.amount + reward.amount
      await transaction.walletBalance.update({ where: { id: locked.id }, data: { amount: after, version: { increment: 1n } } })
      await transaction.walletTransaction.create({ data: { walletId: wallet.id, currencyId: reward.currencyId, direction: WalletTransactionDirection.CREDIT, amount: reward.amount, balanceBefore: locked.amount, balanceAfter: after, sourceType: WalletTransactionSourceType.SYSTEM, sourceId, grantKey, metadata: { leaderboardReward: true } } })
      return
    }

    if (reward.rewardType === ProgressionRewardType.ASSET) {
      if (!reward.assetDefinitionId || !reward.amount || reward.amount <= 0n) throw new BadRequestException("Asset leaderboard reward is not configured correctly")
      const asset = await transaction.assetDefinition.findUnique({ where: { id: reward.assetDefinitionId }, select: { id: true, key: true, active: true, ownershipPolicy: true } })
      if (!asset || !asset.active) throw new NotFoundException("Leaderboard reward asset is not available")
      const stackKey = asset.ownershipPolicy === "STACKABLE" ? `${userId}:${asset.id}:${reward.assetVariationId ?? "base"}` : null
      if (stackKey) await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${stackKey}))`
      const existing = stackKey ? await transaction.inventoryItem.findFirst({ where: { stackKey }, select: { id: true, quantity: true } }) : null
      if (existing) await transaction.inventoryItem.update({ where: { id: existing.id }, data: { quantity: { increment: Number(reward.amount) }, sourceId, metadata: { leaderboardReward: true } } })
      else await transaction.inventoryItem.create({ data: { userId, assetDefinitionId: asset.id, assetVariationId: reward.assetVariationId, quantity: Number(reward.amount), stackKey, acquisitionSource: "SYSTEM", sourceId, metadata: { leaderboardReward: true } } })
      return
    }

    if (reward.rewardType === ProgressionRewardType.ENTITLEMENT) {
      if (!reward.targetKey) throw new BadRequestException("Entitlement leaderboard reward is not configured correctly")
      await transaction.entitlement.upsert({ where: { userId_entitlementKey: { userId, entitlementKey: reward.targetKey } }, create: { userId, entitlementKey: reward.targetKey, assetDefinitionId: reward.assetDefinitionId, status: "ACTIVE", sourceType: "LEADERBOARD", sourceId, metadata: { leaderboardReward: true } }, update: { assetDefinitionId: reward.assetDefinitionId, status: "ACTIVE", sourceType: "LEADERBOARD", sourceId, metadata: { leaderboardReward: true } } })
      return
    }

    if (reward.rewardType === ProgressionRewardType.PROGRESSION_POINTS) {
      if (!reward.progressionDefinition || !reward.amount || reward.amount <= 0n) throw new BadRequestException("Progression leaderboard reward is not configured correctly")
      await this.awardProgression.runWithinTransaction({ userId, progressionKey: reward.progressionDefinition.key, amount: reward.amount, sourceId, sourceType: "SYSTEM", metadata: { leaderboardReward: true, grantKey } }, transaction)
      return
    }

    throw new BadRequestException(`Leaderboard reward type ${reward.rewardType} is not supported`)
  }

  private serializeReward(reward: RewardRow) {
    return { rewardType: reward.rewardType, amount: reward.amount?.toString() ?? null, targetKey: reward.targetKey, currencyCode: reward.currency?.code ?? null, currencyName: reward.currency?.name ?? null, assetKey: reward.assetDefinition?.key ?? null, assetName: reward.assetDefinition?.name ?? null, variationKey: reward.assetVariation?.key ?? null, variationName: reward.assetVariation?.name ?? null, progressionKey: reward.progressionDefinition?.key ?? null, progressionName: reward.progressionDefinition?.name ?? null }
  }

  private objectMetadata(value: Prisma.JsonValue | null) { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {} }
}
