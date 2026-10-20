import { Injectable } from "@nestjs/common"
import { Prisma } from "@prisma/client"

import { PrismaTransaction } from "../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../prisma.service"
import { SettleMatchTransaction } from "./settle-match-transaction"

@Injectable()
export class ExpireMatchTransaction extends PrismaTransaction<void, { expired: number }> {
  constructor(prisma: PrismaService, private readonly settleMatch: SettleMatchTransaction) { super(prisma) }

  protected async execute(_: void, transaction: Prisma.TransactionClient) {
    const now = new Date()
    const matches = await transaction.match.findMany({ where: { status: { in: ["CREATED", "STARTED"] }, OR: [{ createdAt: { lte: now } }] }, include: { gameDefinition: { select: { key: true } }, gameConfig: { select: { maxMatchDurationSeconds: true } }, rankingMatch: true, participants: { select: { userId: true, participantType: true, result: true } } }, take: 100 })
    let expired = 0
    for (const match of matches) {
      // Gem Blitz has its own authoritative clock, bot simulation, and
      // settlement path. Let GemBlitzService finalize it; the generic expiry
      // worker cannot see its board state and would incorrectly cancel it.
      if (match.gameDefinition.key === "gem_blitz" || match.gameDefinition.key === "tile_rush" || match.gameDefinition.key === "word_dash" || match.gameDefinition.key === "domino" || match.gameDefinition.key === "perfect_timing" || match.gameDefinition.key === "bomb_path") continue
      // Flutter submits FINISH when its synchronized match clock reaches the
      // limit. Give that request a small server-side network grace window so
      // the expiry worker cannot cancel a legitimate completion at the exact
      // boundary.
      const cutoff = new Date(now.getTime() - (match.gameConfig.maxMatchDurationSeconds + this.finishGraceSeconds()) * 1000)
      const reference = match.status === "STARTED" ? (await transaction.match.findUnique({ where: { id: match.id }, select: { startedAt: true } }))?.startedAt : match.createdAt
      if (!reference || reference > cutoff) continue
      await transaction.$queryRaw`SELECT "id" FROM "Match" WHERE "id" = ${match.id} FOR UPDATE`
      const current = await transaction.match.findUnique({ where: { id: match.id }, select: { status: true } })
      if (current?.status !== "CREATED" && current?.status !== "STARTED") continue
      // FINISH and expiry can race at the duration boundary. If all human
      // participants already submitted, preserve the match as completed so a
      // successful math/bot game is never converted into CANCELLED.
      const pendingHumans = match.participants.filter(
        (participant) => participant.participantType === "PLAYER" && participant.result === "PENDING",
      ).length
      if (pendingHumans === 0) {
        await transaction.matchParticipant.updateMany({ where: { matchId: match.id, participantType: "PLAYER", result: "PENDING" }, data: { result: "COMPLETED", submittedAt: now, lastActivityAt: now, disconnectGraceUntil: null } })
        await transaction.matchRound.updateMany({ where: { matchId: match.id, status: { in: ["CREATED", "STARTED"] } }, data: { status: "FINISHED", endedAt: now } })
        await transaction.match.update({ where: { id: match.id }, data: { status: "FINISHED", endedAt: now } })
        const human = match.participants.find((participant) => participant.participantType === "PLAYER" && participant.userId)
        if (human?.userId) await this.settleMatch.runWithinTransaction({ matchId: match.id, userId: human.userId, idempotencyKey: `match-timeout-settle:${match.id}` }, transaction)
        continue
      }
      await transaction.matchParticipant.updateMany({ where: { matchId: match.id, participantType: "PLAYER", result: "PENDING" }, data: { result: "FORFEIT", submittedAt: now, lastActivityAt: now, disconnectGraceUntil: null, terminationReason: "TIMEOUT" } })
      await transaction.matchRound.updateMany({ where: { matchId: match.id, status: { in: ["CREATED", "STARTED"] } }, data: { status: "FINISHED", endedAt: now } })
      await transaction.match.update({ where: { id: match.id }, data: { status: "FINISHED", endedAt: now } })
      const human = match.participants.find((participant) => participant.participantType === "PLAYER" && participant.userId)
      if (human?.userId) await this.settleMatch.runWithinTransaction({ matchId: match.id, userId: human.userId, idempotencyKey: `match-timeout-settle:${match.id}` }, transaction)
      expired += 1
    }
    return { expired }
  }

  private finishGraceSeconds() {
    const value = Number(process.env.MATCH_FINISH_GRACE_SECONDS)
    return Number.isFinite(value) && value >= 3 && value <= 60 ? Math.floor(value) : 15
  }
}
