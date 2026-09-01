import { ConflictException, Injectable, NotFoundException } from "@nestjs/common"
import { Prisma } from "@prisma/client"

import { PrismaTransaction } from "../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../prisma.service"

@Injectable()
export class RespondFriendInviteTransaction extends PrismaTransaction<{ inviteId: string; userId: string; response: "DECLINED" | "CANCELED" }, any> {
  constructor(prisma: PrismaService) { super(prisma) }

  protected async execute(input: { inviteId: string; userId: string; response: "DECLINED" | "CANCELED" }, transaction: Prisma.TransactionClient) {
    const invite = await transaction.matchmakingInvite.findUnique({ where: { id: input.inviteId } })
    if (!invite) throw new NotFoundException("Friend match invite not found")
    const authorized = input.response === "DECLINED" ? invite.inviteeId === input.userId : invite.inviterId === input.userId
    if (!authorized) throw new ConflictException("You cannot respond to this invite")
    if (invite.status !== "PENDING") return { inviteId: invite.id, status: invite.status }
    const updated = await transaction.matchmakingInvite.update({ where: { id: invite.id }, data: { status: input.response, respondedAt: new Date() } })
    return { inviteId: updated.id, status: updated.status, respondedAt: updated.respondedAt }
  }
}
