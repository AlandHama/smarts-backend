import { Injectable, NotFoundException } from "@nestjs/common"
import { Prisma, LeaderboardSeasonStatus } from "@prisma/client"

import { PrismaTransaction } from "../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../prisma.service"

@Injectable()
export class CloseSeasonTransaction extends PrismaTransaction<string, any> {
  constructor(prisma: PrismaService) { super(prisma) }

  protected async execute(id: string, transaction: Prisma.TransactionClient) {
    const season = await transaction.leaderboardSeason.findUnique({ where: { id }, select: { id: true, status: true } })
    if (!season) throw new NotFoundException("Leaderboard season not found")
    if (season.status === LeaderboardSeasonStatus.CLOSED) return season
    return transaction.leaderboardSeason.update({ where: { id }, data: { status: LeaderboardSeasonStatus.CLOSED, resetAt: new Date() } })
  }
}
