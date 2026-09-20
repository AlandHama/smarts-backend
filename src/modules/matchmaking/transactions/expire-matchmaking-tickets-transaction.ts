import { Injectable } from "@nestjs/common"
import { Prisma, WalletTransactionSourceType } from "@prisma/client"

import { PrismaTransaction } from "../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../prisma.service"
import { queueHeartbeatTimeoutSeconds } from "../utilities/matchmaking-policy"
import { CreditWalletTransaction } from "../../economy/transactions/credit-wallet-transaction"

@Injectable()
export class ExpireMatchmakingTicketsTransaction extends PrismaTransaction<void, { expired: number }> {
  constructor(prisma: PrismaService, private readonly creditWallet: CreditWalletTransaction) { super(prisma) }

  protected async execute(_: void, transaction: Prisma.TransactionClient) {
    const now = new Date()
    const heartbeatCutoff = new Date(now.getTime() - queueHeartbeatTimeoutSeconds() * 1000)
    const tickets = await transaction.matchmakingTicket.findMany({ where: { status: "SEARCHING", OR: [{ expiresAt: { lte: now } }, { lastHeartbeatAt: { lte: heartbeatCutoff } }] }, select: { id: true, userId: true, rankingStakeAmount: true, rankingRefundedAt: true } })
    for (const ticket of tickets) {
      await transaction.matchmakingTicket.update({ where: { id: ticket.id }, data: { status: "EXPIRED" } })
      if (ticket.rankingStakeAmount && !ticket.rankingRefundedAt) {
        await this.creditWallet.runWithinTransaction({ userId: ticket.userId, currencyCode: "GLD", amount: ticket.rankingStakeAmount, sourceId: `${ticket.id}:expire-refund`, sourceType: WalletTransactionSourceType.RANKING_MATCH_REFUND, metadata: { ticketId: ticket.id, reason: "ranking_queue_expired" } }, transaction)
        await transaction.matchmakingTicket.update({ where: { id: ticket.id }, data: { rankingRefundedAt: now } })
      }
    }
    return { expired: tickets.length }
  }
}
