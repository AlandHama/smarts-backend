import { Injectable } from "@nestjs/common"
import { Prisma } from "@prisma/client"

import { PrismaTransaction } from "../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../prisma.service"

@Injectable()
export class HeartbeatPresenceTransaction extends PrismaTransaction<string, any> {
  constructor(prisma: PrismaService) { super(prisma) }

  protected async execute(userId: string, transaction: Prisma.TransactionClient) {
    const now = new Date()
    return transaction.presence.upsert({ where: { userId }, create: { userId, lastHeartbeatAt: now, lastSeenAt: now }, update: { lastHeartbeatAt: now, lastSeenAt: now } })
  }
}
