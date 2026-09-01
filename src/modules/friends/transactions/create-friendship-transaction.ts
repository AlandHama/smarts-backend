import { ConflictException, Injectable, NotFoundException } from "@nestjs/common"
import { Prisma, UserStatus } from "@prisma/client"

import { PrismaTransaction } from "../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../prisma.service"

export class CreateFriendshipInput { userId!: string; friendId!: string }

@Injectable()
export class CreateFriendshipTransaction extends PrismaTransaction<CreateFriendshipInput, { message: string }> {
  constructor(prisma: PrismaService) { super(prisma) }

  protected async execute(input: CreateFriendshipInput, transaction: Prisma.TransactionClient) {
    if (input.userId === input.friendId) throw new ConflictException("A player cannot be friends with themselves")
    const users = await transaction.user.findMany({ where: { id: { in: [input.userId, input.friendId] } }, select: { id: true, status: true } })
    if (users.length !== 2 || users.some((user) => user.status !== UserStatus.ACTIVE)) throw new NotFoundException("Both players must be active")
    const blocked = await transaction.friendBlock.findFirst({ where: { OR: [{ blockerId: input.userId, blockedId: input.friendId }, { blockerId: input.friendId, blockedId: input.userId }] } })
    if (blocked) throw new ConflictException("Unblock this relationship before making the players friends")
    const now = new Date()
    await transaction.friendship.createMany({ data: [{ userId: input.userId, friendId: input.friendId, acceptedAt: now }, { userId: input.friendId, friendId: input.userId, acceptedAt: now }], skipDuplicates: true })
    await transaction.friendRequest.updateMany({ where: { OR: [{ requesterId: input.userId, addresseeId: input.friendId }, { requesterId: input.friendId, addresseeId: input.userId }] }, data: { status: "ACCEPTED", respondedAt: now } })
    return { message: "Players are now friends" }
  }
}
