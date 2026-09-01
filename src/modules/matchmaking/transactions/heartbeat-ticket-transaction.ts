import { ConflictException, Injectable, NotFoundException } from "@nestjs/common"
import { Prisma } from "@prisma/client"

import { PrismaTransaction } from "../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../prisma.service"
import { queueTtlSeconds } from "../utilities/matchmaking-policy"

@Injectable()
export class HeartbeatTicketTransaction extends PrismaTransaction<{ ticketId: string; userId: string }, any> {
  constructor(prisma: PrismaService) { super(prisma) }

  protected async execute(input: { ticketId: string; userId: string }, transaction: Prisma.TransactionClient) {
    const ticket = await transaction.matchmakingTicket.findFirst({ where: { id: input.ticketId, userId: input.userId } })
    if (!ticket) throw new NotFoundException("Matchmaking ticket not found")
    if (ticket.status !== "SEARCHING") return { ticket: { id: ticket.id, status: ticket.status, matchId: ticket.matchId } }
    const now = new Date()
    if (ticket.expiresAt <= now) {
      await transaction.matchmakingTicket.update({ where: { id: ticket.id }, data: { status: "EXPIRED" } })
      throw new ConflictException("The matchmaking ticket has expired")
    }
    const updated = await transaction.matchmakingTicket.update({ where: { id: ticket.id }, data: { lastHeartbeatAt: now, expiresAt: new Date(now.getTime() + queueTtlSeconds() * 1000) } })
    return { ticket: { id: updated.id, status: updated.status, expiresAt: updated.expiresAt, lastHeartbeatAt: updated.lastHeartbeatAt, matchId: updated.matchId } }
  }
}
