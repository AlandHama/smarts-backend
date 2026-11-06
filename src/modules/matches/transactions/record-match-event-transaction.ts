import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common"
import { createHash } from "node:crypto"
import { Prisma, MatchEventType } from "@prisma/client"

import { PrismaTransaction } from "../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../prisma.service"
import { MatchEventDto } from "../dtos"
import { BotGameplayService } from "../bot-gameplay.service"
import { hashMatchEventRequest, jsonByteLength, randomizeAnswerOptions } from "../utilities/server-content"
import { emotePreset } from "../../commerce/emote-presets"

const MAX_EVENT_PAYLOAD_BYTES = 8 * 1024
const MAX_EVENT_SEQUENCE = 1_000_000
const ANSWER_KEYS = new Set(["assignmentId", "assignmentToken", "selectedAnswerIndex", "answerCorrect", "timeTakenMs"])
const LEGACY_LOCAL_GAME_KEYS = new Set(["bird_watching", "similarities", "high_low", "memorize_cards", "flick_master", "follow_the_lead", "stacking"])
const SKIP_KEYS = new Set(["assignmentId", "assignmentToken", "timeTakenMs"])
const EMOTE_KEYS = new Set(["emoteKey"])
const SKIP_GEM_ASSET_KEY = "consumable:skip_gem"
const DOMINO_LIFECYCLE_EVENTS: Set<MatchEventType> = new Set([MatchEventType.READY, MatchEventType.HEARTBEAT])

@Injectable()
export class RecordMatchEventTransaction extends PrismaTransaction<{ matchId: string; userId: string; dto: MatchEventDto }, any> {
  constructor(prisma: PrismaService, private readonly botGameplay: BotGameplayService) { super(prisma) }

