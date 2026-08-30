import { Injectable, NotFoundException } from "@nestjs/common"
import { Prisma } from "@prisma/client"

import { PrismaTransaction } from "../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../prisma.service"

@Injectable()
export class DeleteProgressionRewardTransaction extends PrismaTransaction<string, void> {
  constructor(prisma: PrismaService) { super(prisma) }

  protected async execute(id: string, transaction: Prisma.TransactionClient) {
    const reward = await transaction.progressionTierReward.findUnique({ where: { id }, select: { id: true } })
    if (!reward) throw new NotFoundException("Progression reward not found")
    await transaction.progressionTierReward.delete({ where: { id } })
  }
}

