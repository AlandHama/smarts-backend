import { ConflictException, Injectable, NotFoundException } from "@nestjs/common"
import { Prisma, WalletTransactionSourceType } from "@prisma/client"

import { PrismaService } from "../../prisma.service"
import { CreditWalletTransaction } from "../economy/transactions/credit-wallet-transaction"
import { CreateAllyDto } from "./dtos"

const publicUser = { id: true, username: true, profile: { select: { displayName: true, avatarUrl: true, level: true, elo: true } } } satisfies Prisma.UserSelect
const ALLY_BOARD_KEY = "ally_monthly"

type Tx = Prisma.TransactionClient

@Injectable()
export class AllyService {
  constructor(private readonly prisma: PrismaService, private readonly creditWallet: CreditWalletTransaction) {}

  async create(userId: string, dto: CreateAllyDto) {
    const existing = await this.prisma.allyMember.findUnique({ where: { userId }, select: { allyId: true } })
    if (existing) throw new ConflictException("You are already in an Ally")
    const name = dto.name.trim()
    const tag = dto.tag.trim().toUpperCase()
    try {
      return await this.prisma.ally.create({
        data: { name, tag, description: dto.description?.trim() || null, ownerId: userId, members: { create: { userId, role: "OWNER" } } },
        include: { members: { include: { user: { select: publicUser } }, orderBy: { joinedAt: "asc" } } },
      }).then((ally) => this.serializeAlly(ally))
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new ConflictException("That Ally name or tag is already taken")
      throw error
    }
  }

  async join(userId: string, allyId: string) {
    const existing = await this.prisma.allyMember.findUnique({ where: { userId }, select: { allyId: true } })
    if (existing) throw new ConflictException("You are already in an Ally")
    const ally = await this.prisma.ally.findFirst({ where: { id: allyId, status: "ACTIVE" }, select: { id: true } })
    if (!ally) throw new NotFoundException("Ally not found")
    await this.prisma.allyMember.create({ data: { allyId, userId } })
    return this.me(userId)
  }

  async joinByTag(userId: string, tag: string) {
    const ally = await this.prisma.ally.findFirst({ where: { tag: tag.trim().toUpperCase(), status: "ACTIVE" }, select: { id: true } })
    if (!ally) throw new NotFoundException("No active Ally uses that tag")
    return this.join(userId, ally.id)
  }

  async leave(userId: string) {
    const membership = await this.prisma.allyMember.findUnique({
      where: { userId },
      select: { allyId: true, role: true },
    })
    if (!membership) return this.me(userId)

    await this.prisma.$transaction(async (transaction) => {
      await transaction.allyMember.delete({ where: { userId } })

      const remaining = await transaction.allyMember.findMany({
        where: { allyId: membership.allyId },
        orderBy: { joinedAt: "asc" },
        select: { id: true, userId: true, role: true },
      })

      if (!remaining.length) {
        // Keep the Ally and its historical score events intact, but make an
        // empty Ally unavailable for new members and future scoring.
        await transaction.ally.update({
          where: { id: membership.allyId },
          data: { status: "INACTIVE" },
        })
        return
      }

      const ally = await transaction.ally.findUniqueOrThrow({
        where: { id: membership.allyId },
        select: { ownerId: true },
      })
      if (ally.ownerId === userId || membership.role === "OWNER") {
        const nextOwner = remaining[0]
        await transaction.ally.update({
          where: { id: membership.allyId },
          data: { ownerId: nextOwner.userId },
        })
        await transaction.allyMember.update({
          where: { id: nextOwner.id },
          data: { role: "OWNER" },
        })
      }
    })

    return this.me(userId)
  }

