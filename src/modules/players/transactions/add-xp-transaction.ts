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
    const before = await transaction.playerProfile.findUnique({ where: { userId: data.userId }, select: { xp: true } })
    const profile = await transaction.playerProfile.update({ where: { userId: data.userId }, data: { xp: { increment: data.amount } } })
    await writePlayerAudit(transaction, { userId: data.userId, actorType: PlayerAuditActorType.SYSTEM, action: "XP_INCREASED", entityType: "PlayerProfile", entityId: profile.userId, summary: `Increased XP by ${data.amount.toString()}`, changes: { xp: { old: before?.xp ?? null, new: profile.xp }, delta: { old: 0n, new: data.amount } }, metadata: { source: "server" } })
  }
}
