import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common"
import { createHash, randomBytes } from "node:crypto"
import { Prisma, GameMode, MatchParticipantType } from "@prisma/client"

import { PrismaTransaction } from "../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../prisma.service"
import { CreateMatchDto } from "../dtos"

@Injectable()
export class CreateMatchTransaction extends PrismaTransaction<{ userId: string; dto: CreateMatchDto }, any> {
  constructor(prisma: PrismaService) { super(prisma) }

  protected async execute(input: { userId: string; dto: CreateMatchDto }, transaction: Prisma.TransactionClient) {
    const game = await transaction.gameDefinition.findUnique({ where: { key: input.dto.gameKey.trim().toLowerCase() }, include: { configs: { where: { active: true }, orderBy: { version: "desc" }, take: 1 } } })
    const config = game?.configs[0]
    if (!game || !game.active || !config) throw new NotFoundException("Game definition or configuration is inactive")
    const user = await transaction.user.findUnique({ where: { id: input.userId }, select: { id: true, status: true } })
    if (!user || user.status !== "ACTIVE") throw new BadRequestException("Player is not active")
    if (input.dto.mode === GameMode.SINGLE_PLAYER && input.dto.opponentUserId) throw new BadRequestException("Single-player matches cannot have an opponent")
    if (input.dto.mode !== GameMode.SINGLE_PLAYER && !input.dto.opponentUserId) throw new BadRequestException("An opponent is required for this match mode")
    if (input.dto.opponentUserId === input.userId) throw new BadRequestException("A player cannot challenge itself")
    if (input.dto.opponentUserId) {
      const opponent = await transaction.user.findUnique({ where: { id: input.dto.opponentUserId }, select: { id: true, status: true } })
      if (!opponent || opponent.status !== "ACTIVE") throw new NotFoundException("Opponent not found or inactive")
    }

    const now = new Date()
    const match = await transaction.match.create({ data: { gameDefinitionId: game.id, gameConfigId: config.id, mode: input.dto.mode, status: "STARTED", serverNonce: randomBytes(32).toString("base64url"), startedAt: now, createdByUserId: input.userId, metadata: input.dto.metadata as Prisma.InputJsonValue | undefined } })
    await transaction.matchRound.create({ data: { matchId: match.id, roundIndex: 1, gameDefinitionId: game.id, status: "STARTED", challengeSeedHash: createHash("sha256").update(`${match.serverNonce}:1`).digest("hex"), startedAt: now } })
    const participants = [
      await transaction.matchParticipant.create({ data: { matchId: match.id, userId: input.userId, participantType: MatchParticipantType.PLAYER } }),
    ]
    if (input.dto.mode === GameMode.BOT) participants.push(await transaction.matchParticipant.create({ data: { matchId: match.id, participantType: MatchParticipantType.BOT, result: "COMPLETED", finalScore: 0, submittedAt: now } }))
    else if (input.dto.opponentUserId) participants.push(await transaction.matchParticipant.create({ data: { matchId: match.id, userId: input.dto.opponentUserId, participantType: MatchParticipantType.PLAYER } }))

    const items = await transaction.gameContentItem.findMany({ where: { gameDefinitionId: game.id, active: true }, orderBy: [{ version: "desc" }, { createdAt: "asc" }], take: config.maxQuestions })
    const assignments: Array<Record<string, unknown>> = []
    for (const participant of participants) {
      if (participant.participantType === MatchParticipantType.BOT) continue
      for (let position = 0; position < items.length; position += 1) {
        const token = randomBytes(32).toString("base64url")
        const expiresAt = new Date(now.getTime() + config.maxMatchDurationSeconds * 1000)
        const assignment = await transaction.matchContentAssignment.create({ data: { matchId: match.id, participantId: participant.id, contentItemId: items[position].id, position, assignmentTokenHash: createHash("sha256").update(token).digest("hex"), expiresAt }, include: { contentItem: { select: { id: true, contentType: true, prompt: true, options: true, difficulty: true, category: true } } } })
        assignments.push({ participantId: participant.id, id: assignment.id, position, token, contentItem: assignment.contentItem, expiresAt })
      }
    }
    if (!items.length) assignments.push({ warning: "No server content is configured; score-reward settlement will be held for review." })
    return { match: { ...match, participants }, currentParticipantId: participants[0].id, assignments: assignments.filter((assignment) => assignment.participantId === participants[0].id) }
  }
}
