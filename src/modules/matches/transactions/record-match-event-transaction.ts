import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common"
import { createHash } from "node:crypto"
import { Prisma, MatchEventType } from "@prisma/client"

import { PrismaTransaction } from "../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../prisma.service"
import { MatchEventDto } from "../dtos"
import { hashMatchEventRequest, jsonByteLength } from "../utilities/server-content"

const MAX_EVENT_PAYLOAD_BYTES = 8 * 1024
const MAX_EVENT_SEQUENCE = 1_000_000
const ANSWER_KEYS = new Set(["assignmentId", "assignmentToken", "selectedAnswerIndex", "timeTakenMs"])

@Injectable()
export class RecordMatchEventTransaction extends PrismaTransaction<{ matchId: string; userId: string; dto: MatchEventDto }, any> {
  constructor(prisma: PrismaService) { super(prisma) }

  protected async execute(input: { matchId: string; userId: string; dto: MatchEventDto }, transaction: Prisma.TransactionClient) {
    const clientEventId = input.dto.clientEventId.trim()
    if (!clientEventId) throw new BadRequestException("clientEventId is required")
    if (!Number.isSafeInteger(input.dto.sequence) || input.dto.sequence < 1 || input.dto.sequence > MAX_EVENT_SEQUENCE) throw new BadRequestException("Event sequence is invalid")
    if (input.dto.payload !== undefined && jsonByteLength(input.dto.payload) > MAX_EVENT_PAYLOAD_BYTES) throw new BadRequestException("Event payload is too large")

    // Serializing events through the match lock prevents two requests from
    // both observing the same sequence/score projection concurrently.
    await transaction.$executeRaw`SELECT "id" FROM "Match" WHERE "id" = ${input.matchId} FOR UPDATE`
    const match = await transaction.match.findUnique({ where: { id: input.matchId }, include: { gameConfig: true, participants: true, rounds: { where: { status: "STARTED" }, orderBy: { roundIndex: "desc" }, take: 1 } } })
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

    if ([MatchEventType.READY, MatchEventType.HEARTBEAT, MatchEventType.FINISH, MatchEventType.LEAVE, MatchEventType.FORFEIT].includes(input.dto.eventType)) {
      if (input.dto.payload && Object.keys(input.dto.payload).length) return this.reject(transaction, base, "This event type does not accept a payload")
    }
    if (input.dto.eventType === MatchEventType.FINISH) {
      const event = await transaction.matchEvent.create({ data: { ...base, accepted: true, payload: { submitted: true } } })
      await transaction.matchParticipant.update({ where: { id: participant.id }, data: { result: "COMPLETED", submittedAt: new Date() } })
      return event
    }
    if (input.dto.eventType === MatchEventType.FORFEIT || input.dto.eventType === MatchEventType.LEAVE) {
      const event = await transaction.matchEvent.create({ data: { ...base, accepted: true, payload: { submitted: true } } })
      await transaction.matchParticipant.update({ where: { id: participant.id }, data: { result: "FORFEIT", submittedAt: new Date() } })
      return event
    }
    return transaction.matchEvent.create({ data: { ...base, accepted: true, payload: {} } })
  }

  private async answer(transaction: Prisma.TransactionClient, match: any, participant: any, roundId: string, base: any, payload?: Record<string, unknown>) {
    if (!payload || Object.keys(payload).some((key) => !ANSWER_KEYS.has(key))) return this.reject(transaction, base, "Answer payload is invalid")
    const assignmentId = typeof payload.assignmentId === "string" ? payload.assignmentId.trim() : ""
    const token = typeof payload.assignmentToken === "string" ? payload.assignmentToken : ""
    const selectedAnswerIndex = typeof payload.selectedAnswerIndex === "number" ? payload.selectedAnswerIndex : -1
    const timeTakenMs = typeof payload.timeTakenMs === "number" ? payload.timeTakenMs : -1
    if (!isUuid(assignmentId) || token.length < 16 || token.length > 256 || !Number.isSafeInteger(selectedAnswerIndex) || !Number.isSafeInteger(timeTakenMs)) return this.reject(transaction, base, "Answer payload is invalid")

    const assignment = await transaction.matchContentAssignment.findFirst({ where: { id: assignmentId, matchId: match.id, roundId, participantId: participant.id }, include: { contentItem: true } })
    if (!assignment || createHash("sha256").update(token).digest("hex") !== assignment.assignmentTokenHash) return this.reject(transaction, base, "Invalid assignment")
    if (assignment.answeredAt) return this.reject(transaction, base, "Assignment was already answered")
    const now = new Date()
    if (assignment.expiresAt && assignment.expiresAt <= now) return this.reject(transaction, base, "Match answer window has expired")
    if (timeTakenMs < 0 || timeTakenMs > (match.gameConfig?.maxAnswerTimeSeconds ?? 0) * 1000) return this.reject(transaction, base, "Answer time is outside the allowed window")

    const options = assignment.contentItem.options as unknown
    if (!Array.isArray(options) || selectedAnswerIndex < 0 || selectedAnswerIndex >= options.length) return this.reject(transaction, base, "Selected answer is invalid")
    const answeredCount = await transaction.matchContentAssignment.count({ where: { matchId: match.id, roundId, participantId: participant.id, answeredAt: { not: null } } })
    if (assignment.position !== answeredCount) return this.reject(transaction, base, "Assignments must be answered in order")

    const pointsConfig = (match.gameConfig?.correctAnswerPoints ?? {}) as Record<string, unknown>
    const correctPoints = Number(pointsConfig[String(assignment.contentItem.difficulty)] ?? pointsConfig["1"] ?? 0)
    const penaltyPercent = match.gameConfig?.wrongAnswerPenaltyPercent
    if (!Number.isSafeInteger(correctPoints) || correctPoints <= 0 || !Number.isInteger(penaltyPercent) || penaltyPercent < 0 || penaltyPercent > 100) return this.reject(transaction, base, "Game scoring is not configured")
    const correct = selectedAnswerIndex === assignment.contentItem.answerIndex
    const penalty = BigInt(Math.floor(correctPoints * (penaltyPercent / 100)))
    const points = correct ? BigInt(correctPoints) : -penalty
    const locked = await transaction.matchParticipant.findUniqueOrThrow({ where: { id: participant.id } })
    const before = BigInt(locked.finalScore ?? 0)
    const after = before + points < 0n ? 0n : before + points
    if (after > 2147483647n) return this.reject(transaction, base, "Score exceeds the game limit")

    const event = await transaction.matchEvent.create({ data: { ...base, accepted: true, payload: { assignmentId, selectedAnswerIndex, correct, pointsEarned: points.toString(), timeTakenMs } } })
    await transaction.matchParticipant.update({ where: { id: participant.id }, data: { finalScore: Number(after), answeredCount: { increment: 1 } } })
    await transaction.matchContentAssignment.update({ where: { id: assignment.id }, data: { answeredAt: now } })
    return event
  }

  private reject(transaction: Prisma.TransactionClient, base: any, reason: string) {
    return transaction.matchEvent.create({ data: { ...base, accepted: false, payload: {}, rejectionReason: reason } })
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}
