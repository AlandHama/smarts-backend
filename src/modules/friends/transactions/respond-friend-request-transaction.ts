import { ConflictException, Injectable, NotFoundException } from "@nestjs/common"
import { FriendRequestStatus, Prisma } from "@prisma/client"

import { PrismaTransaction } from "../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../prisma.service"

export type FriendRequestResponse = "DECLINED" | "CANCELED"
export class RespondFriendRequestInput { requesterId!: string; addresseeId!: string; actorId!: string; response!: FriendRequestResponse }

@Injectable()
export class RespondFriendRequestTransaction extends PrismaTransaction<RespondFriendRequestInput, any> {
  constructor(prisma: PrismaService) { super(prisma) }

  protected async execute(input: RespondFriendRequestInput, transaction: Prisma.TransactionClient) {
    const canRespond = input.response === "DECLINED" ? input.actorId === input.addresseeId : input.actorId === input.requesterId
    if (!canRespond) throw new ConflictException("You cannot change this friend request")
    const request = await transaction.friendRequest.findUnique({ where: { requesterId_addresseeId: { requesterId: input.requesterId, addresseeId: input.addresseeId } } })
    if (!request || request.status !== FriendRequestStatus.PENDING) throw new NotFoundException("Pending friend request not found")
    return transaction.friendRequest.update({ where: { id: request.id }, data: { status: input.response, respondedAt: new Date() } })
  }
}
