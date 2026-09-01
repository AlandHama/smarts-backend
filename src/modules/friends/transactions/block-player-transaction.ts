import { ConflictException, Injectable, NotFoundException } from "@nestjs/common"
import { FriendRequestStatus, Prisma, UserStatus } from "@prisma/client"

import { PrismaTransaction } from "../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../prisma.service"

export class BlockPlayerInput { blockerId!: string; blockedId!: string }

@Injectable()
export class BlockPlayerTransaction extends PrismaTransaction<BlockPlayerInput, { message: string }> {
  constructor(prisma: PrismaService) { super(prisma) }

  protected async execute(input: BlockPlayerInput, transaction: Prisma.TransactionClient) {
    if (input.blockerId === input.blockedId) throw new ConflictException("You cannot block yourself")
    const user = await transaction.user.findUnique({ where: { id: input.blockedId }, select: { status: true } })
    if (!user || user.status !== UserStatus.ACTIVE) throw new NotFoundException("Player not found")
    await transaction.friendBlock.upsert({ where: { blockerId_blockedId: { blockerId: input.blockerId, blockedId: input.blockedId } }, create: { blockerId: input.blockerId, blockedId: input.blockedId }, update: {} })
    await transaction.friendship.deleteMany({ where: { OR: [{ userId: input.blockerId, friendId: input.blockedId }, { userId: input.blockedId, friendId: input.blockerId }] } })
    await transaction.friendRequest.updateMany({ where: { status: FriendRequestStatus.PENDING, OR: [{ requesterId: input.blockerId, addresseeId: input.blockedId }, { requesterId: input.blockedId, addresseeId: input.blockerId }] }, data: { status: FriendRequestStatus.CANCELED, respondedAt: new Date() } })
    return { message: "Player blocked" }
  }
}
