import { ConflictException, Injectable, NotFoundException } from "@nestjs/common"
import { Prisma } from "@prisma/client"

import { PrismaTransaction } from "../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../prisma.service"

@Injectable()
export class ForfeitMatchTransaction extends PrismaTransaction<{ matchId: string; userId: string }, any> {
  constructor(prisma: PrismaService) { super(prisma) }

  protected async execute(input: { matchId: string; userId: string }, transaction: Prisma.TransactionClient) {
    await transaction.$executeRaw`SELECT "id" FROM "Match" WHERE "id" = ${input.matchId} FOR UPDATE`
    const match = await transaction.match.findUnique({ where: { id: input.matchId }, include: { participants: true, rounds: { where: { status: { in: ["CREATED", "STARTED"] } }, orderBy: { roundIndex: "desc" }, take: 1 } } })
    if (!match) throw new NotFoundException("Match not found")
    const participant = match.participants.find((item) => item.userId === input.userId)
    if (!participant) throw new NotFoundException("Player is not a participant in this match")
    if (match.status !== "STARTED" && match.status !== "CREATED") throw new ConflictException("The match is no longer active")
    const round = match.rounds[0]
    if (!round) throw new ConflictException("The match has no active round")
    if (participant.result !== "PENDING") return { matchId: match.id, status: match.status, result: participant.result }
    const previous = await transaction.matchEvent.findFirst({ where: { matchId: match.id, participantId: participant.id }, orderBy: { sequence: "desc" }, select: { sequence: true } })
    await transaction.matchEvent.create({ data: { matchId: match.id, participantId: participant.id, roundId: round.id, sequence: (previous?.sequence ?? 0) + 1, eventType: "FORFEIT", clientEventId: `server-forfeit-${participant.id}-${Date.now()}`, accepted: true, payload: { submitted: true } as Prisma.InputJsonValue } })
    await transaction.matchParticipant.update({ where: { id: participant.id }, data: { result: "FORFEIT", submittedAt: new Date() } })
    const otherPending = match.participants.some((item) => item.id !== participant.id && item.participantType === "PLAYER" && item.result === "PENDING")
    if (!otherPending) {
      const endedAt = new Date()
      await transaction.matchRound.updateMany({ where: { matchId: match.id, status: { in: ["CREATED", "STARTED"] } }, data: { status: "FINISHED", endedAt } })
      await transaction.match.update({ where: { id: match.id }, data: { status: "FINISHED", endedAt } })
    }
    return { matchId: match.id, status: otherPending ? match.status : "FINISHED", result: "FORFEIT" }
  }
}
