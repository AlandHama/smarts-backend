import { Injectable } from "@nestjs/common"
import { Prisma } from "@prisma/client"

import { PrismaTransaction } from "../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../prisma.service"
import { queueHeartbeatTimeoutSeconds } from "../utilities/matchmaking-policy"

@Injectable()
export class ExpireMatchmakingTicketsTransaction extends PrismaTransaction<void, { expired: number }> {
  constructor(prisma: PrismaService) { super(prisma) }

  protected async execute(_: void, transaction: Prisma.TransactionClient) {
    const now = new Date()
    const heartbeatCutoff = new Date(now.getTime() - queueHeartbeatTimeoutSeconds() * 1000)
    const result = await transaction.matchmakingTicket.updateMany({ where: { status: "SEARCHING", OR: [{ expiresAt: { lte: now } }, { lastHeartbeatAt: { lte: heartbeatCutoff } }] }, data: { status: "EXPIRED" } })
    return { expired: result.count }
  }
}
