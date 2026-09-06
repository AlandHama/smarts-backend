import { Injectable } from "@nestjs/common"
import { createHash } from "node:crypto"
import { MatchParticipantType, Prisma } from "@prisma/client"

import { createAssignmentToken } from "./utilities/server-content"

type BotCompletionInput = { matchId: string; userId: string }

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
 * Produces a server-owned bot projection when the human player completes a
 * bot match. Learning is deliberately derived from accepted human answer
 * events only, so bot answers never train the bot or amplify their own skill.
 */
@Injectable()
export class BotGameplayService {
  async completeWithinTransaction(
    input: BotCompletionInput,
    transaction: Prisma.TransactionClient,
  ) {
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
          where: { participant: { userId: input.userId } },
          orderBy: { position: "asc" },
          include: { contentItem: true },
        },
      },
    })
    if (!match || match.mode !== "BOT") return

    const bot = match.participants.find(
      (participant) => participant.participantType === MatchParticipantType.BOT,
    )
    const player = match.participants.find(
      (participant) => participant.userId === input.userId,
    )
    const round = match.rounds[0]
    if (!bot || !player || !round || bot.result !== "PENDING") return

    const humanAnswers = await transaction.matchEvent.count({
      where: {
        matchId: match.id,
        participantId: player.id,
        eventType: "ANSWER",
        accepted: true,
      },
    })
    const now = new Date()

    // A player who submitted no verified answer is sent to review. The bot
    // still closes its participant row, but must not manufacture evidence
    // that would turn an empty human game into a rewarded result.
    if (!humanAnswers || !match.assignments.length) {
      await transaction.matchParticipant.update({
        where: { id: bot.id },
        data: { result: "COMPLETED", finalScore: 0, submittedAt: now },
      })
      return
    }

    const learning = await this.loadLearningProfile(match.id, match.gameDefinitionId, input.userId, transaction)
    const botAssignments = []
    for (const playerAssignment of match.assignments) {
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
      botAssignments.push({ assignment: botAssignment, token })
    }

    let score = 0
    let simulatedCount = 0
    const correctPointsConfig = (match.gameConfig.correctAnswerPoints ?? {}) as Record<string, unknown>
    const penaltyPercent = match.gameConfig.wrongAnswerPenaltyPercent
    for (const { assignment } of botAssignments.slice(0, humanAnswers)) {
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
      const maxTimeMs = Math.max(1000, match.gameConfig.maxAnswerTimeSeconds * 1000)
      const averageTimeMs = profile.timedAnswers
        ? profile.totalTimeMs / profile.timedAnswers
        : learning.global.timedAnswers
          ? learning.global.totalTimeMs / learning.global.timedAnswers
          : maxTimeMs * 0.55
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
        data: { answeredAt: new Date() },
      })
      simulatedCount += 1
    }

    await transaction.matchParticipant.update({
      where: { id: bot.id },
      data: {
        result: "COMPLETED",
        finalScore: score,
        answeredCount: simulatedCount,
        submittedAt: now,
      },
    })
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
