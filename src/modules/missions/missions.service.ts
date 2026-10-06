import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleInit } from "@nestjs/common"
import { MissionPeriod, MissionStatus, Prisma, ProgressionEventSourceType, WalletTransactionSourceType } from "@prisma/client"

import { PrismaService } from "../../prisma.service"
import { AwardProgressionPointsTransaction } from "../progression/transactions/award-progression-points-transaction"
import { CreditWalletTransaction } from "../economy/transactions/credit-wallet-transaction"
import { ClaimAchievementDto, CreateAchievementDto, CreateAchievementTierDto, CreateMissionDto, UpdateAchievementDto, UpdateAchievementTierDto, UpdateMissionDto } from "./dtos"

type EventInput = { userId: string; eventType: string; sourceId: string; amount?: number; payload?: Record<string, unknown> }
type Tx = Prisma.TransactionClient

const defaultMissions: Array<{
  key: string; title: string; description: string; icon: string; category: string; eventType: string; target: number; period: MissionPeriod; rewardGld: string; rewardXp: bigint; sortOrder: number; filters?: Prisma.InputJsonValue
}> = [
  { key: "daily-play-1", title: "Warm up", description: "Play one match today.", icon: "sports_esports", category: "daily", eventType: "MATCH_PLAYED", target: 1, period: "DAILY", rewardGld: "0.5", rewardXp: 50n, sortOrder: 10 },
  { key: "daily-play-3", title: "On a roll", description: "Play three matches today.", icon: "local_fire_department", category: "daily", eventType: "MATCH_PLAYED", target: 3, period: "DAILY", rewardGld: "1", rewardXp: 100n, sortOrder: 20 },
  { key: "daily-win-1", title: "Take the win", description: "Win a match today.", icon: "emoji_events", category: "daily", eventType: "MATCH_WON", target: 1, period: "DAILY", rewardGld: "1", rewardXp: 120n, sortOrder: 30 },
  { key: "daily-answers-10", title: "Sharp mind", description: "Answer ten questions correctly today.", icon: "psychology", category: "daily", eventType: "CORRECT_ANSWER", target: 10, period: "DAILY", rewardGld: "1", rewardXp: 100n, sortOrder: 40 },
  { key: "weekly-play-10", title: "Regular player", description: "Play ten matches this week.", icon: "calendar_month", category: "weekly", eventType: "MATCH_PLAYED", target: 10, period: "WEEKLY", rewardGld: "4", rewardXp: 300n, sortOrder: 50 },
  { key: "weekly-win-5", title: "Winning week", description: "Win five matches this week.", icon: "military_tech", category: "weekly", eventType: "MATCH_WON", target: 5, period: "WEEKLY", rewardGld: "6", rewardXp: 500n, sortOrder: 60 },
  { key: "weekly-friend-1", title: "Stay connected", description: "Add a friend this week.", icon: "group_add", category: "weekly", eventType: "FRIEND_ADDED", target: 1, period: "WEEKLY", rewardGld: "2", rewardXp: 150n, sortOrder: 70 },
  { key: "tile-rush-clear-100", title: "Tile sweeper", description: "Clear 100 tiles in Tile Rush.", icon: "grid_view", category: "tile-rush", eventType: "TILE_RUSH_TILES_CLEARED", target: 100, period: "WEEKLY", rewardGld: "2", rewardXp: 160n, sortOrder: 80 },
  { key: "tile-rush-long-chain-3", title: "Path finder", description: "Create three Tile Rush chains of eight or more.", icon: "route", category: "tile-rush", eventType: "TILE_RUSH_LONG_CHAIN", target: 3, period: "WEEKLY", rewardGld: "3", rewardXp: 220n, sortOrder: 90 },
  { key: "tile-rush-crush-1", title: "Color storm", description: "Trigger a Color Crush in Tile Rush.", icon: "palette", category: "tile-rush", eventType: "TILE_RUSH_COLOR_CRUSH", target: 1, period: "DAILY", rewardGld: "1", rewardXp: 100n, sortOrder: 100 },
  { key: "tile-rush-combo-5", title: "Combo runner", description: "Reach Combo ×5 in Tile Rush.", icon: "local_fire_department", category: "tile-rush", eventType: "TILE_RUSH_COMBO", target: 5, period: "WEEKLY", rewardGld: "2", rewardXp: 180n, sortOrder: 105 },
  { key: "tile-rush-casual-win-1", title: "Casual rush", description: "Win one Tile Rush casual match.", icon: "emoji_events", category: "tile-rush", eventType: "TILE_RUSH_MATCH_WON", target: 1, period: "WEEKLY", rewardGld: "2", rewardXp: 180n, sortOrder: 110, filters: { mode: "CASUAL" } },
  { key: "tile-rush-ranked-win-1", title: "Ranked rush", description: "Win one Tile Rush ranked match.", icon: "military_tech", category: "tile-rush", eventType: "TILE_RUSH_MATCH_WON", target: 1, period: "WEEKLY", rewardGld: "3", rewardXp: 240n, sortOrder: 115, filters: { mode: "RANKED" } },
]

