import { Injectable, NotFoundException } from "@nestjs/common"
import { Prisma } from "@prisma/client"

import { PrismaService } from "../../prisma.service"
import { CreateStreakMilestoneDto, UpdateStreakConfigurationDto, UpdateStreakMilestoneDto } from "./dtos"

const DEFAULT_MILESTONES = [
  [1, 0, "Getting started", "Qualify today to start your streak."],
  [3, 3, "Three-day spark", "Keep showing up for a stronger ad reward."],
  [7, 7, "One-week flame", "A full week of qualifying activity."],
  [14, 12, "Fortnight focus", "Two weeks of consistent play."],
  [30, 20, "Monthly momentum", "A month of keeping the flame alive."],
  [60, 25, "Unstoppable", "Two months of daily activity."],
  [100, 30, "Century streak", "The maximum configured ad bonus."],
] as const

type DbClient = PrismaService | Prisma.TransactionClient

@Injectable()
export class StreaksService {
  constructor(private readonly prisma: PrismaService) {}

  private dateKey(date: Date | null | undefined) {
    return date ? date.toISOString().slice(0, 10) : null
  }

  private dateAtUtc(key: string) {
    return new Date(`${key}T00:00:00.000Z`)
  }

  private yesterdayKey(today: string) {
    const date = this.dateAtUtc(today)
    date.setUTCDate(date.getUTCDate() - 1)
    return this.dateKey(date)!
  }

  private async ensureConfiguration(client: DbClient) {
    const config = await client.streakConfiguration.upsert({
      where: { key: "default" },
      create: { key: "default" },
      update: {},
      include: { milestones: { orderBy: [{ day: "asc" }, { sortOrder: "asc" }] } },
    })
    if (!config.milestones.length) {
      await client.streakMilestone.createMany({
        data: DEFAULT_MILESTONES.map(([day, bonusPercent, title, description], index) => ({
          configurationId: config.id, day, bonusPercent, title, description, sortOrder: (index + 1) * 10,
        })),
        skipDuplicates: true,
      })
      return client.streakConfiguration.findUniqueOrThrow({
        where: { id: config.id },
        include: { milestones: { orderBy: [{ day: "asc" }, { sortOrder: "asc" }] } },
      })
    }
    return config
  }

  async getConfiguration() {
    return this.prisma.$transaction((tx) => this.ensureConfiguration(tx))
  }

  async updateConfiguration(dto: UpdateStreakConfigurationDto) {
    const current = await this.getConfiguration()
    const updated = await this.prisma.streakConfiguration.update({
      where: { id: current.id },
      data: {
        ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
        ...(dto.qualifyingActivity !== undefined ? { qualifyingActivity: dto.qualifyingActivity.trim().toUpperCase() } : {}),
        ...(dto.timezone !== undefined ? { timezone: dto.timezone.trim() } : {}),
        ...(dto.maxBonusPercent !== undefined ? { maxBonusPercent: dto.maxBonusPercent } : {}),
      },
      include: { milestones: { orderBy: [{ day: "asc" }, { sortOrder: "asc" }] } },
    })
    return this.serializeConfiguration(updated)
  }

  async createMilestone(dto: CreateStreakMilestoneDto) {
    const config = await this.getConfiguration()
    const row = await this.prisma.streakMilestone.create({
      data: {
        configurationId: config.id,
        day: dto.day,
        bonusPercent: dto.bonusPercent,
        title: dto.title?.trim() || null,
        description: dto.description?.trim() || null,
        enabled: dto.enabled ?? true,
        sortOrder: dto.sortOrder ?? dto.day,
      },
    })
    return this.serializeMilestone(row)
  }

  async updateMilestone(id: string, dto: UpdateStreakMilestoneDto) {
    const row = await this.prisma.streakMilestone.findUnique({ where: { id } })
    if (!row) throw new NotFoundException("Streak milestone not found")
    const updated = await this.prisma.streakMilestone.update({
      where: { id },
      data: {
        day: dto.day,
        bonusPercent: dto.bonusPercent,
        title: dto.title?.trim() || null,
        description: dto.description?.trim() || null,
        enabled: dto.enabled ?? true,
        sortOrder: dto.sortOrder ?? dto.day,
      },
    })
    return this.serializeMilestone(updated)
  }

  async deleteMilestone(id: string) {
    const row = await this.prisma.streakMilestone.findUnique({ where: { id } })
    if (!row) throw new NotFoundException("Streak milestone not found")
    await this.prisma.streakMilestone.delete({ where: { id } })
    return { deleted: true, id }
  }