  protected async execute(input: { matchId: string; userId: string; dto: MatchEventDto }, transaction: Prisma.TransactionClient) {
    const clientEventId = input.dto.clientEventId.trim()
    if (!clientEventId) throw new BadRequestException("clientEventId is required")
    if (!Number.isSafeInteger(input.dto.sequence) || input.dto.sequence < 1 || input.dto.sequence > MAX_EVENT_SEQUENCE) throw new BadRequestException("Event sequence is invalid")
    if (input.dto.payload !== undefined && jsonByteLength(input.dto.payload) > MAX_EVENT_PAYLOAD_BYTES) throw new BadRequestException("Event payload is too large")

    // Serializing events through the match lock prevents two requests from
    // both observing the same sequence/score projection concurrently.
    await transaction.$executeRaw`SELECT "id" FROM "Match" WHERE "id" = ${input.matchId} FOR UPDATE`
    const match = await transaction.match.findUnique({ where: { id: input.matchId }, include: { gameDefinition: { select: { key: true } }, gameConfig: true, participants: true, rounds: { where: { status: "STARTED" }, orderBy: { roundIndex: "desc" }, take: 1 } } })
    if (!match) throw new NotFoundException("Match not found")
    const participant = match.participants.find((item) => item.userId === input.userId)
    if (!participant) throw new NotFoundException("Player is not a participant in this match")

    const requestHash = hashMatchEventRequest({ eventType: input.dto.eventType, clientEventId, sequence: input.dto.sequence, payload: input.dto.payload, clientOccurredAt: input.dto.clientOccurredAt })
    const existing = await transaction.matchEvent.findUnique({ where: { matchId_participantId_clientEventId: { matchId: match.id, participantId: participant.id, clientEventId } } })
    if (existing) {
      if (existing.requestHash && existing.requestHash !== requestHash) throw new ConflictException("clientEventId was already used for a different event")
      return existing
    }

    if (match.status !== "STARTED") throw new ConflictException("The match is not accepting events")

    // Domino owns its gameplay journal and sequence counter in DominoAction.
    // The shared matchmaking provider still sends READY/HEARTBEAT signals for
    // some app flows, but persisting those signals in MatchEvent would consume
    // the same sequence numbers as tile actions. Keep the lifecycle signal
    // observable to the caller while updating presence only; it must not
    // compete with the authoritative Domino action journal.
    if (match.gameDefinition.key === "domino" && DOMINO_LIFECYCLE_EVENTS.has(input.dto.eventType)) {
      const now = new Date()
      await transaction.matchParticipant.update({ where: { id: participant.id }, data: { lastActivityAt: now, ...(input.dto.eventType === MatchEventType.READY && !participant.readyAt ? { readyAt: now } : {}) } })
      return {
        id: `domino-lifecycle:${match.id}:${participant.id}:${clientEventId}`,
        matchId: match.id,
        participantId: participant.id,
        roundId: null,
        sequence: input.dto.sequence,
        eventType: input.dto.eventType,
        clientEventId,
        payload: { verified: true, lifecycleOnly: true },
        clientOccurredAt: input.dto.clientOccurredAt ? new Date(input.dto.clientOccurredAt) : null,
        serverReceivedAt: now,
        accepted: true,
        rejectionReason: null,
      }
    }

    if (participant.result !== "PENDING") throw new ConflictException("This player has already finished the match")
    const round = match.rounds[0]
    if (!round) throw new ConflictException("The match has no active round")
    const previous = await transaction.matchEvent.findFirst({ where: { matchId: match.id, participantId: participant.id }, orderBy: { sequence: "desc" }, select: { sequence: true } })
    if (previous && input.dto.sequence <= previous.sequence) throw new ConflictException("Event sequence must increase")

    const base = {
      matchId: match.id,
      participantId: participant.id,
      roundId: round.id,
      sequence: input.dto.sequence,
      eventType: input.dto.eventType,
      clientEventId,
      requestHash,
      clientOccurredAt: input.dto.clientOccurredAt ? new Date(input.dto.clientOccurredAt) : undefined,
    }

    if (input.dto.eventType === MatchEventType.SCORE_UPDATE) return this.reject(transaction, base, "Score updates are derived by the server from accepted answers")
    if (input.dto.eventType === MatchEventType.ANSWER) return this.answer(transaction, match, participant, round.id, base, input.dto.payload)
    if (input.dto.eventType === MatchEventType.SKIP) return this.skip(transaction, match, participant, round.id, base, input.dto.payload)
    if (input.dto.eventType === MatchEventType.EMOTE) return this.emote(transaction, participant, base, input.dto.payload)

    if ([MatchEventType.READY, MatchEventType.HEARTBEAT, MatchEventType.FINISH, MatchEventType.LEAVE, MatchEventType.FORFEIT].includes(input.dto.eventType)) {
      if (input.dto.payload && Object.keys(input.dto.payload).length) return this.reject(transaction, base, "This event type does not accept a payload")
    }
    if (input.dto.eventType === MatchEventType.FINISH) {
      const now = new Date()
      const event = await transaction.matchEvent.create({ data: { ...base, accepted: true, payload: { submitted: true, verified: true } } })
      await transaction.matchParticipant.update({ where: { id: participant.id }, data: { result: "COMPLETED", submittedAt: now, lastActivityAt: now, disconnectGraceUntil: null } })
      await this.botGameplay.completeWithinTransaction({ matchId: match.id, userId: input.userId }, transaction)
      await this.closeIfAllHumanParticipantsFinished(transaction, match.id)
      return event
    }
    if (input.dto.eventType === MatchEventType.FORFEIT || input.dto.eventType === MatchEventType.LEAVE) {
      const now = new Date()
      const event = await transaction.matchEvent.create({ data: { ...base, accepted: true, payload: { submitted: true, verified: true } } })
      await transaction.matchParticipant.update({ where: { id: participant.id }, data: { result: "FORFEIT", submittedAt: now, lastActivityAt: now, disconnectGraceUntil: null } })
      await this.botGameplay.completeWithinTransaction({ matchId: match.id, userId: input.userId }, transaction)
      await this.closeIfAllHumanParticipantsFinished(transaction, match.id)
      return event
    }
    const event = await transaction.matchEvent.create({ data: { ...base, accepted: true, payload: { verified: true } } })
    await transaction.matchParticipant.update({ where: { id: participant.id }, data: { lastActivityAt: new Date() } })
    return event
  }