const defaultAchievements = [
  { key: "matches-played", title: "Match veteran", description: "Keep showing up and play matches.", icon: "sports_esports", category: "matches", eventType: "MATCH_PLAYED", sortOrder: 10, tiers: [[1, "First match", 1, "1", 25n], [2, "Getting started", 10, "3", 100n], [3, "Dedicated", 50, "10", 300n], [4, "Legendary grind", 100, "25", 750n]] },
  { key: "matches-won", title: "Victory lap", description: "Build your lifetime win total.", icon: "emoji_events", category: "matches", eventType: "MATCH_WON", sortOrder: 20, tiers: [[1, "First victory", 1, "1", 50n], [2, "Competitor", 10, "5", 180n], [3, "Champion", 50, "15", 500n]] },
  { key: "correct-answers", title: "Brilliant mind", description: "Answer questions correctly.", icon: "psychology", category: "skill", eventType: "CORRECT_ANSWER", sortOrder: 30, tiers: [[1, "Quick thinker", 10, "1", 50n], [2, "Knowledgeable", 100, "5", 250n], [3, "Genius", 500, "15", 800n]] },
  { key: "perfect-matches", title: "Flawless", description: "Complete matches with a perfect score.", icon: "auto_awesome", category: "skill", eventType: "PERFECT_MATCH", sortOrder: 40, tiers: [[1, "Perfect start", 1, "2", 100n], [2, "Unstoppable", 10, "10", 400n]] },
  { key: "friends-added", title: "People person", description: "Grow your SMARTS circle.", icon: "group", category: "social", eventType: "FRIEND_ADDED", sortOrder: 50, tiers: [[1, "New connection", 1, "1", 50n], [2, "Social", 10, "5", 250n], [3, "Community", 25, "10", 600n]] },
  { key: "gifts-sent", title: "Generous spirit", description: "Send social gifts to other players.", icon: "card_giftcard", category: "social", eventType: "GIFT_SENT", sortOrder: 60, tiers: [[1, "Thoughtful", 1, "1", 25n], [2, "Generous", 10, "5", 150n], [3, "Big heart", 50, "10", 500n]] },
  { key: "ranked-matches", title: "Ranked journey", description: "Take on the ranked arenas.", icon: "military_tech", category: "ranked", eventType: "RANKED_MATCH_PLAYED", sortOrder: 70, tiers: [[1, "Enter the arena", 1, "2", 75n], [2, "Regular contender", 10, "8", 300n], [3, "Arena regular", 50, "15", 900n]] },
  { key: "gem-specialist", title: "Gem hunter", description: "Create special gems in Gem Blitz.", icon: "auto_awesome", category: "gem-blitz", eventType: "GEM_BLITZ_SPECIAL", sortOrder: 80, tiers: [[1, "First sparkle", 1, "1", 30n], [2, "Power player", 25, "5", 180n], [3, "Gem master", 100, "15", 500n]] },
  { key: "gem-combo", title: "Unstoppable", description: "Trigger Gem Blitz combos.", icon: "bolt", category: "gem-blitz", eventType: "GEM_BLITZ_COMBO", sortOrder: 90, tiers: [[1, "Warm streak", 5, "1", 50n], [2, "Rush master", 25, "5", 250n], [3, "Blitz legend", 100, "15", 800n]] },
  { key: "tile-rush-on-fire", title: "On Fire", description: "Reach Combo ×10 in Tile Rush.", icon: "local_fire_department", category: "tile-rush", eventType: "TILE_RUSH_COMBO", sortOrder: 100, tiers: [[1, "Spark", 10, "2", 100n], [2, "Flame", 50, "8", 350n], [3, "Inferno", 100, "20", 1000n]] },
  { key: "tile-rush-rainbow-hunter", title: "Rainbow Hunter", description: "Trigger Color Crushes in Tile Rush.", icon: "palette", category: "tile-rush", eventType: "TILE_RUSH_COLOR_CRUSH", sortOrder: 110, tiers: [[1, "First storm", 1, "1", 60n], [2, "Prismatic", 25, "6", 300n], [3, "Rainbow legend", 100, "18", 900n]] },
  { key: "tile-rush-lightning-hands", title: "Lightning Hands", description: "Clear tiles in Tile Rush.", icon: "bolt", category: "tile-rush", eventType: "TILE_RUSH_TILES_CLEARED", sortOrder: 120, tiers: [[1, "Fast fingers", 150, "3", 180n], [2, "Tile storm", 750, "12", 600n]] },
  { key: "tile-rush-master", title: "Tile Master", description: "Win Tile Rush matches.", icon: "military_tech", category: "tile-rush", eventType: "TILE_RUSH_MATCH_WON", sortOrder: 130, tiers: [[1, "First rush", 1, "1", 80n], [2, "Rush regular", 10, "6", 300n], [3, "Tile master", 100, "25", 1200n]] },
  { key: "tile-rush-path-finder", title: "Path Finder", description: "Create long Tile Rush chains.", icon: "route", category: "tile-rush", eventType: "TILE_RUSH_LONG_CHAIN", sortOrder: 140, tiers: [[1, "Long route", 1, "1", 75n], [2, "Trailblazer", 10, "5", 280n], [3, "Maze master", 50, "15", 850n]] },
  { key: "tile-rush-photo-finish", title: "Photo Finish", description: "Win Tile Rush by fewer than 100 points.", icon: "timer", category: "tile-rush", eventType: "TILE_RUSH_CLOSE_WIN", sortOrder: 150, tiers: [[1, "Close call", 1, "2", 120n], [2, "Nail-biter", 10, "8", 450n]] },
]

