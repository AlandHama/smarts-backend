import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common"
import { createHash } from "node:crypto"
import { Prisma, MatchEventType } from "@prisma/client"

import { PrismaTransaction } from "../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../prisma.service"
import { MatchEventDto } from "../dtos"

@Injectable()
export class RecordMatchEventTransaction extends PrismaTransaction<{ matchId: string; userId: string; dto: MatchEventDto }, any> {
  constructor(prisma: PrismaService) { super(prisma) }

  protected async execute(input: { matchId: string; userId: string; dto: MatchEventDto }, transaction: Prisma.TransactionClient) {
    const match = await transaction.match.findUnique({ where: { id: input.matchId }, include: { gameConfig: true, participants: true } })
    if (!match) throw new NotFoundException("Match not found")
    const participant = match.participants.find((item) => item.userId === input.userId)
    if (!participant) throw new NotFoundException("Player is not a participant in this match")
    const existing = await transaction.matchEvent.findUnique({ where: { matchId_participantId_clientEventId: { matchId: match.id, participantId: participant.id, clientEventId: input.dto.clientEventId.trim() } } })
    if (existing) return existing
    if (match.status !== "STARTED") throw new ConflictException("The match is not accepting events")
    if (participant.result !== "PENDING") throw new ConflictException("This player has already finished the match")
    const previous = await transaction.matchEvent.findFirst({ where: { matchId: match.id, participantId: participant.id }, orderBy: { sequence: "desc" }, select: { sequence: true } })
    if (previous && input.dto.sequence <= previous.sequence) throw new ConflictException("Event sequence must increase")

    const base = { matchId: match.id, participantId: participant.id, sequence: input.dto.sequence, eventType: input.dto.eventType, clientEventId: input.dto.clientEventId.trim(), clientOccurredAt: input.dto.clientOccurredAt ? new Date(input.dto.clientOccurredAt) : undefined }
    if (input.dto.eventType === MatchEventType.ANSWER) return this.answer(transaction, match, participant, base, input.dto.payload)
    if (input.dto.eventType === MatchEventType.SCORE_UPDATE) return this.reject(transaction, base, "Score updates are derived by the server from accepted answers")
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
    return transaction.matchEvent.create({ data: { ...base, accepted: true, payload: input.dto.payload as Prisma.InputJsonValue | undefined } })
  }

  private async answer(transaction: Prisma.TransactionClient, match: any, participant: any, base: any, payload?: Record<string, unknown>) {
    const assignmentId = typeof payload?.assignmentId === "string" ? payload.assignmentId : ""
    const token = typeof payload?.assignmentToken === "string" ? payload.assignmentToken : ""
    const selectedAnswerIndex = typeof payload?.selectedAnswerIndex === "number" ? payload.selectedAnswerIndex : -1
    const timeTakenMs = typeof payload?.timeTakenMs === "number" ? payload.timeTakenMs : -1
    const assignment = assignmentId ? await transaction.matchContentAssignment.findFirst({ where: { id: assignmentId, matchId: match.id, participantId: participant.id }, include: { contentItem: true } }) : null
    if (!assignment || !token || createHash("sha256").update(token).digest("hex") !== assignment.assignmentTokenHash) return this.reject(transaction, base, "Invalid assignment")
    if (assignment.answeredAt) return this.reject(transaction, base, "Assignment was already answered")
    if (assignment.expiresAt && assignment.expiresAt <= new Date()) return this.reject(transaction, base, "Match answer window has expired")
    if (timeTakenMs < 0 || timeTakenMs > (match.gameConfig?.maxAnswerTimeSeconds ?? 0) * 1000) return this.reject(transaction, base, "Answer time is outside the allowed window")
    if (selectedAnswerIndex < 0 || selectedAnswerIndex >= (assignment.contentItem.options as unknown[]).length) return this.reject(transaction, base, "Selected answer is invalid")

    const config = match.gameConfig
    const pointsConfig = (config?.correctAnswerPoints ?? {}) as Record<string, unknown>
    const correctPoints = Number(pointsConfig[String(assignment.contentItem.difficulty)] ?? pointsConfig["1"] ?? 0)
    if (!Number.isSafeInteger(correctPoints) || correctPoints <= 0) return this.reject(transaction, base, "Game scoring is not configured")
    const correct = selectedAnswerIndex === assignment.contentItem.answerIndex
    const penalty = BigInt(Math.floor(correctPoints * (config.wrongAnswerPenaltyPercent / 100)))
    const points = correct ? BigInt(correctPoints) : -penalty
    await transaction.$queryRaw`SELECT "id" FROM "MatchParticipant" WHERE "id" = ${participant.id} FOR UPDATE`
    const locked = await transaction.matchParticipant.findUniqueOrThrow({ where: { id: participant.id } })
    const before = BigInt(locked.finalScore ?? 0)
    const after = before + points < 0n ? 0n : before + points
    if (after > 2147483647n) return this.reject(transaction, base, "Score exceeds the game limit")
    const event = await transaction.matchEvent.create({ data: { ...base, accepted: true, payload: { assignmentId, selectedAnswerIndex, correct, pointsEarned: points.toString(), timeTakenMs } } })
    await transaction.matchParticipant.update({ where: { id: participant.id }, data: { finalScore: Number(after), answeredCount: { increment: 1 } } })
    await transaction.matchContentAssignment.update({ where: { id: assignment.id }, data: { answeredAt: new Date() } })
    return event
  }

  private reject(transaction: Prisma.TransactionClient, base: any, reason: string) {
    return transaction.matchEvent.create({ data: { ...base, accepted: false, rejectionReason: reason } })
  }
}