  async me(userId: string) {
    await this.settleExpiredSeasons()
    const config = await this.policy()
    const ally = await this.prisma.allyMember.findUnique({ where: { userId }, include: { ally: { include: { members: { include: { user: { select: publicUser } }, orderBy: { joinedAt: "asc" } } } } } })
    const { board, season } = await this.ensureBoardAndSeason()
    const boardRows = await this.rankingRows(board.id, season.id, userId, ally?.allyId)
    const recentActivity = ally
      ? await this.prisma.allyScoreEvent.findMany({ where: { allyId: ally.allyId, seasonId: season.id }, orderBy: { createdAt: "desc" }, take: 8, include: { match: { select: { gameDefinition: { select: { name: true, key: true } } } } } })
      : []
    const contribution = ally ? await this.prisma.allyScoreEvent.aggregate({ where: { allyId: ally.allyId, seasonId: season.id }, _sum: { points: true }, _count: { _all: true } }) : null
    return {
      ally: ally ? this.serializeAlly(ally.ally) : null,
      season: { id: season.id, startsAt: season.startsAt, endsAt: season.endsAt, name: this.seasonName(season.startsAt) },
      leaderboard: boardRows.rows,
      currentRank: boardRows.currentRank,
      contribution: { points: contribution?._sum.points ?? 0, matches: contribution?._count._all ?? 0 },
      recentActivity: recentActivity.map((event) => ({ id: event.id, points: event.points, mode: event.mode, reason: event.reason, createdAt: event.createdAt, game: event.match.gameDefinition })),
      rewardPreview: { first: config.allyFirstRewardGld, second: config.allySecondRewardGld, third: config.allyThirdRewardGld, currency: config.allyRewardCurrencyCode },
    }
  }

  async leaderboard() {
    const config = await this.policy()
    const { board, season } = await this.ensureBoardAndSeason()
    const rows = await this.rankingRows(board.id, season.id)
    return { season: { id: season.id, startsAt: season.startsAt, endsAt: season.endsAt, name: this.seasonName(season.startsAt) }, leaderboard: rows.rows, rewardPreview: { first: config.allyFirstRewardGld, second: config.allySecondRewardGld, third: config.allyThirdRewardGld, currency: config.allyRewardCurrencyCode } }
  }

  /** Called from the settlement transaction. It is intentionally server-only. */
  async recordSettledCooperativeMatchWithinTransaction(transaction: Tx, input: { matchId: string; mode: string; botFilled: boolean; participants: Array<{ userId: string | null; teamId: string; result: string; rewardEligibility: string }>; teams: Array<{ id: string; result: string }> }) {
    if (input.botFilled) return
    const config = await this.policy(transaction)
    if (!config.allyRankingEnabled) return
    const eligible = input.participants.filter((item) => item.userId && item.result !== "FORFEIT" && item.rewardEligibility === "FULL")
    if (!eligible.length) return
    const memberships = await transaction.allyMember.findMany({ where: { userId: { in: eligible.map((item) => item.userId!) } }, select: { userId: true, allyId: true } })
    const byAlly = new Map<string, { teamIds: Set<string>; userIds: Set<string> }>()
    for (const member of memberships) {
      const participant = eligible.find((item) => item.userId === member.userId)
      if (!participant) continue
      const current = byAlly.get(member.allyId) ?? { teamIds: new Set<string>(), userIds: new Set<string>() }
      current.teamIds.add(participant.teamId); current.userIds.add(member.userId)
      byAlly.set(member.allyId, current)
    }
    if (!byAlly.size) return
    const { board, season } = await this.ensureBoardAndSeason(transaction)
    for (const [allyId, contribution] of byAlly) {
      const teamResults = [...contribution.teamIds].map((teamId) => input.teams.find((team) => team.id === teamId)?.result ?? "LOSS")
      const won = teamResults.includes("WIN")
      const draw = teamResults.includes("DRAW")
      const points = input.mode === "RANKED"
        ? won ? config.allyRankedWinPoints : draw ? config.allyRankedDrawPoints : config.allyRankedLossPoints
        : won ? config.allyCasualWinPoints : draw ? config.allyCasualDrawPoints : config.allyCasualLossPoints
      if (points <= 0) continue
      try {
        await transaction.allyScoreEvent.create({ data: { allyId, seasonId: season.id, matchId: input.matchId, points, mode: input.mode, reason: won ? "TEAM_WIN" : draw ? "TEAM_DRAW" : "TEAM_PLAYED" } })
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") continue
        throw error
      }
      let entry = await transaction.leaderboardEntry.findUnique({ where: { leaderboardId_seasonId_memberKey: { leaderboardId: board.id, seasonId: season.id, memberKey: allyId } } })
      if (!entry) {
        try {
          entry = await transaction.leaderboardEntry.create({ data: { leaderboardId: board.id, seasonId: season.id, memberKey: allyId, score: BigInt(points), metadata: { allyId } } })
        } catch (error) {
          if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error
          entry = await transaction.leaderboardEntry.findUniqueOrThrow({ where: { leaderboardId_seasonId_memberKey: { leaderboardId: board.id, seasonId: season.id, memberKey: allyId } } })
          await transaction.leaderboardEntry.update({ where: { id: entry.id }, data: { score: { increment: BigInt(points) } } })
        }
      } else {
        await transaction.leaderboardEntry.update({ where: { id: entry.id }, data: { score: { increment: BigInt(points) } } })
      }
    }
  }

