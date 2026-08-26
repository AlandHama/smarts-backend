import { Injectable } from "@nestjs/common"
import { Prisma } from "@prisma/client"

import { PrismaTransaction } from "../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../prisma.service"

@Injectable()
export class AddXpTransaction extends PrismaTransaction<{ userId: string; amount: bigint }, void> {
  constructor(prisma: PrismaService) {
    super(prisma)
  }

  protected async execute(data: { userId: string; amount: bigint }, transaction: Prisma.TransactionClient) {
    if (data.amount < 0n) throw new RangeError("XP amount cannot be negative")
    await transaction.playerProfile.update({ where: { userId: data.userId }, data: { xp: { increment: data.amount } } })
  }
}
