import { Injectable, NotFoundException } from "@nestjs/common"
import { Prisma } from "@prisma/client"

import { PrismaService } from "../../prisma.service"
import { CreateLeaderboardDto, CreateLeaderboardSeasonDto, LeaderboardMembersDto, LeaderboardQueryDto, UpdateLeaderboardDto } from "./dtos"
import { ApplyLeaderboardScoreTransaction } from "./transactions/apply-score-transaction"
import { CloseSeasonTransaction } from "./transactions/close-season-transaction"
import { CreateLeaderboardTransaction } from "./transactions/create-leaderboard-transaction"
import { CreateSeasonTransaction } from "./transactions/create-season-transaction"
import { UpdateLeaderboardTransaction } from "./transactions/update-leaderboard-transaction"

@Injectable()
export class LeaderboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly createLeaderboardTransaction: CreateLeaderboardTransaction,
    private readonly updateLeaderboardTransaction: UpdateLeaderboardTransaction,
    private readonly createSeasonTransaction: CreateSeasonTransaction,
    private readonly closeSeasonTransaction: CloseSeasonTransaction,
    private readonly applyScoreTransaction: ApplyLeaderboardScoreTransaction,
  ) {}

  listDefinitions(includeInactive = false) {
    return this.prisma.leaderboard.findMany({ where: includeInactive ? undefined : { active: true }, orderBy: { key: "asc" }, take: 100, include: { _count: { select: { seasons: true, entries: true } }, seasons: { where: { status: "ACTIVE" }, orderBy: { startsAt: "desc" }, take: 1 } } }).then((items) => this.serialize(items))
  }

  async getDefinition(keyOrId: string, includeInactive = true) {
    const item = await this.prisma.leaderboard.findFirst({ where: { OR: [{ key: keyOrId.trim().toLowerCase() }, { id: keyOrId }] }, include: { seasons: { orderBy: { startsAt: "desc" }, take: 20 }, _count: { select: { seasons: true, entries: true } } } })
    if (!item || (!includeInactive && !item.active)) throw new NotFoundException("Leaderboard not found")
    return this.serialize(item)
  }

  createDefinition(dto: CreateLeaderboardDto) { return this.createLeaderboardTransaction.run(dto).then((item) => this.serialize(item)) }
  updateDefinition(id: string, dto: UpdateLeaderboardDto) { return this.updateLeaderboardTransaction.run({ id, dto }).then((item) => this.serialize(item)) }
  createSeason(leaderboardId: string, dto: CreateLeaderboardSeasonDto) { return this.createSeasonTransaction.run({ leaderboardId, dto }).then((item) => this.serialize(item)) }
  closeSeason(id: string) { return this.closeSeasonTransaction.run(id).then((item) => this.serialize(item)) }
  applyScore(input: Parameters<ApplyLeaderboardScoreTransaction["run"]>[0]) { return this.applyScoreTransaction.run(input) }

  async list(key: string, query: LeaderboardQueryDto, userId?: string) {
    const board = await this.findActiveBoard(key)
    let season = await this.activeSeason(board.id)
    if (!season && board.period === "ALL_TIME") season = await this.ensureAllTimeSeason(board.id)
    if (!season) throw new NotFoundException("Leaderboard has no active season")
    const limit = Math.min(Math.max(query.limit ?? 25, 1), 100)
    const offset = Math.max(query.offset ?? 0, 0)
    const order = board.direction === "ASCENDING" ? "ASC" : "DESC"
    const [countRows, rows] = await Promise.all([
      this.prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`SELECT COUNT(*)::bigint AS count FROM "LeaderboardEntry" WHERE "leaderboardId" = ${board.id} AND "seasonId" = ${season.id}`),
      this.entryRows(board.id, season.id, order, limit, offset),
    ])
    const total = Number(countRows[0]?.count ?? 0n)
    const currentUserRank = userId && board.memberType === "PLAYER" ? await this.memberRank(board.id, season.id, userId, order) : null
    return this.serialize({ leaderboard: { id: board.id, key: board.key, name: board.name, memberType: board.memberType, period: board.period, direction: board.direction }, season, items: rows, pagination: { total, limit, offset, nextOffset: offset + limit < total ? offset + limit : null }, currentUserRank })
  }

  async members(key: string, dto: LeaderboardMembersDto) {
    const board = await this.findActiveBoard(key)
    let season = await this.activeSeason(board.id)
    if (!season && board.period === "ALL_TIME") season = await this.ensureAllTimeSeason(board.id)
    if (!season) throw new NotFoundException("Leaderboard has no active season")
    const keys = [...new Set(dto.memberKeys.map((item) => item.trim()).filter(Boolean))].slice(0, 100)
    if (!keys.length) return this.serialize({ leaderboard: board, season, items: [] })
    const order = board.direction === "ASCENDING" ? "ASC" : "DESC"
    const items = await this.entryRows(board.id, season.id, order, 100, 0, keys)
    return this.serialize({ leaderboard: { key: board.key, name: board.name, memberType: board.memberType, period: board.period, direction: board.direction }, season, items })
  }

  async topForAdmin(key: string, limit = 10) { return this.list(key, { limit: Math.min(Math.max(limit, 1), 100), offset: 0 }) }

  async rebuild(key: string) {
    const board = await this.prisma.leaderboard.findUnique({ where: { key: key.trim().toLowerCase() }, select: { id: true, key: true } })
    if (!board) throw new NotFoundException("Leaderboard not found")
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw(Prisma.sql`INSERT INTO "LeaderboardEntry" ("leaderboardId", "seasonId", "memberKey", "playerId", "score", "createdAt", "updatedAt") SELECT "leaderboardId", "seasonId", "memberKey", "playerId", SUM("delta")::bigint, MIN("createdAt"), CURRENT_TIMESTAMP FROM "LeaderboardScoreEvent" WHERE "leaderboardId" = ${board.id} GROUP BY "leaderboardId", "seasonId", "memberKey", "playerId" ON CONFLICT ("leaderboardId", "seasonId", "memberKey") DO UPDATE SET "playerId" = EXCLUDED."playerId", "score" = EXCLUDED."score", "updatedAt" = CURRENT_TIMESTAMP`)
      await transaction.$executeRaw(Prisma.sql`UPDATE "LeaderboardScoreEvent" event SET "entryId" = entry."id" FROM "LeaderboardEntry" entry WHERE event."leaderboardId" = entry."leaderboardId" AND event."seasonId" = entry."seasonId" AND event."memberKey" = entry."memberKey" AND event."leaderboardId" = ${board.id}`)
      const [{ count }] = await transaction.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`SELECT COUNT(*)::bigint AS count FROM "LeaderboardEntry" WHERE "leaderboardId" = ${board.id}`)
      return { leaderboardKey: board.key, rebuiltEntries: Number(count) }
    })
  }

  private async findActiveBoard(key: string) {
    const board = await this.prisma.leaderboard.findUnique({ where: { key: key.trim().toLowerCase() } })
    if (!board || !board.active) throw new NotFoundException("Leaderboard not found")
    return board
  }

  private activeSeason(leaderboardId: string) { const now = new Date(); return this.prisma.leaderboardSeason.findFirst({ where: { leaderboardId, status: "ACTIVE", startsAt: { lte: now }, endsAt: { gt: now } }, orderBy: { startsAt: "desc" } }) }

  private async ensureAllTimeSeason(leaderboardId: string) {
    const startsAt = new Date("1970-01-01T00:00:00.000Z")
    const existing = await this.prisma.leaderboardSeason.findUnique({ where: { leaderboardId_startsAt: { leaderboardId, startsAt } } })
    if (existing) {
      if (existing.status === "SCHEDULED") return this.prisma.leaderboardSeason.update({ where: { id: existing.id }, data: { status: "ACTIVE" } })
      return existing.status === "ACTIVE" ? existing : null
    }
    return this.prisma.leaderboardSeason.create({ data: { leaderboardId, startsAt, endsAt: new Date("9999-12-31T23:59:59.999Z"), status: "ACTIVE" } })
  }

  private async entryRows(leaderboardId: string, seasonId: string, order: "ASC" | "DESC", limit: number, offset: number, memberKeys?: string[]) {
    const filter = memberKeys?.length ? Prisma.sql`AND e."memberKey" IN (${Prisma.join(memberKeys)})` : Prisma.empty
    return this.prisma.$queryRaw<Array<any>>(Prisma.sql`SELECT e."id", e."memberKey", e."playerId", e."score", e."metadata", e."createdAt", e."updatedAt", RANK() OVER (ORDER BY e."score" ${Prisma.raw(order)})::bigint AS "rank", u."username", p."displayName", p."avatarUrl", p."countryCode" FROM "LeaderboardEntry" e LEFT JOIN "User" u ON u."id" = e."playerId" LEFT JOIN "PlayerProfile" p ON p."userId" = e."playerId" WHERE e."leaderboardId" = ${leaderboardId} AND e."seasonId" = ${seasonId} ${filter} ORDER BY e."score" ${Prisma.raw(order)}, e."updatedAt" ASC, e."memberKey" ASC LIMIT ${limit} OFFSET ${offset}`).then((rows) => rows.map((row) => ({ id: row.id, memberKey: row.memberKey, playerId: row.playerId, score: row.score, rank: row.rank, metadata: row.metadata, player: row.playerId ? { username: row.username, displayName: row.displayName, avatarUrl: row.avatarUrl, countryCode: row.countryCode } : null })))
  }

  private async memberRank(leaderboardId: string, seasonId: string, memberKey: string, order: "ASC" | "DESC") {
    const rows = await this.prisma.$queryRaw<Array<{ rank: bigint }>>(Prisma.sql`SELECT "rank" FROM (SELECT e."memberKey", RANK() OVER (ORDER BY e."score" ${Prisma.raw(order)})::bigint AS "rank" FROM "LeaderboardEntry" e WHERE e."leaderboardId" = ${leaderboardId} AND e."seasonId" = ${seasonId}) ranked WHERE "memberKey" = ${memberKey} LIMIT 1`)
    return rows[0]?.rank ?? null
  }

  private serialize<T>(value: T): T { return JSON.parse(JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item)) as T }
}