  private async rankingRows(boardId: string, seasonId: string, userId?: string, currentAllyId?: string) {
    const entries = await this.prisma.leaderboardEntry.findMany({ where: { leaderboardId: boardId, seasonId }, orderBy: [{ score: "desc" }, { updatedAt: "asc" }], take: 100 })
    const allyIds = entries.map((entry) => entry.memberKey)
    const allies = await this.prisma.ally.findMany({ where: { id: { in: allyIds }, status: "ACTIVE" }, include: { members: { select: { userId: true } } } })
    const allyMap = new Map(allies.map((ally) => [ally.id, ally]))
    const rows = entries.filter((entry) => allyMap.has(entry.memberKey)).map((entry, index) => {
      const ally = allyMap.get(entry.memberKey)!
      return { rank: index + 1, allyId: entry.memberKey, name: ally?.name ?? "Ally", tag: ally?.tag ?? "", emblemKey: ally?.emblemKey ?? "spark", score: Number(entry.score), memberCount: ally?.members.length ?? 0, isCurrent: entry.memberKey === currentAllyId }
    })
    let currentRank: number | null = null
    if (currentAllyId) currentRank = rows.find((row) => row.allyId === currentAllyId)?.rank ?? (await this.rankFor(boardId, seasonId, currentAllyId))
    return { rows, currentRank }
  }

  private async rankFor(boardId: string, seasonId: string, allyId: string) {
    const current = await this.prisma.leaderboardEntry.findUnique({ where: { leaderboardId_seasonId_memberKey: { leaderboardId: boardId, seasonId, memberKey: allyId } }, select: { score: true } })
    if (!current) return null
    return (await this.prisma.leaderboardEntry.count({ where: { leaderboardId: boardId, seasonId, score: { gt: current.score } } })) + 1
  }

  private async ensureBoardAndSeason(client: PrismaService | Tx = this.prisma) {
    const board = await client.leaderboard.upsert({ where: { key: ALLY_BOARD_KEY }, create: { key: ALLY_BOARD_KEY, name: "Ally Monthly", memberType: "GENERIC", period: "MONTHLY", direction: "DESCENDING", writePolicy: "SERVER_ONLY", metadata: { scope: "cooperative" } }, update: { active: true } })
    const startsAt = this.monthStart(new Date())
    const endsAt = new Date(Date.UTC(startsAt.getUTCFullYear(), startsAt.getUTCMonth() + 1, 1))
    const season = await client.leaderboardSeason.upsert({ where: { leaderboardId_startsAt: { leaderboardId: board.id, startsAt } }, create: { leaderboardId: board.id, startsAt, endsAt, status: "ACTIVE" }, update: { endsAt, status: "ACTIVE" } })
    return { board, season }
  }

