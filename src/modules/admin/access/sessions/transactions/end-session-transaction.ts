import { Injectable } from "@nestjs/common"
import { PlayerAuditActorType, Prisma } from "@prisma/client"

import { PrismaTransaction } from "../../../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../../../prisma.service"
import { writePlayerAudit } from "../../../../../common/helpers/player-audit"

@Injectable()
export class EndSessionTransaction extends PrismaTransaction<{ userId: string; tokenId: string }, void> {
  constructor(prisma: PrismaService) {
    super(prisma)
  }

  protected async execute(data: { userId: string; tokenId: string }, transaction: Prisma.TransactionClient) {
    const result = await transaction.session.updateMany({
      where: { userId: data.userId, tokenId: data.tokenId, sessionStatus: "ACTIVE" },
      data: { sessionStatus: "TERMINATED" },
    })
    if (result.count) await writePlayerAudit(transaction, { userId: data.userId, actorType: PlayerAuditActorType.PLAYER, action: "SESSION_ENDED", entityType: "Session", summary: "Ended an authenticated session" })
  }
}
