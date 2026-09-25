import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common"
import { Prisma } from "@prisma/client"

import { PrismaTransaction } from "../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../prisma.service"
import { reconcilePlayerProgressionRows } from "./reconcile-player-progression"

@Injectable()
export class DeleteProgressionTierTransaction extends PrismaTransaction<string, void> {
  constructor(prisma: PrismaService) { super(prisma) }

  protected async execute(id: string, transaction: Prisma.TransactionClient) {
    const tier = await transaction.progressionTier.findUnique({ where: { id }, select: { id: true, progressionId: true, step: true } })
    if (!tier) throw new NotFoundException("Progression tier not found")
    const tierCount = await transaction.progressionTier.count({ where: { progressionId: tier.progressionId } })
    if (tier.step === 1) throw new BadRequestException("The first progression tier cannot be deleted")
    if (tierCount <= 1) throw new BadRequestException("A progression must keep at least one tier")
    await transaction.progressionTier.delete({ where: { id } })
    await reconcilePlayerProgressionRows(transaction, tier.progressionId)
  }
}
