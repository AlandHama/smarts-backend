import { Injectable } from "@nestjs/common"
import { createHash } from "node:crypto"
import { MatchParticipantType, Prisma } from "@prisma/client"

import { PrismaService } from "../../prisma.service"
import { createAssignmentToken } from "./utilities/server-content"

type BotCompletionInput = { matchId: string; userId?: string; finalize?: boolean }

type AnswerProfile = {
  answers: number
  correct: number
  totalTimeMs: number
  timedAnswers: number
}

type LearningProfile = {
  global: AnswerProfile
  byContent: Map<string, AnswerProfile>
  playerAccuracy: number | null
}

/**
 * Produces a server-owned bot projection while a bot match is active and
 * completes that projection when the human player finishes. Learning is
 * deliberately derived from accepted human answer events only, so bot
 * answers never train the bot or amplify their own skill.
 */
@Injectable()
export class BotGameplayService {
  constructor(private readonly prisma: PrismaService) {}

  /** Advance active bots from the server worker so their score is visible
   * during play, even for legacy game screens that do not submit ANSWER events
   * for every local challenge yet. */
  async progressActiveMatches() {
    const matches = await this.prisma.match.findMany({
      where: {
        mode: "BOT",
        status: "STARTED",
        participants: {
          some: { participantType: MatchParticipantType.BOT, result: "PENDING" },
        },
      },
      orderBy: { startedAt: "asc" },
      take: 100,
      select: { id: true },
    })
    for (const match of matches) {
      await this.prisma.$transaction((transaction) =>
        this.progressWithinTransaction({ matchId: match.id, finalize: false }, transaction),
      )
    }
  }

  async completeWithinTransaction(
    input: BotCompletionInput,
    transaction: Prisma.TransactionClient,
  ) {
    return this.progressWithinTransaction({ ...input, finalize: true }, transaction)
  }

