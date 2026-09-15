import { ConflictException, Injectable, NotFoundException } from "@nestjs/common"
import { createHash, randomBytes } from "node:crypto"
import { Prisma } from "@prisma/client"

import { PrismaTransaction } from "../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../prisma.service"
import { createAssignmentToken, MAX_SERVER_CONTENT_PER_MATCH, selectServerContent } from "../../matches/utilities/server-content"

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
    const activeContentCount = await transaction.gameContentItem.count({ where: { gameDefinitionId: invite.gameDefinitionId, active: true } })
    if (!activeContentCount) throw new ConflictException("No active server content is configured for this game")
    const now = new Date()
    const config = invite.gameDefinition.configs[0]
    const serverNonce = randomBytes(32).toString("base64url")
    const contentItems = await transaction.gameContentItem.findMany({
      where: { gameDefinitionId: invite.gameDefinitionId, active: true },
      orderBy: { id: "asc" },
      take: MAX_SERVER_CONTENT_PER_MATCH,
      select: { id: true },
    })
    const selectedItems = selectServerContent(contentItems, config.maxQuestions, serverNonce)
    if (!selectedItems.length) throw new ConflictException("No active server content is configured for this game")
    const match = await transaction.match.create({ data: { gameDefinitionId: invite.gameDefinitionId, gameConfigId: config.id, mode: "CASUAL", status: "CREATED", serverNonce, createdByUserId: invite.inviterId, metadata: { source: "FRIEND_INVITE", inviteId: invite.id } as Prisma.InputJsonValue } })
    const round = await transaction.matchRound.create({ data: { matchId: match.id, roundIndex: 1, gameDefinitionId: invite.gameDefinitionId, status: "CREATED", challengeSeedHash: createHash("sha256").update(`${match.serverNonce}:1`).digest("hex") } })
    const participants = await Promise.all([
      transaction.matchParticipant.create({ data: { matchId: match.id, userId: invite.inviterId, participantType: "PLAYER" } }),
      transaction.matchParticipant.create({ data: { matchId: match.id, userId: invite.inviteeId, participantType: "PLAYER" } }),
    ])
    const expiresAt = new Date(now.getTime() + config.maxMatchDurationSeconds * 1000)
    for (const participant of participants) {
      for (let position = 0; position < selectedItems.length; position += 1) {
        const token = createAssignmentToken(serverNonce, participant.id, round.id, position)
        await transaction.matchContentAssignment.create({
          data: {
            matchId: match.id,
            roundId: round.id,
            participantId: participant.id,
            contentItemId: selectedItems[position].id,
            position,
            assignmentTokenHash: createHash("sha256").update(token).digest("hex"),
            expiresAt,
          },
        })
      }
    }
    await transaction.matchmakingInvite.update({ where: { id: invite.id }, data: { status: "ACCEPTED", acceptedAt: now, respondedAt: now, matchId: match.id } })
    return { inviteId: invite.id, matchId: match.id, status: "ACCEPTED", matchStatus: match.status, gameKey: invite.gameDefinition.key }
  }
}
