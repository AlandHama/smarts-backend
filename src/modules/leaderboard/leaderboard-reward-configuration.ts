import { BadRequestException, NotFoundException } from "@nestjs/common"
import { LeaderboardMemberType, Prisma, ProgressionRewardType } from "@prisma/client"

import { LeaderboardRewardDto } from "./dtos"

type Transaction = Prisma.TransactionClient

/** Validates and replaces the editable payout schedule in the same transaction
 * as the leaderboard definition. References are stored by id, while keys are
 * accepted at the API boundary so admin configuration remains readable. */
export async function replaceLeaderboardRewards(
  transaction: Transaction,
  leaderboardId: string,
  memberType: LeaderboardMemberType,
  rewards: LeaderboardRewardDto[],
) {
  if (rewards.length && memberType !== LeaderboardMemberType.PLAYER) {
    throw new BadRequestException("Leaderboard rewards can only be configured for player leaderboards")
  }

  const rows: Prisma.LeaderboardRewardCreateManyInput[] = []
  for (const [sortOrder, reward] of rewards.entries()) {
    const rewardType = reward.rewardType
    const base = {
      leaderboardId,
      rank: reward.rank,
      sortOrder,
      rewardType,
      metadata: reward.metadata as Prisma.InputJsonValue | undefined,
    }

    if (rewardType === ProgressionRewardType.CURRENCY) {
      const currencyCode = reward.currencyCode?.trim().toUpperCase()
      if (!currencyCode || !reward.amount) throw new BadRequestException("Currency rewards require currencyCode and amount")
      const amount = BigInt(reward.amount)
      if (amount <= 0n) throw new BadRequestException("Leaderboard reward amounts must be positive")
      const currency = await transaction.currencyDefinition.findUnique({ where: { code: currencyCode }, select: { id: true, active: true } })
      if (!currency || !currency.active) throw new NotFoundException(`Currency ${currencyCode} was not found or is inactive`)
      rows.push({ ...base, currencyId: currency.id, amount, targetKey: currencyCode })
      continue
    }

    if (rewardType === ProgressionRewardType.ASSET) {
      const assetKey = reward.assetKey?.trim().toLowerCase()
      if (!assetKey) throw new BadRequestException("Asset rewards require assetKey")
      const asset = await transaction.assetDefinition.findUnique({ where: { key: assetKey }, select: { id: true, key: true, active: true } })
      if (!asset || !asset.active) throw new NotFoundException(`Asset ${assetKey} was not found or is inactive`)
      const variationKey = reward.variationKey?.trim().toLowerCase()
      const variation = variationKey
        ? await transaction.assetVariation.findUnique({ where: { assetDefinitionId_key: { assetDefinitionId: asset.id, key: variationKey } }, select: { id: true, active: true } })
        : null
      if (variationKey && (!variation || !variation.active)) throw new NotFoundException(`Asset variation ${variationKey} was not found or is inactive`)
      const quantity = reward.quantity ?? 1
      rows.push({ ...base, assetDefinitionId: asset.id, assetVariationId: variation?.id, amount: BigInt(quantity), targetKey: asset.key })
      continue
    }

    if (rewardType === ProgressionRewardType.ENTITLEMENT) {
      const targetKey = reward.targetKey?.trim()
      if (!targetKey) throw new BadRequestException("Entitlement rewards require targetKey")
      let assetDefinitionId: string | undefined
      if (reward.assetKey) {
        const asset = await transaction.assetDefinition.findUnique({ where: { key: reward.assetKey.trim().toLowerCase() }, select: { id: true, active: true } })
        if (!asset || !asset.active) throw new NotFoundException("Entitlement asset is not found or inactive")
        assetDefinitionId = asset.id
      }
      rows.push({ ...base, targetKey, assetDefinitionId })
      continue
    }

    if (rewardType === ProgressionRewardType.PROGRESSION_POINTS) {
      const progressionKey = reward.progressionKey?.trim().toLowerCase()
      if (!progressionKey || !reward.amount) throw new BadRequestException("Progression rewards require progressionKey and amount")
      const amount = BigInt(reward.amount)
      if (amount <= 0n) throw new BadRequestException("Leaderboard reward amounts must be positive")
      const progression = await transaction.progressionDefinition.findUnique({ where: { key: progressionKey }, select: { id: true, key: true, active: true } })
      if (!progression || !progression.active) throw new NotFoundException(`Progression ${progressionKey} was not found or is inactive`)
      rows.push({ ...base, progressionDefinitionId: progression.id, amount, targetKey: progression.key })
      continue
    }

    throw new BadRequestException(`Leaderboard reward type ${rewardType} is not supported; use CURRENCY, ASSET, ENTITLEMENT, or PROGRESSION_POINTS`)
  }

  await transaction.leaderboardReward.deleteMany({ where: { leaderboardId } })
  if (rows.length) await transaction.leaderboardReward.createMany({ data: rows })
}