  private async emote(transaction: Prisma.TransactionClient, participant: any, base: any, payload?: Record<string, unknown>) {
    if (!payload || Object.keys(payload).some((key) => !EMOTE_KEYS.has(key))) return this.reject(transaction, base, "Emote payload is invalid")
    const emoteKey = typeof payload.emoteKey === "string" ? payload.emoteKey.trim().toLowerCase() : ""
    const preset = emotePreset(emoteKey)
    if (!preset) return this.reject(transaction, base, "Unknown emote")
    if (!preset.free) {
      const owned = await transaction.inventoryItem.findFirst({ where: { userId: participant.userId, quantity: { gt: 0 }, assetDefinition: { key: `emote:${emoteKey}` } }, select: { id: true } })
      if (!owned) return this.reject(transaction, base, "You do not own this emote")
    }
    return transaction.matchEvent.create({ data: { ...base, accepted: true, payload: { emoteKey, icon: preset.icon, name: preset.name } } })
  }

  private async answer(transaction: Prisma.TransactionClient, match: any, participant: any, roundId: string, base: any, payload?: Record<string, unknown>) {
    if (!payload || Object.keys(payload).some((key) => !ANSWER_KEYS.has(key))) return this.reject(transaction, base, "Answer payload is invalid")
    const assignmentId = typeof payload.assignmentId === "string" ? payload.assignmentId.trim() : ""
    const token = typeof payload.assignmentToken === "string" ? payload.assignmentToken : ""
    const selectedAnswerIndex = typeof payload.selectedAnswerIndex === "number" ? payload.selectedAnswerIndex : -1
    const answerCorrect = payload.answerCorrect
    const timeTakenMs = typeof payload.timeTakenMs === "number" ? payload.timeTakenMs : -1
    const usesLegacyLocalAnswer = LEGACY_LOCAL_GAME_KEYS.has(match.gameDefinition.key)
    // Any legacy answer that carries the client correctness flag stays on the
    // compatibility path, even if an old mobile build also sends its 0/1
    // placeholder index. That index is not evidence of server verification.
    const usesLegacyClientCorrectness = usesLegacyLocalAnswer && typeof answerCorrect === "boolean"
    if (!isUuid(assignmentId) || token.length < 16 || token.length > 256 || (!usesLegacyLocalAnswer && !Number.isSafeInteger(selectedAnswerIndex)) || (usesLegacyLocalAnswer && !usesLegacyClientCorrectness && !Number.isSafeInteger(selectedAnswerIndex)) || !Number.isSafeInteger(timeTakenMs)) return this.reject(transaction, base, "Answer payload is invalid")

    const assignment = await transaction.matchContentAssignment.findFirst({ where: { id: assignmentId, matchId: match.id, roundId, participantId: participant.id }, include: { contentItem: true } })
    if (!assignment || createHash("sha256").update(token).digest("hex") !== assignment.assignmentTokenHash) return this.reject(transaction, base, "Invalid assignment")
    if (assignment.answeredAt) return this.reject(transaction, base, "Assignment was already answered")
    const now = new Date()
    if (assignment.expiresAt && assignment.expiresAt <= now) return this.reject(transaction, base, "Match answer window has expired")
    if (timeTakenMs < 0 || timeTakenMs > (match.gameConfig?.maxAnswerTimeSeconds ?? 0) * 1000) return this.reject(transaction, base, "Answer time is outside the allowed window")

    const options = assignment.contentItem.options as unknown
    if (!Array.isArray(options) || ((!usesLegacyClientCorrectness || !usesLegacyLocalAnswer) && (selectedAnswerIndex < 0 || selectedAnswerIndex >= options.length))) return this.reject(transaction, base, "Selected answer is invalid")
    const answeredCount = await transaction.matchContentAssignment.count({ where: { matchId: match.id, roundId, participantId: participant.id, answeredAt: { not: null } } })
    if (assignment.position !== answeredCount) return this.reject(transaction, base, "Assignments must be answered in order")

    const pointsConfig = (match.gameConfig?.correctAnswerPoints ?? {}) as Record<string, unknown>
    const correctPoints = Number(pointsConfig[String(assignment.contentItem.difficulty)] ?? pointsConfig["1"] ?? 0)
    const penaltyPercent = match.gameConfig?.wrongAnswerPenaltyPercent
    if (!Number.isSafeInteger(correctPoints) || correctPoints <= 0 || !Number.isInteger(penaltyPercent) || penaltyPercent < 0 || penaltyPercent > 100) return this.reject(transaction, base, "Game scoring is not configured")
    const randomized = randomizeAnswerOptions(
      options,
      assignment.contentItem.answerIndex,
      `${match.serverNonce}:options:${assignment.contentItem.id}`,
    )
    // These games generate their challenge and answer locally from the
    // server-issued seed, so their UI does not use the generic content-item
    // option index. Keep the server score authoritative while accepting the
    // local correctness signal only for this explicit legacy allow-list.
    const correct = usesLegacyClientCorrectness
      ? answerCorrect === true
      : selectedAnswerIndex === randomized.answerIndex
    const penalty = BigInt(Math.floor(correctPoints * (penaltyPercent / 100)))
    const points = correct ? BigInt(correctPoints) : -penalty
    const locked = await transaction.matchParticipant.findUniqueOrThrow({ where: { id: participant.id } })
    const before = BigInt(locked.finalScore ?? 0)
    const after = before + points < 0n ? 0n : before + points
    if (after > 2147483647n) return this.reject(transaction, base, "Score exceeds the game limit")

    const event = await transaction.matchEvent.create({ data: { ...base, accepted: true, payload: { assignmentId, selectedAnswerIndex: selectedAnswerIndex >= 0 ? selectedAnswerIndex : null, correct, clientCorrectness: typeof answerCorrect === "boolean" ? answerCorrect : undefined, verified: !usesLegacyClientCorrectness, verificationMode: usesLegacyClientCorrectness ? "LEGACY_CLIENT_CORRECTNESS" : "SERVER_ASSIGNMENT" as const, pointsEarned: points.toString(), timeTakenMs } } })
    await transaction.matchParticipant.update({ where: { id: participant.id }, data: { finalScore: Number(after), answeredCount: { increment: 1 }, lastActivityAt: now } })
    await transaction.matchContentAssignment.update({ where: { id: assignment.id }, data: { answeredAt: now } })
    await this.updateCooperativeScore(transaction, participant.id, correct)
    return event
  }

