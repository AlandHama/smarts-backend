import { ConflictException, Injectable, NotFoundException } from "@nestjs/common"
import { Prisma } from "@prisma/client"

import { PrismaTransaction } from "../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../prisma.service"
import { CompleteMatchDto } from "../dtos"
import { SettleMatchTransaction } from "./settle-match-transaction"

@Injectable()
export class CompleteMatchTransaction extends PrismaTransaction<{ matchId: string; userId: string; dto: CompleteMatchDto }, any> {
  constructor(prisma: PrismaService, private readonly settleMatch: SettleMatchTransaction) { super(prisma) }

  protected async execute(input: { matchId: string; userId: string; dto: CompleteMatchDto }, transaction: Prisma.TransactionClient) {
    const match = await transaction.match.findUnique({ where: { id: input.matchId }, include: { participants: true, settlement: true } })
    if (!match) throw new NotFoundException("Match not found")
    const participant = match.participants.find((item) => item.userId === input.userId)
    if (!participant) throw new NotFoundException("Player is not a participant in this match")
    if (match.settlement) return match.settlement.settlementJson
    if (match.status === "CANCELLED" || match.status === "REVIEW") throw new ConflictException("The match cannot be completed")
    if (participant.result === "PENDING") await transaction.matchParticipant.update({ where: { id: participant.id }, data: { result: "COMPLETED", submittedAt: new Date() } })
    const humanPending = match.participants.some((item) => item.participantType === "PLAYER" && item.id !== participant.id && item.result === "PENDING")
    if (humanPending) {
      return { status: "PENDING", matchId: match.id, message: "Result recorded; waiting for the other player" }
    }
    const endedAt = new Date()
    await transaction.matchRound.updateMany({ where: { matchId: match.id, status: { in: ["CREATED", "STARTED"] } }, data: { status: "FINISHED", endedAt } })
    await transaction.match.update({ where: { id: match.id }, data: { status: "FINISHED", endedAt } })
    return this.settleMatch.runWithinTransaction({ matchId: match.id, userId: input.userId, idempotencyKey: input.dto.idempotencyKey }, transaction)
  }
}
