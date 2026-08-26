import { Injectable } from "@nestjs/common"
import { Prisma } from "@prisma/client"

import { PrismaTransaction } from "../../../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../../../prisma.service"

export interface SessionCreateData {
  userId: string
  tokenId: string
  refreshTokenHash: string
  expiresAt: Date
  isMobileSession?: boolean
  clientVersion?: string
  deviceInfo?: string
  ipAddress?: string
  deviceName?: string
  location?: string
}

@Injectable()
export class CreateSessionTransaction extends PrismaTransaction<SessionCreateData, any> {
  constructor(prisma: PrismaService) {
    super(prisma)
  }

  protected execute(data: SessionCreateData, transaction: Prisma.TransactionClient) {
    return transaction.session.create({ data })
  }
}