  private async skip(transaction: Prisma.TransactionClient, match: any, participant: any, roundId: string, base: any, payload?: Record<string, unknown>) {
    if (!payload || Object.keys(payload).some((key) => !SKIP_KEYS.has(key))) return this.reject(transaction, base, "Skip payload is invalid")
    const assignmentId = typeof payload.assignmentId === "string" ? payload.assignmentId.trim() : ""
    const token = typeof payload.assignmentToken === "string" ? payload.assignmentToken : ""
    const timeTakenMs = typeof payload.timeTakenMs === "number" ? payload.timeTakenMs : -1
    if (!isUuid(assignmentId) || token.length < 16 || token.length > 256 || !Number.isSafeInteger(timeTakenMs)) return this.reject(transaction, base, "Skip payload is invalid")

    const assignment = await transaction.matchContentAssignment.findFirst({ where: { id: assignmentId, matchId: match.id, roundId, participantId: participant.id }, include: { contentItem: true } })
    if (!assignment || createHash("sha256").update(token).digest("hex") !== assignment.assignmentTokenHash) return this.reject(transaction, base, "Invalid assignment")
    if (assignment.answeredAt) return this.reject(transaction, base, "Assignment was already answered")
    const now = new Date()
    if (assignment.expiresAt && assignment.expiresAt <= now) return this.reject(transaction, base, "Match answer window has expired")
    if (timeTakenMs < 0 || timeTakenMs > (match.gameConfig?.maxAnswerTimeSeconds ?? 0) * 1000) return this.reject(transaction, base, "Answer time is outside the allowed window")

    const answeredCount = await transaction.matchContentAssignment.count({ where: { matchId: match.id, roundId, participantId: participant.id, answeredAt: { not: null } } })
    if (assignment.position !== answeredCount) return this.reject(transaction, base, "Assignments must be answered in order")
    const pointsConfig = (match.gameConfig?.correctAnswerPoints ?? {}) as Record<string, unknown>
    const correctPoints = Number(pointsConfig[String(assignment.contentItem.difficulty)] ?? pointsConfig["1"] ?? 0)
    if (!Number.isSafeInteger(correctPoints) || correctPoints <= 0) return this.reject(transaction, base, "Game scoring is not configured")
    // instantSkipPriceGld remains the server-side feature flag for older game
    // configs, but the player now pays with one owned Skip Gem rather than a
    // direct GLD debit. This keeps the consumable auditable and prevents the
    // client from ever choosing the price.
    if (Number(match.gameConfig?.instantSkipPriceGld ?? 0) <= 0) return this.reject(transaction, base, "Instant skip is not enabled for this game")
    if (!Number.isInteger(match.gameConfig?.wrongAnswerPenaltyPercent) || match.gameConfig.wrongAnswerPenaltyPercent < 0 || match.gameConfig.wrongAnswerPenaltyPercent > 100) return this.reject(transaction, base, "Game scoring is not configured")

    const locked = await transaction.matchParticipant.findUniqueOrThrow({ where: { id: participant.id } })
    const before = BigInt(locked.finalScore ?? 0)
    const after = before + BigInt(correctPoints)
    if (after > 2147483647n) return this.reject(transaction, base, "Score exceeds the game limit")
    const skipGem = await transaction.assetDefinition.findUnique({ where: { key: SKIP_GEM_ASSET_KEY }, select: { id: true, active: true } })
    if (!skipGem?.active) return this.reject(transaction, base, "Skip Gems are not configured")
    const stackKey = `${participant.userId}:${skipGem.id}:base`
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${stackKey}))`
    const inventoryItem = await transaction.inventoryItem.findFirst({
      where: { userId: participant.userId, assetDefinitionId: skipGem.id, assetVariationId: null, quantity: { gt: 0 } },
      orderBy: { createdAt: "asc" },
      select: { id: true, quantity: true },
    })
    if (!inventoryItem) return this.reject(transaction, base, "You do not have a Skip Gem")
    const remainingSkipGems = inventoryItem.quantity - 1
    await transaction.inventoryItem.update({ where: { id: inventoryItem.id }, data: { quantity: { decrement: 1 } } })
    const event = await transaction.matchEvent.create({ data: { ...base, accepted: true, payload: { assignmentId, correct: true, skipped: true, verified: true, pointsEarned: correctPoints.toString(), timeTakenMs, consumableKey: SKIP_GEM_ASSET_KEY, skipGemSpent: 1, remainingSkipGems } } })
    await transaction.matchParticipant.update({ where: { id: participant.id }, data: { finalScore: Number(after), answeredCount: { increment: 1 }, lastActivityAt: now } })
    await transaction.matchContentAssignment.update({ where: { id: assignment.id }, data: { answeredAt: now } })
    await this.updateCooperativeScore(transaction, participant.id, true)
    return event
  }

  private async updateCooperativeScore(transaction: Prisma.TransactionClient, matchParticipantId: string, correct: boolean) {
    const cooperative = await transaction.cooperativeParticipant.findUnique({ where: { matchParticipantId }, select: { id: true, teamId: true } })
    if (!cooperative) return
    const authoritative = await transaction.matchParticipant.findUniqueOrThrow({ where: { id: matchParticipantId }, select: { finalScore: true } })
    await transaction.cooperativeParticipant.update({ where: { id: cooperative.id }, data: { finalScore: authoritative.finalScore ?? 0, answeredQuestions: { increment: 1 }, correctAnswers: correct ? { increment: 1 } : undefined } })
    const teamParticipants = await transaction.cooperativeParticipant.findMany({ where: { teamId: cooperative.teamId }, select: { finalScore: true } })
    const teamScore = teamParticipants.reduce((total, row) => total + (row.finalScore ?? 0), 0)
    await transaction.cooperativeTeam.update({ where: { id: cooperative.teamId }, data: { score: teamScore, answeredQuestions: { increment: 1 }, correctAnswers: correct ? { increment: 1 } : undefined } })
  }

  private reject(transaction: Prisma.TransactionClient, base: any, reason: string) {
    return transaction.matchEvent.create({ data: { ...base, accepted: false, payload: {}, rejectionReason: reason } })
  }

  private async closeIfAllHumanParticipantsFinished(transaction: Prisma.TransactionClient, matchId: string) {
    const pending = await transaction.matchParticipant.count({ where: { matchId, participantType: "PLAYER", result: "PENDING" } })
    if (pending) return
    const endedAt = new Date()
    await transaction.matchRound.updateMany({ where: { matchId, status: { in: ["CREATED", "STARTED"] } }, data: { status: "FINISHED", endedAt } })
    await transaction.match.update({ where: { id: matchId }, data: { status: "FINISHED", endedAt } })
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}
