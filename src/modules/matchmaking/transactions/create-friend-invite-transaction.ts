import { ConflictException, Injectable, NotFoundException } from "@nestjs/common"
import { Prisma } from "@prisma/client"

import { PrismaTransaction } from "../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../prisma.service"
import { CreateFriendInviteDto } from "../dtos"
import { friendInviteTtlSeconds } from "../utilities/matchmaking-policy"

@Injectable()
export class CreateFriendInviteTransaction extends PrismaTransaction<{ userId: string; dto: CreateFriendInviteDto }, any> {
  constructor(prisma: PrismaService) { super(prisma) }

  protected async execute(input: { userId: string; dto: CreateFriendInviteDto }, transaction: Prisma.TransactionClient) {
    if (input.userId === input.dto.friendId) throw new ConflictException("A player cannot invite themselves")
    const users = await transaction.user.findMany({ where: { id: { in: [input.userId, input.dto.friendId] } }, select: { id: true, status: true } })
    if (users.length !== 2 || users.some((user) => user.status !== "ACTIVE")) throw new NotFoundException("Both players must be active")
    const friendship = await transaction.friendship.findFirst({ where: { OR: [{ userId: input.userId, friendId: input.dto.friendId }, { userId: input.dto.friendId, friendId: input.userId }] }, select: { id: true } })
    if (!friendship) throw new ConflictException("Players must be friends before sending a match invite")
    const game = await transaction.gameDefinition.findUnique({ where: { key: input.dto.gameKey.trim().toLowerCase() }, include: { configs: { where: { active: true }, orderBy: { version: "desc" }, take: 1 } } })
    if (!game || !game.active || !game.configs[0]) throw new NotFoundException("Game definition or configuration is inactive")
    const pending = await transaction.matchmakingInvite.findFirst({ where: { OR: [{ inviterId: input.userId, inviteeId: input.dto.friendId }, { inviterId: input.dto.friendId, inviteeId: input.userId }], status: "PENDING", expiresAt: { gt: new Date() } } })
    if (pending) throw new ConflictException("A friend match invite is already pending")
    const now = new Date()
    const invite = await transaction.matchmakingInvite.create({ data: { inviterId: input.userId, inviteeId: input.dto.friendId, gameDefinitionId: game.id, expiresAt: new Date(now.getTime() + friendInviteTtlSeconds() * 1000) } })
    return { invite: { id: invite.id, status: invite.status, gameKey: game.key, expiresAt: invite.expiresAt, inviterId: invite.inviterId, inviteeId: invite.inviteeId } }
  }
}
