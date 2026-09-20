import { ConflictException, Injectable, NotFoundException } from "@nestjs/common"
import { Prisma, WalletTransactionSourceType } from "@prisma/client"

import { PrismaTransaction } from "../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../prisma.service"
import { CreditWalletTransaction } from "../../economy/transactions/credit-wallet-transaction"

@Injectable()
export class CancelTicketTransaction extends PrismaTransaction<{ ticketId: string; userId: string }, any> {
  constructor(prisma: PrismaService, private readonly creditWallet: CreditWalletTransaction) { super(prisma) }

  protected async execute(input: { ticketId: string; userId: string }, transaction: Prisma.TransactionClient) {
    const ticket = await transaction.matchmakingTicket.findFirst({ where: { id: input.ticketId, userId: input.userId } })
    if (!ticket) throw new NotFoundException("Matchmaking ticket not found")
    if (ticket.status === "MATCHED") throw new ConflictException("A matched ticket cannot be canceled; leave the match instead")
    if (ticket.status !== "SEARCHING") return { ticket: { id: ticket.id, status: ticket.status } }
    const canceled = await transaction.matchmakingTicket.update({ where: { id: ticket.id }, data: { status: "CANCELLED", cancelledAt: new Date() } })
    if (ticket.rankingStakeAmount && !ticket.rankingRefundedAt) {
      await this.creditWallet.runWithinTransaction({ userId: input.userId, currencyCode: "GLD", amount: ticket.rankingStakeAmount, sourceId: `${ticket.id}:cancel-refund`, sourceType: WalletTransactionSourceType.RANKING_MATCH_REFUND, metadata: { ticketId: ticket.id, reason: "ranking_queue_cancelled" } }, transaction)
      await transaction.matchmakingTicket.update({ where: { id: ticket.id }, data: { rankingRefundedAt: new Date() } })
    }
    return { ticket: { id: canceled.id, status: canceled.status, cancelledAt: canceled.cancelledAt } }
  }
}
