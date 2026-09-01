import { ConflictException, Injectable, NotFoundException } from "@nestjs/common"
import { createHash, randomBytes } from "node:crypto"
import { Prisma } from "@prisma/client"

import { PrismaTransaction } from "../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../prisma.service"

@Injectable()
export class AcceptFriendInviteTransaction extends PrismaTransaction<{ inviteId: string; userId: string }, any> {
  constructor(prisma: PrismaService) { super(prisma) }

  protected async execute(input: { inviteId: string; userId: string }, transaction: Prisma.TransactionClient) {
    await transaction.$executeRaw`SELECT "id" FROM "MatchmakingInvite" WHERE "id" = ${input.inviteId} FOR UPDATE`
    const invite = await transaction.matchmakingInvite.findUnique({ where: { id: input.inviteId }, include: { inviter: { select: { id: true, status: true } }, invitee: { select: { id: true, status: true } }, gameDefinition: { include: { configs: { where: { active: true }, orderBy: { version: "desc" }, take: 1 } } } } })
    if (!invite) throw new NotFoundException("Friend match invite not found")
    if (invite.inviteeId !== input.userId) throw new ConflictException("Only the invited player can accept this invite")
    if (invite.status !== "PENDING") throw new ConflictException("This friend match invite is no longer pending")
    if (invite.expiresAt <= new Date()) {
      await transaction.matchmakingInvite.update({ where: { id: invite.id }, data: { status: "EXPIRED", respondedAt: new Date() } })
      throw new ConflictException("This friend match invite has expired")
    }
    if (invite.inviter.status !== "ACTIVE" || invite.invitee.status !== "ACTIVE" || !invite.gameDefinition.active || !invite.gameDefinition.configs[0]) throw new ConflictException("The friend match is no longer available")
    const now = new Date()
    const config = invite.gameDefinition.configs[0]
    const match = await transaction.match.create({ data: { gameDefinitionId: invite.gameDefinitionId, gameConfigId: config.id, mode: "CASUAL", status: "CREATED", serverNonce: randomBytes(32).toString("base64url"), createdByUserId: invite.inviterId, metadata: { source: "FRIEND_INVITE", inviteId: invite.id } as Prisma.InputJsonValue } })
    await transaction.matchRound.create({ data: { matchId: match.id, roundIndex: 1, gameDefinitionId: invite.gameDefinitionId, status: "CREATED", challengeSeedHash: createHash("sha256").update(`${match.serverNonce}:1`).digest("hex") } })
    await transaction.matchParticipant.createMany({ data: [{ matchId: match.id, userId: invite.inviterId, participantType: "PLAYER" }, { matchId: match.id, userId: invite.inviteeId, participantType: "PLAYER" }] })
    await transaction.matchmakingInvite.update({ where: { id: invite.id }, data: { status: "ACCEPTED", acceptedAt: now, respondedAt: now, matchId: match.id } })
    return { inviteId: invite.id, matchId: match.id, status: "ACCEPTED", matchStatus: match.status, gameKey: invite.gameDefinition.key }
  }
}
