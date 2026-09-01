import { Injectable, NotFoundException } from "@nestjs/common"
import { Prisma } from "@prisma/client"

import { PrismaTransaction } from "../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../prisma.service"

export class RemoveFriendshipInput { userId!: string; friendId!: string }

@Injectable()
export class RemoveFriendshipTransaction extends PrismaTransaction<RemoveFriendshipInput, { message: string }> {
  constructor(prisma: PrismaService) { super(prisma) }

  protected async execute(input: RemoveFriendshipInput, transaction: Prisma.TransactionClient) {
    const result = await transaction.friendship.deleteMany({ where: { OR: [{ userId: input.userId, friendId: input.friendId }, { userId: input.friendId, friendId: input.userId }] } })
    if (!result.count) throw new NotFoundException("Friendship not found")
    return { message: "Friendship removed" }
  }
}
