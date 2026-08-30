import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common"
import { Prisma } from "@prisma/client"

import { PrismaTransaction } from "../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../prisma.service"

@Injectable()
export class DeleteProgressionTierTransaction extends PrismaTransaction<string, void> {
  constructor(prisma: PrismaService) { super(prisma) }

  protected async execute(id: string, transaction: Prisma.TransactionClient) {
    const tier = await transaction.progressionTier.findUnique({ where: { id }, select: { id: true, progressionId: true } })
    if (!tier) throw new NotFoundException("Progression tier not found")
    const [hasPlayers, tierCount] = await Promise.all([
      transaction.playerProgression.count({ where: { progressionId: tier.progressionId } }),
      transaction.progressionTier.count({ where: { progressionId: tier.progressionId } }),
    ])
    if (hasPlayers) throw new BadRequestException("Tiers cannot be deleted after players have progression")
    if (tierCount <= 1) throw new BadRequestException("A progression must keep at least one tier")
    await transaction.progressionTier.delete({ where: { id } })
  }
}

