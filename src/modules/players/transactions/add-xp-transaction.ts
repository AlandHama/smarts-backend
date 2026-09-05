import { Injectable } from "@nestjs/common"
import { PlayerAuditActorType, Prisma } from "@prisma/client"

import { PrismaTransaction } from "../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../prisma.service"
import { writePlayerAudit } from "../../../common/helpers/player-audit"

@Injectable()
export class AddXpTransaction extends PrismaTransaction<{ userId: string; amount: bigint }, void> {
  constructor(prisma: PrismaService) {
    super(prisma)
  }

  protected async execute(data: { userId: string; amount: bigint }, transaction: Prisma.TransactionClient) {
    if (data.amount < 0n) throw new RangeError("XP amount cannot be negative")
    const profile = await transaction.playerProfile.update({ where: { userId: data.userId }, data: { xp: { increment: data.amount } } })
    await writePlayerAudit(transaction, { userId: data.userId, actorType: PlayerAuditActorType.SYSTEM, action: "XP_INCREASED", entityType: "PlayerProfile", entityId: profile.userId, summary: `Increased XP by ${data.amount.toString()}`, metadata: { amount: data.amount.toString(), xpAfter: profile.xp.toString() } })
  }
}