  private async settleExpiredSeasons() {
    const config = await this.policy()
    if (!config.allyRankingEnabled) return
    const board = await this.prisma.leaderboard.findUnique({ where: { key: ALLY_BOARD_KEY }, select: { id: true } })
    if (!board) return
    const expired = await this.prisma.leaderboardSeason.findMany({ where: { leaderboardId: board.id, status: "ACTIVE", endsAt: { lte: new Date() } }, take: 3 })
    for (const season of expired) await this.prisma.$transaction(async (transaction) => {
      const locked = await transaction.leaderboardSeason.findUnique({ where: { id: season.id } })
      if (!locked || locked.status !== "ACTIVE") return
      const entries = await transaction.leaderboardEntry.findMany({ where: { leaderboardId: board.id, seasonId: season.id }, orderBy: [{ score: "desc" }, { updatedAt: "asc" }], take: 3 })
      for (let index = 0; index < entries.length; index += 1) {
        const entry = entries[index]
        const members = await transaction.allyMember.findMany({ where: { allyId: entry.memberKey }, select: { userId: true } })
        const qualifying = await transaction.allyScoreEvent.count({ where: { allyId: entry.memberKey, seasonId: season.id } })
        if (qualifying < config.allyMinimumQualifyingMatches || !members.length) continue
        if (!config.allyRewardsEnabled) continue
        const total = BigInt([config.allyFirstRewardGld, config.allySecondRewardGld, config.allyThirdRewardGld][index] ?? 0)
        const each = total / BigInt(members.length)
        for (let memberIndex = 0; memberIndex < members.length; memberIndex += 1) {
          const amount = each + (memberIndex === 0 ? total % BigInt(members.length) : 0n)
          if (amount <= 0n) continue
          const grantKey = `ally-season:${season.id}:${entry.memberKey}:${members[memberIndex].userId}`
          const exists = await transaction.allyRewardPayout.findUnique({ where: { grantKey } })
          if (exists) continue
          await this.creditWallet.runWithinTransaction({ userId: members[memberIndex].userId, currencyCode: config.allyRewardCurrencyCode, amount, sourceId: grantKey, sourceType: WalletTransactionSourceType.SYSTEM, rewardGrantKey: grantKey, metadata: { allyReward: true, allyId: entry.memberKey, seasonId: season.id, rank: index + 1 } }, transaction)
          await transaction.allyRewardPayout.create({ data: { allyId: entry.memberKey, seasonId: season.id, userId: members[memberIndex].userId, rank: index + 1, amount, grantKey } })
        }
      }
      await transaction.leaderboardSeason.update({ where: { id: season.id }, data: { status: "CLOSED", resetAt: new Date() } })
    })
  }

  private serializeAlly(ally: any) {
    return { id: ally.id, name: ally.name, tag: ally.tag, description: ally.description, emblemKey: ally.emblemKey, ownerId: ally.ownerId, memberCount: ally.members?.length ?? 0, members: (ally.members ?? []).map((member: any) => ({ id: member.id, userId: member.userId, role: member.role, joinedAt: member.joinedAt, user: this.user(member.user) })) }
  }

  private user(value: any) {
    return { id: value?.id, name: value?.profile?.displayName || value?.username || "Player", username: value?.username, avatarUrl: value?.profile?.avatarUrl ?? null, level: value?.profile?.level ?? 1, elo: value?.profile?.elo ?? 0 }
  }

  private monthStart(date: Date) { return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)) }
  private seasonName(date: Date) { return date.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }) }

  private policy(client: PrismaService | Tx = this.prisma) {
    return client.cooperativeConfiguration.upsert({ where: { key: "default" }, create: { key: "default" }, update: {} })
  }
}