@Injectable()
export class MissionsService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly creditWallet: CreditWalletTransaction,
    private readonly awardProgression: AwardProgressionPointsTransaction,
  ) {}

  async onModuleInit() {
    // Definitions are seeded once so a new environment has a useful first
    // experience. Existing administrator edits are never overwritten.
    for (const mission of defaultMissions) await this.prisma.missionDefinition.upsert({ where: { key: mission.key }, create: mission, update: {} })
    for (const achievement of defaultAchievements) {
      const definition = await this.prisma.achievementDefinition.upsert({ where: { key: achievement.key }, create: { key: achievement.key, title: achievement.title, description: achievement.description, icon: achievement.icon, category: achievement.category, eventType: achievement.eventType, sortOrder: achievement.sortOrder }, update: {} })
      for (const [tier, title, target, rewardGld, rewardXp] of achievement.tiers as Array<[number, string, number, string, bigint]>) await this.prisma.achievementTier.upsert({ where: { achievementDefinitionId_tier: { achievementDefinitionId: definition.id, tier } }, create: { achievementDefinitionId: definition.id, tier, title, target, rewardGld, rewardXp }, update: {} })
    }
  }

  async getForPlayer(userId: string) {
    const now = new Date()
    const definitions = await this.prisma.missionDefinition.findMany({ where: { enabled: true, AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: now } }] }, { OR: [{ endsAt: null }, { endsAt: { gte: now } }] }] }, orderBy: [{ period: "asc" }, { sortOrder: "asc" }] })
    const missions = []
    for (const definition of definitions) missions.push(await this.prisma.playerMission.upsert({ where: { userId_missionDefinitionId_periodKey: { userId, missionDefinitionId: definition.id, periodKey: this.periodKey(definition.period) } }, create: { userId, missionDefinitionId: definition.id, periodKey: this.periodKey(definition.period), targetSnapshot: definition.target }, update: {}, include: { missionDefinition: true } }))
    const achievements = await this.prisma.achievementDefinition.findMany({ where: { enabled: true }, orderBy: { sortOrder: "asc" }, include: { tiers: { orderBy: { tier: "asc" } }, playerRows: { where: { userId } } } })
    return this.serialize({ missions, achievements: achievements.map((definition) => ({ ...definition, player: definition.playerRows[0] ?? null, playerRows: undefined })) })
  }

  async record(input: EventInput) { return this.prisma.$transaction((tx) => this.recordWithinTransaction(input, tx)) }

  async recordWithinTransaction(input: EventInput, tx: Tx) {
    const eventType = input.eventType.trim().toUpperCase()
    const sourceId = input.sourceId.trim()
    if (!eventType || !sourceId) throw new BadRequestException("Engagement event type and source id are required")
    const amount = Math.max(1, Math.min(100000, Math.floor(input.amount ?? 1)))
    const existing = await tx.engagementEvent.findUnique({ where: { userId_eventType_sourceId: { userId: input.userId, eventType, sourceId } } })
    if (existing) return { duplicate: true, missions: [], achievements: [] }
    await tx.engagementEvent.create({ data: { userId: input.userId, eventType, sourceId, amount, payload: input.payload as Prisma.InputJsonValue | undefined } })
    const now = new Date()
    const definitions = await tx.missionDefinition.findMany({ where: { eventType, enabled: true, AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: now } }] }, { OR: [{ endsAt: null }, { endsAt: { gte: now } }] }] } })
    const missionUpdates: any[] = []
    for (const definition of definitions) {
      if (!this.matches(definition.filters, input.payload)) continue
      const periodKey = this.periodKey(definition.period)
      const row = await tx.playerMission.upsert({ where: { userId_missionDefinitionId_periodKey: { userId: input.userId, missionDefinitionId: definition.id, periodKey } }, create: { userId: input.userId, missionDefinitionId: definition.id, periodKey, targetSnapshot: definition.target }, update: {} })
      if (row.status !== MissionStatus.CLAIMED) {
        const progress = Math.min(row.targetSnapshot, row.progress + amount)
        const completed = progress >= row.targetSnapshot
        const updated = await tx.playerMission.update({ where: { id: row.id }, data: { progress, status: completed ? (row.status === MissionStatus.COMPLETED ? MissionStatus.COMPLETED : MissionStatus.COMPLETED) : MissionStatus.ACTIVE, completedAt: completed && !row.completedAt ? now : row.completedAt }, include: { missionDefinition: true } })
        missionUpdates.push(updated)
        if (completed && row.status !== MissionStatus.COMPLETED) await this.createCompletionNotification(tx, input.userId, "mission.completed", definition.title, `Mission complete: ${definition.title}. Claim your reward!`, updated.id)
      }
    }
    const achievements = await tx.achievementDefinition.findMany({ where: { eventType, enabled: true }, include: { tiers: { orderBy: { tier: "asc" } } } })
    const achievementUpdates: any[] = []
    for (const definition of achievements) {
      if (!this.matches(definition.filters, input.payload)) continue
      const row = await tx.playerAchievement.upsert({ where: { userId_achievementDefinitionId: { userId: input.userId, achievementDefinitionId: definition.id } }, create: { userId: input.userId, achievementDefinitionId: definition.id }, update: {} })
      const progress = Math.min(2147483647, row.progress + amount)
      const completedTier = definition.tiers.filter((tier) => tier.target <= progress).reduce((max, tier) => Math.max(max, tier.tier), row.completedTier)
      const updated = await tx.playerAchievement.update({ where: { id: row.id }, data: { progress, completedTier, lastCompletedAt: completedTier > row.completedTier ? now : row.lastCompletedAt }, include: { achievementDefinition: { include: { tiers: { orderBy: { tier: "asc" } } } } } })
      achievementUpdates.push(updated)
      if (completedTier > row.completedTier) await this.createCompletionNotification(tx, input.userId, "achievement.completed", definition.title, `Achievement unlocked: ${definition.title}. Tier ${completedTier} is ready to claim!`, updated.id)
    }
    return this.serialize({ duplicate: false, missions: missionUpdates, achievements: achievementUpdates })
  }

  async claimMission(userId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.playerMission.findFirst({ where: { id, userId }, include: { missionDefinition: true } })
      if (!row) throw new NotFoundException("Mission not found")
      if (row.status === MissionStatus.CLAIMED) return this.serialize(row)
      if (row.status !== MissionStatus.COMPLETED) throw new ConflictException("This mission is not complete")
      await this.grant(tx, userId, row.missionDefinition.rewardGld, row.missionDefinition.rewardXp, `MISSION:${row.id}`, row.missionDefinition.title)
      return this.serialize(await tx.playerMission.update({ where: { id: row.id }, data: { status: MissionStatus.CLAIMED, claimedAt: new Date() }, include: { missionDefinition: true } }))
    })
  }

  async claimAchievement(userId: string, id: string, dto: ClaimAchievementDto) {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.playerAchievement.findFirst({ where: { id, userId }, include: { achievementDefinition: { include: { tiers: { orderBy: { tier: "asc" } } } } } })
      if (!row) throw new NotFoundException("Achievement not found")
      const tierNumber = dto.tier ?? row.claimedTier + 1
      if (tierNumber !== row.claimedTier + 1 || tierNumber > row.completedTier) throw new ConflictException("This achievement tier is not ready to claim")
      const tier = row.achievementDefinition.tiers.find((value) => value.tier === tierNumber)
      if (!tier) throw new NotFoundException("Achievement tier not found")
      await this.grant(tx, userId, tier.rewardGld, tier.rewardXp, `ACHIEVEMENT:${row.id}:${tier.tier}`, `${row.achievementDefinition.title} · ${tier.title}`)
      return this.serialize(await tx.playerAchievement.update({ where: { id: row.id }, data: { claimedTier: tierNumber }, include: { achievementDefinition: { include: { tiers: { orderBy: { tier: "asc" } } } } } }))
    })
  }

  listMissionDefinitions(includeInactive = false) { return this.prisma.missionDefinition.findMany({ where: includeInactive ? undefined : { enabled: true }, orderBy: [{ period: "asc" }, { sortOrder: "asc" }] }).then((value) => this.serialize(value)) }
  listAchievementDefinitions(includeInactive = false) { return this.prisma.achievementDefinition.findMany({ where: includeInactive ? undefined : { enabled: true }, orderBy: { sortOrder: "asc" }, include: { tiers: { orderBy: { tier: "asc" } } } }).then((value) => this.serialize(value)) }
  createMission(dto: CreateMissionDto) { return this.prisma.missionDefinition.create({ data: this.missionData(dto) as Prisma.MissionDefinitionCreateInput }).then((value) => this.serialize(value)) }
  updateMission(id: string, dto: UpdateMissionDto) { return this.prisma.missionDefinition.update({ where: { id }, data: this.missionData(dto) }).then((value) => this.serialize(value)) }
  deleteMission(id: string) { return this.prisma.missionDefinition.update({ where: { id }, data: { enabled: false } }).then(() => ({ message: "Mission disabled" })) }
  createAchievement(dto: CreateAchievementDto) { return this.prisma.achievementDefinition.create({ data: this.achievementData(dto) as Prisma.AchievementDefinitionCreateInput }).then((value) => this.serialize(value)) }
  updateAchievement(id: string, dto: UpdateAchievementDto) { return this.prisma.achievementDefinition.update({ where: { id }, data: this.achievementData(dto) }).then((value) => this.serialize(value)) }
  deleteAchievement(id: string) { return this.prisma.achievementDefinition.update({ where: { id }, data: { enabled: false } }).then(() => ({ message: "Achievement disabled" })) }
  createTier(achievementDefinitionId: string, dto: CreateAchievementTierDto) { return this.prisma.achievementTier.create({ data: { achievementDefinitionId, tier: dto.tier, title: dto.title.trim(), target: dto.target, rewardGld: this.decimal(dto.rewardGld ?? "0"), rewardXp: this.bigint(dto.rewardXp ?? "0") } }).then((value) => this.serialize(value)) }
  updateTier(id: string, dto: UpdateAchievementTierDto) { return this.prisma.achievementTier.update({ where: { id }, data: { tier: dto.tier, title: dto.title.trim(), target: dto.target, rewardGld: this.decimal(dto.rewardGld ?? "0"), rewardXp: this.bigint(dto.rewardXp ?? "0") } }).then((value) => this.serialize(value)) }
  deleteTier(id: string) { return this.prisma.achievementTier.delete({ where: { id } }).then(() => ({ message: "Achievement tier deleted" })) }

  private async grant(tx: Tx, userId: string, gld: Prisma.Decimal, xp: bigint, sourceId: string, label: string) {
    if (gld.gt(0)) await this.creditWallet.runWithinTransaction({ userId, currencyCode: "GLD", amount: BigInt(gld.floor().toFixed(0)), amountDecimal: gld.toString(), sourceId, sourceType: WalletTransactionSourceType.SYSTEM, rewardGrantKey: sourceId, metadata: { reason: "ENGAGEMENT_REWARD", label } }, tx)
    if (xp > 0n) {
      const progression = await tx.progressionDefinition.findUnique({ where: { key: "main" }, select: { active: true } })
      if (progression?.active) await this.awardProgression.runWithinTransaction({ userId, progressionKey: "main", amount: xp, sourceId: `${sourceId}:xp`, sourceType: ProgressionEventSourceType.SYSTEM, metadata: { reason: "ENGAGEMENT_REWARD", label } }, tx)
    }
  }

  private async createCompletionNotification(tx: Tx, userId: string, eventType: string, title: string, body: string, sourceId: string) { await tx.outboxEvent.create({ data: { eventType, aggregateType: "Engagement", aggregateId: sourceId, payload: { userId, title, body, sourceId } as Prisma.InputJsonValue } }) }
  private periodKey(period: MissionPeriod) { const now = new Date(); if (period === MissionPeriod.DAILY) return now.toISOString().slice(0, 10); const first = new Date(Date.UTC(now.getUTCFullYear(), 0, 1)); const day = Math.floor((now.getTime() - first.getTime()) / 86400000) + 1; return `${now.getUTCFullYear()}-W${String(Math.ceil((day + first.getUTCDay()) / 7)).padStart(2, "0")}` }
  private matches(filters: Prisma.JsonValue | null, payload?: Record<string, unknown>) { if (!filters || typeof filters !== "object" || Array.isArray(filters)) return true; const conditions = filters as Record<string, unknown>; const source = payload ?? {}; for (const [key, expected] of Object.entries(conditions)) { if (key === "anyOf" && Array.isArray(expected)) { if (!expected.some((item) => this.matches(item as Prisma.JsonValue, payload))) return false; continue } if (key === "allOf" && Array.isArray(expected)) { if (!expected.every((item) => this.matches(item as Prisma.JsonValue, payload))) return false; continue } const actual = source[key]; if (Array.isArray(expected) ? !expected.map(String).includes(String(actual)) : String(actual) !== String(expected)) return false } return true }
  private missionData(dto: CreateMissionDto | UpdateMissionDto): Prisma.MissionDefinitionUpdateInput { return { key: dto.key.trim().toLowerCase(), title: dto.title.trim(), description: dto.description.trim(), icon: dto.icon?.trim() || "target", category: dto.category?.trim() || "general", eventType: dto.eventType.trim().toUpperCase(), target: dto.target, period: dto.period ?? "DAILY", rewardGld: this.decimal(dto.rewardGld ?? "0"), rewardXp: this.bigint(dto.rewardXp ?? "0"), filters: dto.filters ? JSON.parse(dto.filters) as Prisma.InputJsonValue : undefined, enabled: dto.enabled ?? true, startsAt: dto.startsAt ? new Date(dto.startsAt) : null, endsAt: dto.endsAt ? new Date(dto.endsAt) : null, sortOrder: dto.sortOrder ?? 0 } }
  private achievementData(dto: CreateAchievementDto | UpdateAchievementDto): Prisma.AchievementDefinitionUpdateInput { return { key: dto.key.trim().toLowerCase(), title: dto.title.trim(), description: dto.description.trim(), icon: dto.icon?.trim() || "trophy", category: dto.category?.trim() || "general", eventType: dto.eventType.trim().toUpperCase(), filters: dto.filters ? JSON.parse(dto.filters) as Prisma.InputJsonValue : undefined, enabled: dto.enabled ?? true, sortOrder: dto.sortOrder ?? 0 } }
  private decimal(value: string) { if (!/^\d+(?:\.\d{1,6})?$/.test(value.trim())) throw new BadRequestException("Reward GLD must be a non-negative number with up to 6 decimals"); return new Prisma.Decimal(value) }
  private bigint(value: string) { if (!/^\d+$/.test(value.trim())) throw new BadRequestException("Reward XP must be a non-negative integer"); return BigInt(value.trim()) }
  private serialize<T>(value: T): T { return JSON.parse(JSON.stringify(value, (_, item) => typeof item === "bigint" || item instanceof Prisma.Decimal ? item.toString() : item)) as T }
}
