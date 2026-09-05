import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common"
import { createHash } from "node:crypto"
import { Prisma, LeaderboardMemberType, LeaderboardScoreSourceType, PlayerAuditActorType } from "@prisma/client"

import { PrismaTransaction } from "../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../prisma.service"
import { writeAdminAudit } from "../../../common/helpers/admin-audit"
import { writePlayerAudit } from "../../../common/helpers/player-audit"

export type ApplyLeaderboardScoreInput = {
  leaderboardKey: string
  playerId?: string
  memberKey?: string
  delta: bigint
  sourceId: string
  sourceType: LeaderboardScoreSourceType
  metadata?: Record<string, unknown>
  actorId?: string
  reason?: string
}

@Injectable()
export class ApplyLeaderboardScoreTransaction extends PrismaTransaction<ApplyLeaderboardScoreInput, any> {
  constructor(prisma: PrismaService) { super(prisma) }

  protected async execute(input: ApplyLeaderboardScoreInput, transaction: Prisma.TransactionClient) {
    const sourceId = input.sourceId.trim()
    if (!sourceId) throw new BadRequestException("A score source id is required")
    if (input.delta === 0n) throw new BadRequestException("Score delta cannot be zero")
    const key = input.leaderboardKey.trim().toLowerCase()
    const board = await transaction.leaderboard.findUnique({ where: { key }, select: { id: true, key: true, name: true, memberType: true, active: true, period: true } })
    if (!board || !board.active) throw new NotFoundException("Leaderboard not found or inactive")

    const now = new Date()
    let season = await transaction.leaderboardSeason.findFirst({ where: { leaderboardId: board.id, status: "ACTIVE", startsAt: { lte: now }, endsAt: { gt: now } }, orderBy: { startsAt: "desc" } })
    if (!season && board.period === "ALL_TIME") {
      const startsAt = new Date("1970-01-01T00:00:00.000Z")
      const existing = await transaction.leaderboardSeason.findUnique({ where: { leaderboardId_startsAt: { leaderboardId: board.id, startsAt } } })
      if (existing?.status === "CLOSED") throw new ConflictException("The all-time leaderboard season is closed")
      season = existing?.status === "SCHEDULED"
        ? await transaction.leaderboardSeason.update({ where: { id: existing.id }, data: { status: "ACTIVE" } })
        : existing ?? await transaction.leaderboardSeason.create({ data: { leaderboardId: board.id, startsAt, endsAt: new Date("9999-12-31T23:59:59.999Z"), status: "ACTIVE" } })
    }
    if (!season) throw new ConflictException("The leaderboard has no active season")

    const member = await this.resolveMember(transaction, board.memberType, input)
    // IdempotencyKey.scope is limited to 100 characters. UUIDs for the board,
    // season, and member do not fit when concatenated, and that previously
    // caused the admin score endpoint to fail before it could write a score.
    // The source id is the caller's idempotency identity, so the board scope
    // is sufficient and deliberately keeps the value bounded.
    const scope = `leaderboard-score:${board.id}`
    const requestHash = createHash("sha256").update(JSON.stringify({ boardId: board.id, seasonId: season.id, memberKey: member.memberKey, delta: input.delta.toString(), sourceId, sourceType: input.sourceType, metadata: input.metadata ?? null })).digest("hex")
    let idempotency = await transaction.idempotencyKey.findUnique({ where: { scope_key: { scope, key: sourceId } } })
    if (!idempotency) {
      try {
        idempotency = await transaction.idempotencyKey.create({ data: { scope, key: sourceId, requestHash, status: "PROCESSING" } })
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error
        idempotency = await transaction.idempotencyKey.findUniqueOrThrow({ where: { scope_key: { scope, key: sourceId } } })
      }
    }
    if (idempotency.requestHash !== requestHash) throw new ConflictException("The source id was already used for a different leaderboard score")
    if (idempotency.status === "COMPLETED" && idempotency.responseJson) return idempotency.responseJson

    // Do not rely on Prisma's generated ON CONFLICT target here. Older
    // Railway installations may have the Phase 4 table but be missing its
    // generated unique index; the repair migration restores it, while this
    // read/create path keeps the endpoint recoverable during rollout.
    let entry = await transaction.leaderboardEntry.findUnique({ where: { leaderboardId_seasonId_memberKey: { leaderboardId: board.id, seasonId: season.id, memberKey: member.memberKey } } })
    if (!entry) {
      try {
        entry = await transaction.leaderboardEntry.create({ data: { leaderboardId: board.id, seasonId: season.id, memberKey: member.memberKey, playerId: member.playerId, score: 0n, metadata: member.metadata as Prisma.InputJsonValue | undefined } })
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error
        entry = await transaction.leaderboardEntry.findUniqueOrThrow({ where: { leaderboardId_seasonId_memberKey: { leaderboardId: board.id, seasonId: season.id, memberKey: member.memberKey } } })
      }
    }
    await transaction.$queryRaw`SELECT "id" FROM "LeaderboardEntry" WHERE "id" = ${entry.id} FOR UPDATE`
    entry = await transaction.leaderboardEntry.findUniqueOrThrow({ where: { id: entry.id } })
    const existingEvent = await transaction.leaderboardScoreEvent.findFirst({ where: { entryId: entry.id, sourceType: input.sourceType, sourceId } })
    if (existingEvent) return { leaderboardKey: board.key, seasonId: season.id, entryId: entry.id, memberKey: member.memberKey, scoreBefore: existingEvent.scoreBefore.toString(), scoreAfter: existingEvent.scoreAfter.toString(), delta: existingEvent.delta.toString(), eventId: existingEvent.id }

    const scoreAfter = entry.score + input.delta
    if (scoreAfter < 0n) throw new BadRequestException("Leaderboard score cannot become negative")
    await transaction.leaderboardEntry.update({ where: { id: entry.id }, data: { score: scoreAfter, metadata: member.metadata as Prisma.InputJsonValue | undefined } })
    const event = await transaction.leaderboardScoreEvent.create({ data: { entryId: entry.id, leaderboardId: board.id, seasonId: season.id, memberKey: member.memberKey, playerId: member.playerId, delta: input.delta, scoreBefore: entry.score, scoreAfter, sourceType: input.sourceType, sourceId, idempotencyKeyId: idempotency.id } })
    const response = { leaderboardKey: board.key, seasonId: season.id, entryId: entry.id, memberKey: member.memberKey, scoreBefore: entry.score.toString(), scoreAfter: scoreAfter.toString(), delta: input.delta.toString(), eventId: event.id }
    await transaction.idempotencyKey.update({ where: { id: idempotency.id }, data: { status: "COMPLETED", responseJson: response as unknown as Prisma.InputJsonValue, completedAt: new Date() } })
    if (input.actorId) await writeAdminAudit(transaction, { actorId: input.actorId, action: "LEADERBOARD_SCORE", entityType: "LeaderboardEntry", entityId: entry.id, reason: input.reason, metadata: { leaderboardKey: board.key, playerId: member.playerId, delta: input.delta.toString(), sourceId } })
    if (member.playerId) await writePlayerAudit(transaction, { userId: member.playerId, actorType: input.actorId ? PlayerAuditActorType.ADMIN : PlayerAuditActorType.SYSTEM, action: "LEADERBOARD_SCORE_APPLIED", entityType: "LeaderboardEntry", entityId: entry.id, summary: `${input.delta > 0n ? "Increased" : "Changed"} ${board.name} score by ${input.delta.toString()}`, metadata: { leaderboardKey: board.key, seasonId: season.id, delta: input.delta.toString(), scoreBefore: entry.score.toString(), scoreAfter: scoreAfter.toString(), sourceId } })
    return response
  }

  private async resolveMember(transaction: Prisma.TransactionClient, memberType: LeaderboardMemberType, input: ApplyLeaderboardScoreInput) {
    if (memberType === LeaderboardMemberType.PLAYER) {
      if (!input.playerId) throw new BadRequestException("A player id is required for a player leaderboard")
      const user = await transaction.user.findUnique({ where: { id: input.playerId }, select: { id: true, status: true, profile: { select: { countryCode: true } } } })
      if (!user) throw new NotFoundException("Player not found")
      if (user.status === "BANNED") throw new BadRequestException("Banned players cannot receive leaderboard score")
      return { memberKey: user.id, playerId: user.id, metadata: user.profile?.countryCode ? { countryCode: user.profile.countryCode } : undefined }
    }
    if (input.playerId) throw new BadRequestException("Country and generic leaderboards cannot have a player id")
    const memberKey = input.memberKey?.trim().toUpperCase()
    if (!memberKey || (memberType === LeaderboardMemberType.COUNTRY && !/^[A-Z]{2}$/.test(memberKey))) throw new BadRequestException("A normalized ISO country code is required")
    return { memberKey, playerId: undefined, metadata: memberType === LeaderboardMemberType.COUNTRY ? { countryCode: memberKey } : undefined }
  }
}
