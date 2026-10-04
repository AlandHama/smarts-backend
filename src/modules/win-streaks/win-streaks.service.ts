import { Injectable, NotFoundException } from "@nestjs/common"
import { Prisma } from "@prisma/client"

import { PrismaService } from "../../prisma.service"
import { CreateWinStreakMilestoneDto, UpdateWinStreakConfigurationDto, UpdateWinStreakMilestoneDto } from "./dtos"

const DEFAULT_MILESTONES = [
  [1, 0, "First flame", "Win your first match to light the streak."],
  [3, 3, "Three-win spark", "Keep winning to make your ad rewards stronger."],
  [5, 5, "On fire", "Five consecutive wins puts you on fire."],
  [7, 8, "Hot hand", "A full week of wins."],
  [10, 12, "Unstoppable", "Ten consecutive wins."],
  [20, 20, "Win machine", "Twenty consecutive wins."],
  [50, 30, "Legendary run", "The ultimate configured win streak."],
] as const

type DbClient = PrismaService | Prisma.TransactionClient

@Injectable()
export class WinStreaksService {
  constructor(private readonly prisma: PrismaService) {}

  private async ensureConfiguration(client: DbClient) {
    const config = await client.winStreakConfiguration.upsert({
      where: { key: "default" },
      create: { key: "default" },
      update: {},
      include: { milestones: { orderBy: [{ wins: "asc" }, { sortOrder: "asc" }] } },
    })
    if (!config.milestones.length) {
      await client.winStreakMilestone.createMany({
        data: DEFAULT_MILESTONES.map(([wins, bonusPercent, title, description], index) => ({
          configurationId: config.id,
          wins,
          bonusPercent: String(bonusPercent),
          title,
          description,
          sortOrder: (index + 1) * 10,
        })),
        skipDuplicates: true,
      })
      return client.winStreakConfiguration.findUniqueOrThrow({
        where: { id: config.id },
        include: { milestones: { orderBy: [{ wins: "asc" }, { sortOrder: "asc" }] } },
      })
    }
    return config
  }

  async getConfiguration() {
    return this.prisma.$transaction(async (tx) => this.serializeConfiguration(await this.ensureConfiguration(tx)))
  }

  async updateConfiguration(dto: UpdateWinStreakConfigurationDto) {
    const current = await this.getConfiguration()
    const updated = await this.prisma.winStreakConfiguration.update({
      where: { id: current.id },
      data: {
        ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
        ...(dto.resetOnNonWin !== undefined ? { resetOnNonWin: dto.resetOnNonWin } : {}),
        ...(dto.maxBonusPercent !== undefined ? { maxBonusPercent: new Prisma.Decimal(String(dto.maxBonusPercent)) } : {}),
      },
      include: { milestones: { orderBy: [{ wins: "asc" }, { sortOrder: "asc" }] } },
    })
    return this.serializeConfiguration(updated)
  }

  async createMilestone(dto: CreateWinStreakMilestoneDto) {
    const config = await this.getConfiguration()
    const row = await this.prisma.winStreakMilestone.create({
      data: {
        configurationId: config.id,
        wins: dto.wins,
        bonusPercent: new Prisma.Decimal(String(dto.bonusPercent)),
        title: dto.title?.trim() || null,
        description: dto.description?.trim() || null,
        enabled: dto.enabled ?? true,
        sortOrder: dto.sortOrder ?? dto.wins,
      },
    })
    return this.serializeMilestone(row)
  }

  async updateMilestone(id: string, dto: UpdateWinStreakMilestoneDto) {
    const row = await this.prisma.winStreakMilestone.findUnique({ where: { id } })
    if (!row) throw new NotFoundException("Win streak milestone not found")
    const updated = await this.prisma.winStreakMilestone.update({
      where: { id },
      data: {
        wins: dto.wins,
        bonusPercent: new Prisma.Decimal(String(dto.bonusPercent)),
        title: dto.title?.trim() || null,
        description: dto.description?.trim() || null,
        enabled: dto.enabled ?? true,
        sortOrder: dto.sortOrder ?? dto.wins,
      },
    })
    return this.serializeMilestone(updated)
  }

  async deleteMilestone(id: string) {
    const row = await this.prisma.winStreakMilestone.findUnique({ where: { id } })
    if (!row) throw new NotFoundException("Win streak milestone not found")
    await this.prisma.winStreakMilestone.delete({ where: { id } })
    return { deleted: true, id }
  }

  async getStatus(userId: string) {
    const config = await this.getConfiguration()
    const stats = await this.prisma.playerStats.findUnique({ where: { userId }, select: { currentWinStreak: true, highestWinStreak: true } })
    return this.statusFor(config, stats)
  }

  async getBonusPercent(userId: string, transaction?: Prisma.TransactionClient) {
    const client = transaction ?? this.prisma
    const config = await this.ensureConfiguration(client)
    const stats = await client.playerStats.findUnique({ where: { userId }, select: { currentWinStreak: true } })
    return this.bonusFor(config, stats?.currentWinStreak ?? 0)
  }

  async shouldResetOnNonWin(transaction?: Prisma.TransactionClient) {
    const config = await this.ensureConfiguration(transaction ?? this.prisma)
    return config.resetOnNonWin
  }

  private bonusFor(config: any, wins: number) {
    if (!config.enabled) return new Prisma.Decimal(0)
    const milestone = [...config.milestones].filter((item: any) => item.enabled && item.wins <= wins).sort((a: any, b: any) => b.wins - a.wins)[0]
    const cap = new Prisma.Decimal(String(config.maxBonusPercent ?? 0))
    const bonus = new Prisma.Decimal(String(milestone?.bonusPercent ?? 0))
    return bonus.gt(cap) ? cap : bonus
  }

  private statusFor(config: any, stats: any) {
    const currentWinStreak = stats?.currentWinStreak ?? 0
    const currentBonusPercent = this.bonusFor(config, currentWinStreak)
    const nextMilestone = config.milestones.find((item: any) => item.enabled && item.wins > currentWinStreak)
    return {
      enabled: config.enabled,
      resetOnNonWin: config.resetOnNonWin,
      maxBonusPercent: new Prisma.Decimal(String(config.maxBonusPercent ?? 0)).toString(),
      currentWinStreak,
      highestWinStreak: stats?.highestWinStreak ?? 0,
      currentBonusPercent: currentBonusPercent.toString(),
      onFire: currentWinStreak >= 3,
      nextMilestone: nextMilestone ? { wins: nextMilestone.wins, bonusPercent: this.bonusFor(config, nextMilestone.wins).toString(), title: nextMilestone.title, winsRemaining: Math.max(0, nextMilestone.wins - currentWinStreak) } : null,
      milestones: config.milestones.filter((item: any) => item.enabled).map((item: any) => ({ wins: item.wins, bonusPercent: this.bonusFor(config, item.wins).toString(), title: item.title, description: item.description })),
    }
  }

  private serializeConfiguration(value: any) {
    return { ...value, maxBonusPercent: new Prisma.Decimal(String(value.maxBonusPercent ?? 0)).toString(), milestones: value.milestones.map((row: any) => this.serializeMilestone(row)) }
  }

  private serializeMilestone(value: any) {
    return { ...value, bonusPercent: new Prisma.Decimal(String(value.bonusPercent ?? 0)).toString() }
  }
}
