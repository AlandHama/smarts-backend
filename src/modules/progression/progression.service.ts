import { Injectable, NotFoundException } from "@nestjs/common"
import { ProgressionEventSourceType } from "@prisma/client"

import { PrismaService } from "../../prisma.service"
import { CreateProgressionDto, CreateProgressionRewardDto, CreateProgressionTierDto, UpdateProgressionDto, UpdateProgressionRewardDto, UpdateProgressionTierDto } from "./dtos"
import { AwardProgressionPointsTransaction } from "./transactions/award-progression-points-transaction"
import { CreateProgressionRewardTransaction } from "./transactions/create-progression-reward-transaction"
import { CreateProgressionTierTransaction } from "./transactions/create-progression-tier-transaction"
import { CreateProgressionTransaction } from "./transactions/create-progression-transaction"
import { DeleteProgressionRewardTransaction } from "./transactions/delete-progression-reward-transaction"
import { DeleteProgressionTierTransaction } from "./transactions/delete-progression-tier-transaction"
import { ResetPlayerProgressionTransaction } from "./transactions/reset-player-progression-transaction"
import { UpdateProgressionRewardTransaction } from "./transactions/update-progression-reward-transaction"
import { UpdateProgressionTierTransaction } from "./transactions/update-progression-tier-transaction"
import { UpdateProgressionTransaction } from "./transactions/update-progression-transaction"

