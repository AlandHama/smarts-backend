import { Injectable, NotFoundException } from "@nestjs/common"
import { Prisma } from "@prisma/client"

import { PrismaTransaction } from "../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../prisma.service"

export class UnblockPlayerInput { blockerId!: string; blockedId!: string }

@Injectable()
export class UnblockPlayerTransaction extends PrismaTransaction<UnblockPlayerInput, { message: string }> {
  constructor(prisma: PrismaService) { super(prisma) }

  protected async execute(input: UnblockPlayerInput, transaction: Prisma.TransactionClient) {
    const result = await transaction.friendBlock.deleteMany({ where: { blockerId: input.blockerId, blockedId: input.blockedId } })
    if (!result.count) throw new NotFoundException("Block not found")
    return { message: "Player unblocked" }
  }
}
