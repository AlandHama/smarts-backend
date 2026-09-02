import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common"
import { createHash } from "node:crypto"
import { Prisma, ProgressionEventSourceType, ProgressionRewardType, RewardGrantStatus, WalletTransactionDirection, WalletTransactionSourceType } from "@prisma/client"

import { PrismaTransaction } from "../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../prisma.service"
import { writeAdminAudit } from "../../../common/helpers/admin-audit"

export type AwardProgressionInput = {
  userId: string
  progressionKey: string
  amount: bigint
  sourceId: string
  sourceType: ProgressionEventSourceType
  metadata?: Record<string, unknown>
  actorId?: string
  reason?: string
}

export type ProgressionAwardResult = {
  progression: {
    key: string
    points: string
    step: number
    previousThreshold: string
    nextThreshold: string | null
  }
  pointsBefore: string
  pointsAfter: string
  delta: string
  previousStep: number
  step: number
  nextThreshold: string | null
  crossedTiers: number[]
  crossedTierDetails: Array<{ step: number; name: string | null; threshold: string }>
  rewardsGranted: Array<{ grantKey: string; rewardType: ProgressionRewardType; amount: string | null; targetKey: string | null; status: RewardGrantStatus }>
}

@Injectable()
export class AwardProgressionPointsTransaction extends PrismaTransaction<AwardProgressionInput, ProgressionAwardResult> {
  constructor(prisma: PrismaService) { super(prisma) }

  protected async execute(input: AwardProgressionInput, transaction: Prisma.TransactionClient): Promise<ProgressionAwardResult> {
    if (!input.sourceId.trim()) throw new BadRequestException("A source id is required")
    const key = input.progressionKey.trim().toLowerCase()
    const progression = await transaction.progressionDefinition.findUnique({
      where: { key },
      include: { tiers: { orderBy: { pointsThreshold: "asc" }, include: { rewards: { orderBy: { sortOrder: "asc" } } } } },
    })
    if (!progression) throw new NotFoundException("Progression definition not found")
    if (!progression.active) throw new BadRequestException("Progression is inactive")
    if (!progression.tiers.length) throw new BadRequestException("Progression has no tiers")
    if (!progression.allowNegative && input.amount < 0n) throw new BadRequestException("This progression does not allow negative points")

    const idemScope = `progression-award:${input.userId}:${key}`
    const idemKey = input.sourceId.trim()
    const requestHash = createHash("sha256").update(JSON.stringify({ userId: input.userId, key, amount: input.amount.toString(), sourceType: input.sourceType, metadata: input.metadata ?? null })).digest("hex")
    const idempotency = await transaction.idempotencyKey.upsert({
      where: { scope_key: { scope: idemScope, key: idemKey } },
      create: { userId: input.userId, scope: idemScope, key: idemKey, requestHash, status: "PROCESSING" },
      update: {},
    })
    if (idempotency.requestHash !== requestHash) throw new ConflictException("The source id was already used for a different progression award")
    if (idempotency.status === "COMPLETED" && idempotency.responseJson) return idempotency.responseJson as unknown as ProgressionAwardResult
    if (idempotency.status === "PROCESSING" && idempotency.responseJson) throw new ConflictException("The progression award is already being processed")

    const pointsGrantKey = `${input.sourceType}:${input.sourceId.trim()}:${progression.key}:points`
    const pointsGrant = input.amount > 0n
      ? await transaction.rewardGrant.upsert({
        where: { grantKey: pointsGrantKey },
        create: { userId: input.userId, sourceType: input.sourceType as unknown as WalletTransactionSourceType, sourceId: input.sourceId.trim(), rewardType: ProgressionRewardType.PROGRESSION_POINTS, grantKey: pointsGrantKey, progressionDefinitionId: progression.id, amount: input.amount, status: "PENDING", policyVersion: "progression-v1", idempotencyKeyId: idempotency.id, metadata: input.metadata as Prisma.InputJsonValue | undefined },
        update: {},
      })
      : null
    const result = await this.applyPoints(transaction, input.userId, progression, input.amount, input.sourceType, input.sourceId.trim(), input.metadata, idempotency.id, new Set<string>())
    if (pointsGrant) await transaction.rewardGrant.update({ where: { id: pointsGrant.id }, data: { status: "GRANTED" } })
    await transaction.idempotencyKey.update({ where: { id: idempotency.id }, data: { status: "COMPLETED", responseJson: result as unknown as Prisma.InputJsonValue, completedAt: new Date() } })
    if (input.actorId) await writeAdminAudit(transaction, { actorId: input.actorId, action: "PROGRESSION_AWARD", entityType: "User", entityId: input.userId, reason: input.reason, metadata: { progressionKey: key, amount: input.amount.toString(), sourceId: input.sourceId } })
    return result
  }

