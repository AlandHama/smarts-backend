import { ConflictException, Injectable, NotFoundException } from "@nestjs/common"
import { createHash } from "node:crypto"
import { Prisma } from "@prisma/client"

import { PrismaTransaction } from "../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../prisma.service"
import { createAssignmentToken, MAX_SERVER_CONTENT_PER_MATCH, selectServerContent } from "../utilities/server-content"

@Injectable()
export class StartMatchTransaction extends PrismaTransaction<{ matchId: string; userId: string }, any> {
  constructor(prisma: PrismaService) { super(prisma) }

  protected async execute(input: { matchId: string; userId: string }, transaction: Prisma.TransactionClient) {
    await transaction.$executeRaw`SELECT "id" FROM "Match" WHERE "id" = ${input.matchId} FOR UPDATE`
    const match = await transaction.match.findUnique({ where: { id: input.matchId }, include: { gameConfig: true, participants: true, rounds: { where: { status: { in: ["CREATED", "STARTED"] } }, orderBy: { roundIndex: "desc" }, take: 1 } } })
    if (!match) throw new NotFoundException("Match not found")
    const currentParticipant = match.participants.find((participant) => participant.userId === input.userId)
    if (!currentParticipant) throw new NotFoundException("Player is not a participant in this match")
    if (match.status !== "CREATED" && match.status !== "STARTED") throw new ConflictException("The match cannot be started")
    const round = match.rounds[0]
    if (!round) throw new ConflictException("The match has no active round")
    const now = new Date()
    if (match.status === "CREATED") {
      await transaction.match.update({ where: { id: match.id }, data: { status: "STARTED", startedAt: now } })
      await transaction.matchRound.update({ where: { id: round.id }, data: { status: "STARTED", startedAt: now } })
    }
    const assignments: Array<Record<string, unknown>> = []
    const existingAssignments = await transaction.matchContentAssignment.findMany({ where: { matchId: match.id, roundId: round.id, participantId: currentParticipant.id }, orderBy: { position: "asc" }, include: { contentItem: { select: { id: true, contentType: true, prompt: true, options: true, difficulty: true, category: true } } } })
    if (existingAssignments.length) for (const assignment of existingAssignments) assignments.push({ id: assignment.id, participantId: currentParticipant.id, position: assignment.position, token: createAssignmentToken(match.serverNonce, currentParticipant.id, round.id, assignment.position), contentItem: assignment.contentItem, expiresAt: assignment.expiresAt })
    if (!existingAssignments.length) {
      const items = await transaction.gameContentItem.findMany({ where: { gameDefinitionId: match.gameDefinitionId, active: true }, orderBy: { id: "asc" }, take: MAX_SERVER_CONTENT_PER_MATCH, select: { id: true, contentType: true, prompt: true, options: true, difficulty: true, category: true } })
      const selectedItems = selectServerContent(items, match.gameConfig.maxQuestions, match.serverNonce)
      if (currentParticipant.participantType !== "BOT") for (let position = 0; position < selectedItems.length; position += 1) {
        const token = createAssignmentToken(match.serverNonce, currentParticipant.id, round.id, position)
        const assignment = await transaction.matchContentAssignment.create({ data: { matchId: match.id, roundId: round.id, participantId: currentParticipant.id, contentItemId: selectedItems[position].id, position, assignmentTokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(now.getTime() + match.gameConfig.maxMatchDurationSeconds * 1000) }, include: { contentItem: { select: { id: true, contentType: true, prompt: true, options: true, difficulty: true, category: true } } } })
        assignments.push({ id: assignment.id, participantId: currentParticipant.id, position, token, contentItem: assignment.contentItem, expiresAt: assignment.expiresAt })
      }
    }
    return { matchId: match.id, status: "STARTED", startedAt: match.startedAt ?? now, assignments }
  }
}
