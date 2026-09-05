import { Injectable } from "@nestjs/common"
import { PlayerAuditActorType, Prisma } from "@prisma/client"

import { PrismaTransaction } from "../../../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../../../prisma.service"
import { writePlayerAudit } from "../../../../../common/helpers/player-audit"

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
    return transaction.session.create({ data }).then(async (session) => {
      await writePlayerAudit(transaction, { userId: data.userId, actorType: PlayerAuditActorType.SYSTEM, action: "SESSION_STARTED", entityType: "Session", entityId: session.id, summary: `Started a ${data.isMobileSession ? "mobile" : "web"} session`, metadata: { isMobileSession: data.isMobileSession ?? true, deviceName: data.deviceName, clientVersion: data.clientVersion } })
      return session
    })
  }
}