  private async applyPoints(
    transaction: Prisma.TransactionClient,
    userId: string,
    progression: any,
    delta: bigint,
    sourceType: ProgressionEventSourceType,
    sourceId: string,
    metadata: Record<string, unknown> | undefined,
    idempotencyKeyId: string | undefined,
    visited: Set<string>,
  ): Promise<ProgressionAwardResult> {
    if (visited.has(progression.id)) throw new BadRequestException("Progression reward cycle detected")
    visited.add(progression.id)
    const firstTier = progression.tiers[0]
    if (firstTier.step !== 1 || firstTier.pointsThreshold !== 0n) throw new BadRequestException("The first progression tier must be step 1 with a 0 threshold")

    let row = await transaction.playerProgression.findUnique({ where: { userId_progressionId: { userId, progressionId: progression.id } } })
    if (!row) {
      row = await transaction.playerProgression.create({ data: { userId, progressionId: progression.id, points: 0n, step: 1, previousThreshold: 0n, nextThreshold: progression.tiers[1]?.pointsThreshold ?? null } })
    }
    await transaction.$queryRaw`SELECT "id" FROM "PlayerProgression" WHERE "id" = ${row.id} FOR UPDATE`
    row = await transaction.playerProgression.findUniqueOrThrow({ where: { id: row.id } })
    const before = row.points
    const after = before + delta
    if (!progression.allowNegative && after < 0n) throw new BadRequestException("Progression points cannot become negative")
    const currentTierIndex = this.tierIndex(progression.tiers, after)
    const currentTier = progression.tiers[currentTierIndex]
    const previousStep = row.step
    const crossedTiers = delta > 0n
      ? progression.tiers.filter((tier: any) => tier.pointsThreshold > before && tier.pointsThreshold <= after)
      : []
    const updated = await transaction.playerProgression.update({
      where: { id: row.id },
      data: {
        points: after,
        step: currentTier.step,
        previousThreshold: currentTier.pointsThreshold,
        nextThreshold: progression.tiers[currentTierIndex + 1]?.pointsThreshold ?? null,
        ...(crossedTiers.length ? { lastLevelUpAt: new Date() } : {}),
      },
    })
    await transaction.progressionEvent.create({ data: {
      userId,
      progressionId: progression.id,
      playerRowId: updated.id,
      delta,
      balanceBefore: before,
      balanceAfter: after,
      sourceType,
      sourceId,
      idempotencyKeyId,
      metadata: metadata as Prisma.InputJsonValue | undefined,
    } })
    await this.syncLegacyProfile(transaction, userId, progression.key, progression.kind, currentTier.step, after)

    const rewardsGranted: ProgressionAwardResult["rewardsGranted"] = []
    for (const tier of crossedTiers) {
      for (const reward of tier.rewards) {
        rewardsGranted.push(await this.grantReward(transaction, userId, progression, tier, reward, sourceType, sourceId, idempotencyKeyId, visited))
      }
    }
    visited.delete(progression.id)
    return {
      progression: { key: progression.key, points: after.toString(), step: currentTier.step, previousThreshold: currentTier.pointsThreshold.toString(), nextThreshold: progression.tiers[currentTierIndex + 1]?.pointsThreshold?.toString() ?? null },
      pointsBefore: before.toString(),
      pointsAfter: after.toString(),
      delta: delta.toString(),
      previousStep,
      step: currentTier.step,
      nextThreshold: progression.tiers[currentTierIndex + 1]?.pointsThreshold?.toString() ?? null,
      crossedTiers: crossedTiers.map((tier: any) => tier.step),
      crossedTierDetails: crossedTiers.map((tier: any) => ({ step: tier.step, name: tier.name, threshold: tier.pointsThreshold.toString() })),
      rewardsGranted,
    }
  }

  private tierIndex(tiers: any[], points: bigint) {
    let index = 0
    for (let i = 0; i < tiers.length; i += 1) if (tiers[i].pointsThreshold <= points) index = i
    return index
  }

