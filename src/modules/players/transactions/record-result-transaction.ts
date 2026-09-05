import { Injectable, NotFoundException } from "@nestjs/common"
import { PlayerAuditActorType, Prisma } from "@prisma/client"

import { PrismaTransaction } from "../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../prisma.service"
import { writePlayerAudit } from "../../../common/helpers/player-audit"

export type PlayerResult = "win" | "loss" | "draw"

@Injectable()
export class RecordResultTransaction extends PrismaTransaction<{ userId: string; result: PlayerResult }, void> {
  constructor(prisma: PrismaService) {
    super(prisma)
  }

  protected async execute(data: { userId: string; result: PlayerResult }, transaction: Prisma.TransactionClient) {
    const stats = await transaction.playerStats.findUnique({ where: { userId: data.userId } })
    if (!stats) throw new NotFoundException("Player stats not found")

    const currentWinStreak = data.result === "win" ? stats.currentWinStreak + 1 : 0
    const updated = await transaction.playerStats.update({
      where: { userId: data.userId },
      data: {
        gamesPlayed: { increment: 1 },
        wins: data.result === "win" ? { increment: 1 } : undefined,
        losses: data.result === "loss" ? { increment: 1 } : undefined,
        draws: data.result === "draw" ? { increment: 1 } : undefined,
        currentWinStreak,
        highestWinStreak: currentWinStreak > stats.highestWinStreak ? currentWinStreak : undefined,
      },
    })
    await writePlayerAudit(transaction, { userId: data.userId, actorType: PlayerAuditActorType.SYSTEM, action: "MATCH_RESULT_RECORDED", entityType: "PlayerStats", entityId: stats.id, summary: `Recorded a ${data.result} result`, changes: { gamesPlayed: { old: stats.gamesPlayed, new: updated.gamesPlayed }, wins: { old: stats.wins, new: updated.wins }, losses: { old: stats.losses, new: updated.losses }, draws: { old: stats.draws, new: updated.draws }, currentWinStreak: { old: stats.currentWinStreak, new: updated.currentWinStreak } }, metadata: { result: data.result } })
  }
}
