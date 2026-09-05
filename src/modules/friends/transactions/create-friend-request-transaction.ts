import { ConflictException, Injectable, NotFoundException } from "@nestjs/common"
import { FriendRequestStatus, PlayerAuditActorType, Prisma, UserStatus } from "@prisma/client"

import { PrismaTransaction } from "../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../prisma.service"
import { writePlayerAudit } from "../../../common/helpers/player-audit"

export class CreateFriendRequestInput { requesterId!: string; addresseeId!: string }

@Injectable()
export class CreateFriendRequestTransaction extends PrismaTransaction<CreateFriendRequestInput, any> {
  constructor(prisma: PrismaService) { super(prisma) }

  protected async execute(input: CreateFriendRequestInput, transaction: Prisma.TransactionClient) {
    if (input.requesterId === input.addresseeId) throw new ConflictException("You cannot send a friend request to yourself")
    const target = await transaction.user.findUnique({ where: { id: input.addresseeId }, select: { id: true, status: true } })
    if (!target || target.status !== UserStatus.ACTIVE) throw new NotFoundException("Player not found")
    const blocked = await transaction.friendBlock.findFirst({ where: { OR: [{ blockerId: input.requesterId, blockedId: input.addresseeId }, { blockerId: input.addresseeId, blockedId: input.requesterId }] } })
    if (blocked) throw new ConflictException("This player relationship is blocked")
    const friendship = await transaction.friendship.findFirst({ where: { OR: [{ userId: input.requesterId, friendId: input.addresseeId }, { userId: input.addresseeId, friendId: input.requesterId }] } })
    if (friendship) throw new ConflictException("You are already friends")
    const existing = await transaction.friendRequest.findUnique({ where: { requesterId_addresseeId: { requesterId: input.requesterId, addresseeId: input.addresseeId } } })
    if (existing?.status === FriendRequestStatus.PENDING) throw new ConflictException("Friend request already sent")
    if (existing?.status === FriendRequestStatus.ACCEPTED) throw new ConflictException("You are already friends")
    const reverse = await transaction.friendRequest.findUnique({ where: { requesterId_addresseeId: { requesterId: input.addresseeId, addresseeId: input.requesterId } } })
    if (reverse?.status === FriendRequestStatus.PENDING) throw new ConflictException("This player already sent you a friend request")
    const request = existing
      ? transaction.friendRequest.update({ where: { id: existing.id }, data: { status: FriendRequestStatus.PENDING, createdAt: new Date(), respondedAt: null } })
      : transaction.friendRequest.create({ data: { requesterId: input.requesterId, addresseeId: input.addresseeId } })
    await request.then(async (row) => {
      await writePlayerAudit(transaction, { userId: input.requesterId, actorType: PlayerAuditActorType.PLAYER, action: "FRIEND_REQUEST_SENT", entityType: "FriendRequest", entityId: row.id, summary: "Sent a friend request", metadata: { addresseeId: input.addresseeId } })
      await writePlayerAudit(transaction, { userId: input.addresseeId, actorType: PlayerAuditActorType.SYSTEM, action: "FRIEND_REQUEST_RECEIVED", entityType: "FriendRequest", entityId: row.id, summary: "Received a friend request", metadata: { requesterId: input.requesterId } })
    })
    return request
  }
}