  private async grantReward(transaction: Prisma.TransactionClient, userId: string, progression: any, tier: any, reward: any, sourceType: ProgressionEventSourceType, sourceId: string, idempotencyKeyId: string | undefined, visited: Set<string>) {
    const grantKey = `${sourceType}:${sourceId}:${progression.key}:${tier.step}:${reward.id}`
    const existing = await transaction.rewardGrant.findUnique({ where: { grantKey } })
    if (existing) return { grantKey, rewardType: existing.rewardType, amount: existing.amount?.toString() ?? null, targetKey: existing.targetKey, status: existing.status }
    const grant = await transaction.rewardGrant.create({ data: {
      userId,
      sourceType: sourceType as unknown as WalletTransactionSourceType,
      sourceId,
      rewardType: reward.rewardType,
      grantKey,
      progressionDefinitionId: progression.id,
      currencyId: reward.currencyId,
      amount: reward.amount,
      targetKey: reward.targetKey,
      status: "PENDING",
      policyVersion: "phase2-v1",
      idempotencyKeyId,
    } })
    if (reward.rewardType === ProgressionRewardType.CURRENCY) {
      if (!reward.currencyId || !reward.amount || reward.amount <= 0n) throw new BadRequestException("Currency reward is not configured correctly")
      await this.creditCurrency(transaction, userId, reward.currencyId, reward.amount, grantKey, sourceId)
    } else if (reward.rewardType === ProgressionRewardType.PROGRESSION_POINTS) {
      if (!reward.targetProgressionId || !reward.amount || reward.amount <= 0n) throw new BadRequestException("Progression point reward is not configured correctly")
      const target = await transaction.progressionDefinition.findUnique({ where: { id: reward.targetProgressionId }, include: { tiers: { orderBy: { pointsThreshold: "asc" }, include: { rewards: { orderBy: { sortOrder: "asc" } } } } } })
      if (!target) throw new NotFoundException("Target progression definition not found")
      await this.applyPoints(transaction, userId, target, reward.amount, "SYSTEM", `${grantKey}:points`, undefined, idempotencyKeyId, visited)
    } else if (reward.rewardType === ProgressionRewardType.PROGRESSION_RESET) {
      if (!reward.targetProgressionId) throw new BadRequestException("Progression reset reward is not configured correctly")
      await this.resetProgression(transaction, userId, reward.targetProgressionId, `${grantKey}:reset`, idempotencyKeyId)
    } else {
      throw new BadRequestException("This reward type is not available in Phase 2")
    }
    const completed = await transaction.rewardGrant.update({ where: { id: grant.id }, data: { status: "GRANTED" } })
    return { grantKey, rewardType: completed.rewardType, amount: completed.amount?.toString() ?? null, targetKey: completed.targetKey, status: completed.status }
  }

  private async creditCurrency(transaction: Prisma.TransactionClient, userId: string, currencyId: string, amount: bigint, grantKey: string, sourceId: string) {
    const wallet = await transaction.wallet.findUnique({ where: { userId }, select: { id: true, status: true } })
    if (!wallet || wallet.status !== "ACTIVE") throw new BadRequestException("Player wallet is not active")
    const balance = await transaction.walletBalance.findUnique({ where: { walletId_currencyId: { walletId: wallet.id, currencyId } } })
    if (!balance) throw new BadRequestException("Player wallet does not contain this currency")
    await transaction.$queryRaw`SELECT "id" FROM "WalletBalance" WHERE "id" = ${balance.id} FOR UPDATE`
    const locked = await transaction.walletBalance.findUniqueOrThrow({ where: { id: balance.id } })
    const after = locked.amount + amount
    await transaction.walletBalance.update({ where: { id: locked.id }, data: { amount: after, version: { increment: 1n } } })
    await transaction.walletTransaction.create({ data: { walletId: wallet.id, currencyId, direction: WalletTransactionDirection.CREDIT, amount, balanceBefore: locked.amount, balanceAfter: after, sourceType: sourceId.startsWith("admin") ? WalletTransactionSourceType.ADMIN : WalletTransactionSourceType.SYSTEM, sourceId, grantKey } })
  }

  private async resetProgression(transaction: Prisma.TransactionClient, userId: string, progressionId: string, sourceId: string, idempotencyKeyId: string | undefined) {
    const progression = await transaction.progressionDefinition.findUnique({ where: { id: progressionId }, include: { tiers: { orderBy: { pointsThreshold: "asc" } } } })
    if (!progression || !progression.tiers.length) throw new NotFoundException("Target progression definition not found")
    const row = await transaction.playerProgression.findUnique({ where: { userId_progressionId: { userId, progressionId } } })
    if (!row) return
    await transaction.$queryRaw`SELECT "id" FROM "PlayerProgression" WHERE "id" = ${row.id} FOR UPDATE`
    const reset = await transaction.playerProgression.update({ where: { id: row.id }, data: { points: 0n, step: progression.tiers[0].step, previousThreshold: progression.tiers[0].pointsThreshold, nextThreshold: progression.tiers[1]?.pointsThreshold ?? null, lastLevelUpAt: new Date() } })
    await transaction.progressionEvent.create({ data: { userId, progressionId, playerRowId: reset.id, delta: -row.points, balanceBefore: row.points, balanceAfter: 0n, sourceType: "SYSTEM", sourceId, idempotencyKeyId } })
  }

  private async syncLegacyProfile(transaction: Prisma.TransactionClient, userId: string, key: string, kind: string, step: number, points: bigint) {
    if (key === "main" && kind === "LEVEL") await transaction.playerProfile.update({ where: { userId }, data: { level: step, xp: points } })
    if (key === "elo" && kind === "RATING" && points <= 2147483647n && points >= -2147483648n) await transaction.playerProfile.update({ where: { userId }, data: { elo: Number(points) } })
  }
}