@Injectable()
export class ProgressionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly createProgressionTransaction: CreateProgressionTransaction,
    private readonly updateProgressionTransaction: UpdateProgressionTransaction,
    private readonly createTierTransaction: CreateProgressionTierTransaction,
    private readonly updateTierTransaction: UpdateProgressionTierTransaction,
    private readonly deleteTierTransaction: DeleteProgressionTierTransaction,
    private readonly createRewardTransaction: CreateProgressionRewardTransaction,
    private readonly updateRewardTransaction: UpdateProgressionRewardTransaction,
    private readonly deleteRewardTransaction: DeleteProgressionRewardTransaction,
    private readonly awardTransaction: AwardProgressionPointsTransaction,
    private readonly resetTransaction: ResetPlayerProgressionTransaction,
  ) {}

  async getForPlayer(userId: string) {
    const rows = await this.prisma.playerProgression.findMany({
      where: { userId, progression: { active: true } },
      orderBy: { progression: { key: "asc" } },
      take: 100,
      include: { progression: { select: { key: true, name: true, kind: true, active: true } } },
    })
    return rows.map((row) => this.serialize({
      progression_key: row.progression.key,
      progression_name: row.progression.name,
      progression_kind: row.progression.kind,
      points: row.points,
      step: row.step,
      previous_threshold: row.previousThreshold,
      next_threshold: row.nextThreshold,
      last_level_up_at: row.lastLevelUpAt,
    }))
  }

  async getPlayerProgression(userId: string, key: string) {
    const row = await this.prisma.playerProgression.findFirst({ where: { userId, progression: { key: key.trim().toLowerCase(), active: true } }, include: { progression: { select: { key: true, name: true, kind: true, active: true } } } })
    if (!row) throw new NotFoundException("Player progression not found")
    return this.serialize({ progression_key: row.progression.key, progression_name: row.progression.name, progression_kind: row.progression.kind, points: row.points, step: row.step, previous_threshold: row.previousThreshold, next_threshold: row.nextThreshold, last_level_up_at: row.lastLevelUpAt })
  }

  async getTiers(key: string, limit = 25, offset = 0) {
    const progression = await this.prisma.progressionDefinition.findUnique({ where: { key: key.trim().toLowerCase() }, select: { id: true, key: true, name: true, active: true } })
    if (!progression || !progression.active) throw new NotFoundException("Progression definition not found")
    const safeLimit = Math.min(Math.max(limit, 1), 100)
    const [total, items] = await this.prisma.$transaction([
      this.prisma.progressionTier.count({ where: { progressionId: progression.id } }),
      this.prisma.progressionTier.findMany({ where: { progressionId: progression.id }, orderBy: { step: "asc" }, skip: Math.max(offset, 0), take: safeLimit, include: { rewards: { orderBy: { sortOrder: "asc" }, include: { targetProgression: { select: { key: true, name: true } }, currency: { select: { code: true, name: true } } } } } }),
    ])
    return this.serialize({ progression_key: progression.key, progression_name: progression.name, items, pagination: { total, limit: safeLimit, offset: Math.max(offset, 0), next_offset: offset + safeLimit < total ? offset + safeLimit : null } })
  }

  listDefinitions(includeInactive = false) {
    return this.prisma.progressionDefinition.findMany({ where: includeInactive ? undefined : { active: true }, orderBy: { key: "asc" }, take: 100, include: { tiers: { orderBy: { step: "asc" }, take: 500, include: { rewards: { orderBy: { sortOrder: "asc" }, include: { targetProgression: { select: { key: true, name: true } }, currency: { select: { code: true, name: true } } } } } } } }).then((items) => this.serialize(items))
  }

  async getDefinition(id: string) {
    const item = await this.prisma.progressionDefinition.findUnique({ where: { id }, include: { tiers: { orderBy: { step: "asc" }, include: { rewards: { orderBy: { sortOrder: "asc" }, include: { targetProgression: { select: { key: true, name: true } }, currency: { select: { code: true, name: true } } } } } } } })
    if (!item) throw new NotFoundException("Progression definition not found")
    return this.serialize(item)
  }

  createDefinition(dto: CreateProgressionDto) { return this.createProgressionTransaction.run(dto).then((item) => this.serialize(item)) }
  updateDefinition(id: string, dto: UpdateProgressionDto) { return this.updateProgressionTransaction.run({ id, dto }).then((item) => this.serialize(item)) }
  createTier(progressionId: string, dto: CreateProgressionTierDto) { return this.createTierTransaction.run({ progressionId, dto }).then((item) => this.serialize(item)) }
  updateTier(id: string, dto: UpdateProgressionTierDto) { return this.updateTierTransaction.run({ id, dto }).then((item) => this.serialize(item)) }
  deleteTier(id: string) { return this.deleteTierTransaction.run(id).then(() => ({ message: "Progression tier deleted" })) }
  createReward(tierId: string, dto: CreateProgressionRewardDto) { return this.createRewardTransaction.run({ tierId, dto }).then((item) => this.serialize(item)) }
  updateReward(id: string, dto: UpdateProgressionRewardDto) { return this.updateRewardTransaction.run({ id, dto }).then((item) => this.serialize(item)) }
  deleteReward(id: string) { return this.deleteRewardTransaction.run(id).then(() => ({ message: "Progression reward deleted" })) }

  awardAdmin(userId: string, progressionKey: string, amount: bigint, sourceId: string, metadata?: Record<string, unknown>) {
    return this.awardTransaction.run({ userId, progressionKey, amount, sourceId, sourceType: ProgressionEventSourceType.ADMIN, metadata })
  }

  resetAdmin(userId: string, progressionKey: string, sourceId: string) {
    return this.resetTransaction.run({ userId, progressionKey, sourceId })
  }

  async topPlayers(key: string, limit = 10) {
    const progression = await this.prisma.progressionDefinition.findUnique({ where: { key: key.trim().toLowerCase() }, select: { id: true, key: true, name: true } })
    if (!progression) throw new NotFoundException("Progression definition not found")
    const rows = await this.prisma.playerProgression.findMany({ where: { progressionId: progression.id, user: { status: "ACTIVE" } }, orderBy: [{ points: "desc" }, { updatedAt: "asc" }, { userId: "asc" }], take: Math.min(Math.max(limit, 1), 100), select: { userId: true, points: true, step: true, user: { select: { username: true, profile: { select: { displayName: true, avatarUrl: true, countryCode: true } } } } } })
    let rank = 0
    let previousPoints: bigint | undefined
    return this.serialize(rows.map((row, index) => {
      if (previousPoints === undefined || row.points !== previousPoints) rank = index + 1
      previousPoints = row.points
      return { rank, playerId: row.userId, username: row.user.username, displayName: row.user.profile?.displayName ?? row.user.username, avatarUrl: row.user.profile?.avatarUrl ?? null, countryCode: row.user.profile?.countryCode ?? null, points: row.points, step: row.step, progression: { key: progression.key, name: progression.name } }
    }))
  }

  private serialize<T>(value: T): T {
    return JSON.parse(JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item)) as T
  }
}
