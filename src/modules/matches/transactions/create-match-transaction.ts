import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common"
import { createHash, randomBytes } from "node:crypto"
import { Prisma, GameMode, MatchParticipantType } from "@prisma/client"

import { PrismaTransaction } from "../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../prisma.service"
import { CreateMatchDto } from "../dtos"
import { createAssignmentToken, isAuthoritativeBoardGame, MAX_SERVER_CONTENT_PER_MATCH, randomizeAnswerOptions, selectServerContent } from "../utilities/server-content"
import { MatchIntegrityPolicyService } from "../match-integrity-policy.service"

@Injectable()
export class CreateMatchTransaction extends PrismaTransaction<{ userId: string; dto: CreateMatchDto }, any> {
  constructor(prisma: PrismaService, private readonly integrityPolicy: MatchIntegrityPolicyService) { super(prisma) }

  protected async execute(input: { userId: string; dto: CreateMatchDto }, transaction: Prisma.TransactionClient) {
    const game = await transaction.gameDefinition.findUnique({ where: { key: input.dto.gameKey.trim().toLowerCase() }, include: { configs: { where: { active: true }, orderBy: { version: "desc" }, take: 1 } } })
    const config = game?.configs[0]
    if (!game || !game.active || !config) throw new NotFoundException("Game definition or configuration is inactive")
    const progressionKeys = [...new Set([config.mainProgressionKey, config.eloProgressionKey])]
    const validProgressions = await transaction.progressionDefinition.findMany({ where: { key: { in: progressionKeys }, active: true, tiers: { some: { step: 1, pointsThreshold: 0n } } }, select: { key: true } })
    if (validProgressions.length !== progressionKeys.length) throw new ConflictException("This game reward configuration is incomplete")
    const user = await transaction.user.findUnique({ where: { id: input.userId }, select: { id: true, status: true, profile: { select: { level: true } } } })
    if (!user || user.status !== "ACTIVE") throw new BadRequestException("Player is not active")
    if ((user.profile?.level ?? 1) < config.minimumPlayerLevel) throw new ConflictException(`Reach level ${config.minimumPlayerLevel} to unlock ${game.name}`)
    const isSoloMode = input.dto.mode === GameMode.SINGLE_PLAYER || input.dto.mode === GameMode.PRACTICE
    if (input.dto.mode === GameMode.RANKED) throw new ConflictException("Ranked matches must be started through matchmaking")
    if (isSoloMode && input.dto.opponentUserId) throw new BadRequestException("This match mode cannot have an opponent")
    if (!isSoloMode && !input.dto.opponentUserId) throw new BadRequestException("An opponent is required for this match mode")
    if (input.dto.opponentUserId === input.userId) throw new BadRequestException("A player cannot challenge itself")
    const capturedIntegrityPolicy = await this.integrityPolicy.assertAvailable(game.key, input.dto.mode, [input.userId, ...(input.dto.opponentUserId ? [input.dto.opponentUserId] : [])], transaction)
    if (input.dto.opponentUserId) {
      const opponent = await transaction.user.findUnique({ where: { id: input.dto.opponentUserId }, select: { id: true, status: true, profile: { select: { level: true } } } })
      if (!opponent || opponent.status !== "ACTIVE") throw new NotFoundException("Opponent not found or inactive")
      if ((opponent.profile?.level ?? 1) < config.minimumPlayerLevel) throw new ConflictException(`Opponent must reach level ${config.minimumPlayerLevel} to play ${game.name}`)
    }
    if (input.dto.mode === GameMode.CASUAL && input.dto.opponentUserId) {
      const recentPairMatches = await transaction.matchParticipant.findMany({
        where: {
          userId: input.userId,
          match: { mode: GameMode.CASUAL, createdAt: { gte: new Date(Date.now() - 86400000) }, participants: { some: { userId: input.dto.opponentUserId } } },
        },
        distinct: ["matchId"],
        select: { matchId: true },
        take: 3,
      })
      if (recentPairMatches.length >= 3) throw new ConflictException("This opponent pair has reached the daily casual match limit")
    }
    const isBoardAuthoritative = isAuthoritativeBoardGame(game.key)
    const activeContentCount = isBoardAuthoritative ? 1 : await transaction.gameContentItem.count({ where: { gameDefinitionId: game.id, active: true } })
    if (!activeContentCount) throw new ConflictException("No active server content is configured for this game")

    const now = new Date()
    const match = await transaction.match.create({ data: { gameDefinitionId: game.id, gameConfigId: config.id, mode: input.dto.mode, integrityPolicyVersion: `${game.key}:v${capturedIntegrityPolicy.version}`, status: isBoardAuthoritative ? "CREATED" : "STARTED", serverNonce: randomBytes(32).toString("base64url"), startedAt: isBoardAuthoritative ? undefined : now, createdByUserId: input.userId, metadata: input.dto.metadata as Prisma.InputJsonValue | undefined } })
    const round = await transaction.matchRound.create({ data: { matchId: match.id, roundIndex: 1, gameDefinitionId: game.id, status: isBoardAuthoritative ? "CREATED" : "STARTED", challengeSeedHash: createHash("sha256").update(match.serverNonce + ":1").digest("hex"), startedAt: isBoardAuthoritative ? undefined : now } })
    const participants = [
      await transaction.matchParticipant.create({ data: { matchId: match.id, userId: input.userId, participantType: MatchParticipantType.PLAYER } }),
    ]
    if (input.dto.mode === GameMode.BOT || (input.dto.mode === GameMode.PRACTICE && (game.key === "perfect_timing" || game.key === "bomb_path"))) participants.push(await transaction.matchParticipant.create({ data: { matchId: match.id, participantType: MatchParticipantType.BOT, result: "PENDING" } }))
    else if (input.dto.opponentUserId) participants.push(await transaction.matchParticipant.create({ data: { matchId: match.id, userId: input.dto.opponentUserId, participantType: MatchParticipantType.PLAYER } }))

    if (isBoardAuthoritative) return { match: { ...match, participants }, currentParticipantId: participants[0].id, assignments: [] }
    const items = await transaction.gameContentItem.findMany({ where: { gameDefinitionId: game.id, active: true }, orderBy: { id: "asc" }, take: MAX_SERVER_CONTENT_PER_MATCH, select: { id: true, contentType: true, prompt: true, options: true, answerIndex: true, difficulty: true, category: true } })
    const selectedItems = selectServerContent(items, config.maxQuestions, match.serverNonce, input.dto.gameKey.trim().toLowerCase())
    if (!selectedItems.length) throw new ConflictException("No active server content is configured for this game")
    const assignments: Array<Record<string, unknown>> = []
    for (const participant of participants) {
      if (participant.participantType === MatchParticipantType.BOT) continue
      for (let position = 0; position < selectedItems.length; position += 1) {
        const token = createAssignmentToken(match.serverNonce, participant.id, round.id, position)
        const expiresAt = new Date(now.getTime() + config.maxMatchDurationSeconds * 1000)
        const assignment = await transaction.matchContentAssignment.create({ data: { matchId: match.id, roundId: round.id, participantId: participant.id, contentItemId: selectedItems[position].id, position, assignmentTokenHash: createHash("sha256").update(token).digest("hex"), expiresAt }, include: { contentItem: { select: { id: true, contentType: true, prompt: true, options: true, answerIndex: true, difficulty: true, category: true } } } })
        const randomized = randomizeAnswerOptions(
          assignment.contentItem.options as unknown[],
          assignment.contentItem.answerIndex,
          `${match.serverNonce}:options:${assignment.contentItem.id}`,
        )
        const { answerIndex: _answerIndex, ...publicContentItem } = assignment.contentItem
        assignments.push({ participantId: participant.id, id: assignment.id, position, token, contentItem: { ...publicContentItem, options: randomized.options }, expiresAt })
      }
    }
    return { match: { ...match, participants }, currentParticipantId: participants[0].id, assignments: assignments.filter((assignment) => assignment.participantId === participants[0].id) }
  }
}
