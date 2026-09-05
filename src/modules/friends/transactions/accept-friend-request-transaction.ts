import { ConflictException, Injectable, NotFoundException } from "@nestjs/common"
import { FriendRequestStatus, PlayerAuditActorType, Prisma } from "@prisma/client"

import { PrismaTransaction } from "../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../prisma.service"
import { writePlayerAudit } from "../../../common/helpers/player-audit"

export class AcceptFriendRequestInput { requesterId!: string; addresseeId!: string; actorId!: string }

@Injectable()
export class AcceptFriendRequestTransaction extends PrismaTransaction<AcceptFriendRequestInput, any> {
  constructor(prisma: PrismaService) { super(prisma) }

  protected async execute(input: AcceptFriendRequestInput, transaction: Prisma.TransactionClient) {
    if (input.actorId !== input.addresseeId) throw new ConflictException("Only the request recipient can accept it")
    const request = await transaction.friendRequest.findUnique({ where: { requesterId_addresseeId: { requesterId: input.requesterId, addresseeId: input.addresseeId } } })
    if (!request || request.status !== FriendRequestStatus.PENDING) throw new NotFoundException("Pending friend request not found")
    const now = new Date()
    await transaction.friendship.createMany({ data: [{ userId: input.requesterId, friendId: input.addresseeId, acceptedAt: now }, { userId: input.addresseeId, friendId: input.requesterId, acceptedAt: now }], skipDuplicates: true })
    const updated = await transaction.friendRequest.update({ where: { id: request.id }, data: { status: FriendRequestStatus.ACCEPTED, respondedAt: now } })
    await writePlayerAudit(transaction, { userId: input.addresseeId, actorType: PlayerAuditActorType.PLAYER, action: "FRIEND_REQUEST_ACCEPTED", entityType: "FriendRequest", entityId: request.id, summary: "Accepted a friend request", metadata: { requesterId: input.requesterId } })
    await writePlayerAudit(transaction, { userId: input.requesterId, actorType: PlayerAuditActorType.SYSTEM, action: "FRIEND_REQUEST_ACCEPTED", entityType: "FriendRequest", entityId: request.id, summary: "A friend request was accepted", metadata: { addresseeId: input.addresseeId } })
    return updated
  }
}