  private async progressWithinTransaction(
    input: BotCompletionInput,
    transaction: Prisma.TransactionClient,
  ) {
    await transaction.$executeRaw`SELECT "id" FROM "Match" WHERE "id" = ${input.matchId} FOR UPDATE`
    const match = await transaction.match.findUnique({
      where: { id: input.matchId },
      include: {
        gameConfig: true,
        participants: true,
        rounds: {
          where: { status: { in: ["CREATED", "STARTED"] } },
          orderBy: { roundIndex: "desc" },
          take: 1,
        },
        assignments: {
          orderBy: { position: "asc" },
          include: { contentItem: true },
        },
      },
    })
    if (!match || match.mode !== "BOT") return

    const bot = match.participants.find(
      (participant) => participant.participantType === MatchParticipantType.BOT,
    )
    const player = match.participants.find((participant) =>
      participant.participantType === MatchParticipantType.PLAYER &&
      (!input.userId || participant.userId === input.userId),
    )
    const round = match.rounds[0]
    if (!bot || !player || !round || bot.result !== "PENDING") return
    const now = new Date()

    const playerAssignments = match.assignments.filter(
      (assignment) => assignment.participantId === player.id,
    )
    if (!playerAssignments.length) {
      if (input.finalize) {
        await transaction.matchParticipant.update({
          where: { id: bot.id },
          data: { result: "COMPLETED", finalScore: 0, answeredCount: 0, submittedAt: now },
        })
      }
      return
    }

    const learning = await this.loadLearningProfile(
      match.id,
      match.gameDefinitionId,
      player.userId ?? "",
      transaction,
    )
    const existingBotAssignments = match.assignments.filter(
      (assignment) => assignment.participantId === bot.id,
    )
    const botAssignments = [...existingBotAssignments]
    for (const playerAssignment of playerAssignments) {
      if (botAssignments.some((assignment) => assignment.position === playerAssignment.position)) continue
      const token = createAssignmentToken(
        match.serverNonce,
        bot.id,
        round.id,
        playerAssignment.position,
      )
      const botAssignment = await transaction.matchContentAssignment.create({
        data: {
          matchId: match.id,
          roundId: round.id,
          participantId: bot.id,
          contentItemId: playerAssignment.contentItemId,
          position: playerAssignment.position,
          assignmentTokenHash: createHash("sha256").update(token).digest("hex"),
          expiresAt: playerAssignment.expiresAt,
        },
        include: { contentItem: true },
      })
      botAssignments.push(botAssignment)
    }
    botAssignments.sort((left, right) => left.position - right.position)

    const maxTimeMs = Math.max(1000, match.gameConfig.maxAnswerTimeSeconds * 1000)
    const paceMs = this.botAnswerPace(learning, maxTimeMs, match.serverNonce)
    const elapsedMs = Math.max(
      0,
      now.getTime() - (match.startedAt ?? match.createdAt).getTime(),
    )
    const targetAnswers = Math.min(
      botAssignments.length,
      Math.floor(elapsedMs / paceMs),
    )
    let score = bot.finalScore ?? 0
    let simulatedCount = bot.answeredCount ?? 0
    const correctPointsConfig = (match.gameConfig.correctAnswerPoints ?? {}) as Record<string, unknown>
    const penaltyPercent = match.gameConfig.wrongAnswerPenaltyPercent
    const unanswered = botAssignments.filter((assignment) => !assignment.answeredAt)
    for (const assignment of unanswered.slice(0, Math.max(0, targetAnswers - simulatedCount))) {
      const content = assignment.contentItem
      const profile = learning.byContent.get(content.id) ?? learning.global
      const accuracy = this.targetAccuracy(profile, learning.playerAccuracy, learning.global)
      const random = this.randomFraction(`${match.serverNonce}:bot:${assignment.id}`)
      const options = Array.isArray(content.options) ? content.options : []
      if (!options.length) continue

      const correct = random < accuracy
      const selectedAnswerIndex = correct
        ? content.answerIndex
        : this.wrongAnswerIndex(
            content.answerIndex,
            options.length,
            `${match.serverNonce}:wrong:${assignment.id}`,
          )
      const averageTimeMs = profile.timedAnswers
        ? profile.totalTimeMs / profile.timedAnswers
        : learning.global.timedAnswers
          ? learning.global.totalTimeMs / learning.global.timedAnswers
          : 2200
      const timeTakenMs = Math.max(
        250,
        Math.min(maxTimeMs - 100, Math.round(averageTimeMs * (0.85 + random * 0.3))),
      )
      const correctPoints = Number(
        correctPointsConfig[String(content.difficulty)] ?? correctPointsConfig["1"] ?? 0,
      )
      const penalty = Math.floor(correctPoints * (penaltyPercent / 100))
      const pointsEarned = correct ? correctPoints : -penalty
      score = Math.max(0, score + pointsEarned)

      await transaction.matchEvent.create({
        data: {
          matchId: match.id,
          participantId: bot.id,
          roundId: round.id,
          sequence: assignment.position + 1,
          eventType: "ANSWER",
          clientEventId: `bot-answer-${match.id}-${assignment.position}`,
          accepted: true,
          payload: {
            assignmentId: assignment.id,
            selectedAnswerIndex,
            correct,
            pointsEarned: String(pointsEarned),
            timeTakenMs,
            source: "SERVER_BOT",
          } as Prisma.InputJsonValue,
        },
      })
      await transaction.matchContentAssignment.update({
        where: { id: assignment.id },
        data: { answeredAt: now },
      })
      simulatedCount += 1
    }

    await transaction.matchParticipant.update({
      where: { id: bot.id },
      data: {
        finalScore: score,
        answeredCount: simulatedCount,
        ...(input.finalize
          ? { result: "COMPLETED" as const, submittedAt: now }
          : {}),
      },
    })
  }

  private botAnswerPace(learning: LearningProfile, maxTimeMs: number, seed: string) {
    const learnedAverage = learning.global.timedAnswers
      ? learning.global.totalTimeMs / learning.global.timedAnswers
      : 2200
    const variation = 0.9 + this.randomFraction(`${seed}:pace`) * 0.2
    return Math.max(900, Math.min(maxTimeMs - 100, Math.round(learnedAverage * variation)))
  }