  async getStatus(userId: string) {
    const config = await this.getConfiguration()
    const streak = await this.prisma.playerDailyStreak.findUnique({ where: { userId } })
    return this.statusFor(config, streak)
  }

  async getBonusPercent(userId: string, transaction?: Prisma.TransactionClient) {
    const client = transaction ?? this.prisma
    const config = await this.ensureConfiguration(client)
    const streak = await client.playerDailyStreak.findUnique({ where: { userId } })
    return this.bonusFor(config, streak)
  }

  /** Record one server-approved match settlement in the same transaction. */
  async recordWithinTransaction(input: { userId: string; sourceId: string; activityType?: string }, transaction: Prisma.TransactionClient) {
    const config = await this.ensureConfiguration(transaction)
    const activityType = (input.activityType ?? config.qualifyingActivity).trim().toUpperCase()
    if (!config.enabled || activityType !== config.qualifyingActivity.trim().toUpperCase()) return this.statusFor(config, null)
    const today = this.dateKey(new Date())!
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`daily-streak:${input.userId}`}))`
    const streak = await transaction.playerDailyStreak.upsert({ where: { userId: input.userId }, create: { userId: input.userId }, update: {} })
    const existing = await transaction.streakActivity.findFirst({ where: { userId: input.userId, activityType, activityDate: this.dateAtUtc(today) } })
    if (existing) return this.statusFor(config, streak)
    const last = this.dateKey(streak.lastQualifiedDate)
    const nextDays = last === today ? streak.currentDays : last === this.yesterdayKey(today) ? streak.currentDays + 1 : 1
    const updated = await transaction.playerDailyStreak.update({
      where: { id: streak.id },
      data: { currentDays: nextDays, longestDays: Math.max(streak.longestDays, nextDays), lastQualifiedDate: this.dateAtUtc(today), lastQualifiedAt: new Date() },
    })
    await transaction.streakActivity.create({ data: { userId: input.userId, streakId: streak.id, activityType, activityDate: this.dateAtUtc(today), sourceId: input.sourceId.slice(0, 255) } })
    return this.statusFor(config, updated)
  }

  private currentDays(streak: { currentDays: number; lastQualifiedDate: Date | null } | null) {
    if (!streak?.lastQualifiedDate) return 0
    const today = this.dateKey(new Date())!
    const last = this.dateKey(streak.lastQualifiedDate)
    return last === today || last === this.yesterdayKey(today) ? streak.currentDays : 0
  }

  private bonusFor(config: any, streak: { currentDays: number; lastQualifiedDate: Date | null } | null) {
    if (!config.enabled) return 0
    const days = this.currentDays(streak)
    const milestone = [...config.milestones].filter((item: any) => item.enabled && item.day <= days).sort((a: any, b: any) => b.day - a.day)[0]
    return Math.min(config.maxBonusPercent, milestone?.bonusPercent ?? 0)
  }

  private statusFor(config: any, streak: any) {
    const currentStreakDays = this.currentDays(streak)
    const currentBonusPercent = this.bonusFor(config, streak)
    const nextMilestone = config.milestones.find((item: any) => item.enabled && item.day > currentStreakDays)
    return {
      enabled: config.enabled,
      qualifyingActivity: config.qualifyingActivity,
      timezone: config.timezone,
      maxBonusPercent: config.maxBonusPercent,
      currentStreakDays,
      longestStreakDays: streak?.longestDays ?? 0,
      activeToday: this.dateKey(streak?.lastQualifiedDate) === this.dateKey(new Date()),
      lastQualifiedDate: streak?.lastQualifiedDate ?? null,
      currentBonusPercent,
      nextMilestone: nextMilestone ? { day: nextMilestone.day, bonusPercent: Math.min(config.maxBonusPercent, nextMilestone.bonusPercent), title: nextMilestone.title, daysRemaining: Math.max(0, nextMilestone.day - currentStreakDays) } : null,
      milestones: config.milestones.filter((item: any) => item.enabled).map((item: any) => ({ day: item.day, bonusPercent: Math.min(config.maxBonusPercent, item.bonusPercent), title: item.title, description: item.description })),
    }
  }

  private serializeConfiguration(value: any) {
    return { ...value, milestones: value.milestones.map((row: any) => this.serializeMilestone(row)) }
  }

  private serializeMilestone(value: any) {
    return { ...value }
  }
}
