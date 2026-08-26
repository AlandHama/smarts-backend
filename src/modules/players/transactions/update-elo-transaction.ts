import { Injectable, NotFoundException } from "@nestjs/common"
import { Prisma } from "@prisma/client"

import { PrismaTransaction } from "../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../prisma.service"

@Injectable()
export class UpdateEloTransaction extends PrismaTransaction<{ userId: string; elo: number }, void> {
  constructor(prisma: PrismaService) {
    super(prisma)
  }

  protected async execute(data: { userId: string; elo: number }, transaction: Prisma.TransactionClient) {
    const stats = await transaction.playerStats.findUnique({ where: { userId: data.userId } })
    if (!stats) throw new NotFoundException("Player stats not found")
    await transaction.playerProfile.update({ where: { userId: data.userId }, data: { elo: data.elo } })
    if (data.elo > stats.highestElo) {
      await transaction.playerStats.update({ where: { userId: data.userId }, data: { highestElo: data.elo } })
    }
  }
}
