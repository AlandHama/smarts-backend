import { Injectable, NotFoundException } from "@nestjs/common"
import { PlayerAuditActorType, Prisma } from "@prisma/client"

import { PrismaTransaction } from "../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../prisma.service"
import { writePlayerAudit } from "../../../common/helpers/player-audit"

@Injectable()
export class UpdateEloTransaction extends PrismaTransaction<{ userId: string; elo: number }, void> {
  constructor(prisma: PrismaService) {
    super(prisma)
  }

  protected async execute(data: { userId: string; elo: number }, transaction: Prisma.TransactionClient) {
    const stats = await transaction.playerStats.findUnique({ where: { userId: data.userId } })
    if (!stats) throw new NotFoundException("Player stats not found")
    const before = await transaction.playerProfile.findUnique({ where: { userId: data.userId }, select: { elo: true } })
    const profile = await transaction.playerProfile.update({ where: { userId: data.userId }, data: { elo: data.elo } })
    if (data.elo > stats.highestElo) {
      await transaction.playerStats.update({ where: { userId: data.userId }, data: { highestElo: data.elo } })
    }
    await writePlayerAudit(transaction, { userId: data.userId, actorType: PlayerAuditActorType.SYSTEM, action: "ELO_CHANGED", entityType: "PlayerProfile", entityId: profile.userId, summary: `Changed ELO from ${before?.elo ?? "unknown"} to ${data.elo}`, changes: { elo: { old: before?.elo ?? null, new: data.elo }, highestElo: { old: stats.highestElo, new: Math.max(stats.highestElo, data.elo) } }, metadata: { source: "server" } })
  }
}