  private async loadLearningProfile(
    matchId: string,
    gameDefinitionId: string,
    playerUserId: string,
    transaction: Prisma.TransactionClient,
  ): Promise<LearningProfile> {
    const [events, playerStats] = await Promise.all([
      transaction.matchEvent.findMany({
        where: {
          matchId: { not: matchId },
          eventType: "ANSWER",
          accepted: true,
          participant: { participantType: MatchParticipantType.PLAYER },
          match: { gameDefinitionId },
        },
        orderBy: { serverReceivedAt: "desc" },
        take: 5000,
        select: { payload: true },
      }),
      transaction.playerGameStats.findUnique({
        where: { userId_gameDefinitionId: { userId: playerUserId, gameDefinitionId } },
        select: { totalCorrect: true, totalQuestions: true },
      }),
    ])
    const assignmentIds = events
      .map((event) => this.payload(event.payload).assignmentId)
      .filter((id): id is string => Boolean(id))
    const assignments = assignmentIds.length
      ? await transaction.matchContentAssignment.findMany({
          where: { id: { in: assignmentIds } },
          select: { id: true, contentItemId: true },
        })
      : []
    const contentByAssignment = new Map(
      assignments.map((assignment) => [assignment.id, assignment.contentItemId]),
    )
    const global: AnswerProfile = { answers: 0, correct: 0, totalTimeMs: 0, timedAnswers: 0 }
    const byContent = new Map<string, AnswerProfile>()
    for (const event of events) {
      const payload = this.payload(event.payload)
      const timeTakenMs = typeof payload.timeTakenMs === "number" && Number.isFinite(payload.timeTakenMs)
        ? Math.max(0, Math.min(120_000, Math.trunc(payload.timeTakenMs)))
        : 0
      this.addObservation(global, payload.correct === true, timeTakenMs)
      const contentId = typeof payload.assignmentId === "string"
        ? contentByAssignment.get(payload.assignmentId)
        : undefined
      if (contentId) {
        const profile = byContent.get(contentId) ?? { answers: 0, correct: 0, totalTimeMs: 0, timedAnswers: 0 }
        this.addObservation(profile, payload.correct === true, timeTakenMs)
        byContent.set(contentId, profile)
      }
    }
    return {
      global,
      byContent,
      playerAccuracy: playerStats && playerStats.totalQuestions > 0
        ? this.clamp(playerStats.totalCorrect / playerStats.totalQuestions, 0, 1)
        : null,
    }
  }

  private targetAccuracy(profile: AnswerProfile, playerAccuracy: number | null, global: AnswerProfile) {
    const learned = profile.answers ? profile.correct / profile.answers : global.answers ? global.correct / global.answers : 0.55
    const playerTarget = playerAccuracy ?? learned
    return this.clamp(learned * 0.7 + playerTarget * 0.3, 0.35, 0.85)
  }

  private addObservation(profile: AnswerProfile, correct: boolean, timeTakenMs: number) {
    profile.answers += 1
    if (correct) profile.correct += 1
    if (timeTakenMs > 0) {
      profile.totalTimeMs += timeTakenMs
      profile.timedAnswers += 1
    }
  }

  private payload(value: Prisma.JsonValue | null): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
  }

  private randomFraction(seed: string) {
    const hex = createHash("sha256").update(seed).digest("hex").slice(0, 12)
    return Number(BigInt(`0x${hex}`)) / Number(BigInt("0xffffffffffff"))
  }

  private wrongAnswerIndex(correctIndex: number, optionCount: number, seed: string) {
    if (optionCount < 2) return correctIndex
    const candidate = Math.floor(this.randomFraction(seed) * (optionCount - 1))
    return candidate >= correctIndex ? candidate + 1 : candidate
  }

  private clamp(value: number, minimum: number, maximum: number) {
    return Math.min(maximum, Math.max(minimum, value))
  }
}
