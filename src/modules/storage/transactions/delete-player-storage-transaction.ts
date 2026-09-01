import { Injectable, NotFoundException } from "@nestjs/common"
import { Prisma } from "@prisma/client"

import { PrismaTransaction } from "../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../prisma.service"

export class DeletePlayerStorageInput { userId!: string; key!: string }

@Injectable()
export class DeletePlayerStorageTransaction extends PrismaTransaction<DeletePlayerStorageInput, { message: string }> {
  constructor(prisma: PrismaService) { super(prisma) }

  protected async execute(input: DeletePlayerStorageInput, transaction: Prisma.TransactionClient) {
    const item = await transaction.playerStorageItem.findUnique({ where: { userId_key: { userId: input.userId, key: input.key } } })
    if (!item) throw new NotFoundException("Storage entry not found")
    await transaction.playerStorageItem.delete({ where: { id: item.id } })
    return { message: "Storage entry deleted" }
  }
}
