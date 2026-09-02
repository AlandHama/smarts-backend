import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common"
import { Prisma } from "@prisma/client"

import { PrismaTransaction } from "../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../prisma.service"

type RebuildInput = { userId: string; gameKey: string }

@Injectable()
export class RebuildPlayerGameStatsTransaction extends PrismaTransaction<RebuildInput, any> {
  constructor(prisma: PrismaService) { super(prisma) }

  protected async execute(input: RebuildInput, transaction: Prisma.TransactionClient) {
    if (!input.gameKey?.trim()) throw new BadRequestException("gameKey is required")
    const game = await transaction.gameDefinition.findUnique({ where: { key: input.gameKey.trim().toLowerCase() }, select: { id: true, key: true } })
    if (!game) throw new NotFoundException("Game definition not found")

    const matches = await transaction.match.findMany({
      where: { gameDefinitionId: game.id, status: "SETTLED", participants: { some: { userId: input.userId } }, settlement: { isNot: null } },
      orderBy: { endedAt: "asc" },
      take: 10_000,
      select: { id: true, endedAt: true, participants: { where: { userId: input.userId }, select: { id: true, userId: true } }, settlement: { select: { settlementJson: true } } },
    })
    const matchIds = matches.map((match) => match.id)
    const answerEvents = matchIds.length
      ? await transaction.matchEvent.findMany({ where: { matchId: { in: matchIds }, participant: { userId: input.userId }, eventType: "ANSWER", accepted: true }, select: { matchId: true, payload: true } })
      : []
    const answersByMatch = new Map<string, { correct: number; total: number; timeMs: bigint }>()
    for (const event of answerEvents) {
      const payload = event.payload && typeof event.payload === "object" && !Array.isArray(event.payload) ? event.payload as Record<string, unknown> : {}
      const current = answersByMatch.get(event.matchId) ?? { correct: 0, total: 0, timeMs: 0n }
      const timeMs = typeof payload.timeTakenMs === "number" && Number.isSafeInteger(payload.timeTakenMs) && payload.timeTakenMs >= 0 ? payload.timeTakenMs : 0
      current.total += 1
      current.correct += payload.correct === true ? 1 : 0
      current.timeMs += BigInt(timeMs)
      answersByMatch.set(event.matchId, current)
    }

    let gamesPlayed = 0
    let wins = 0
    let losses = 0
    let draws = 0
    let forfeits = 0
    let totalCorrect = 0
    let totalQuestions = 0
    let totalTimeMs = 0n
    let totalScore = 0n
    let bestScore = 0n
    let lastPlayedAt: Date | undefined

    for (const match of matches) {
      const participant = match.participants[0]
      if (!participant || !match.settlement) continue
      const settlement = match.settlement.settlementJson && typeof match.settlement.settlementJson === "object" && !Array.isArray(match.settlement.settlementJson) ? match.settlement.settlementJson as Record<string, unknown> : {}
      const results = Array.isArray(settlement.results) ? settlement.results as Array<Record<string, unknown>> : []
      const result = results.find((item) => item.playerId === input.userId)
      const resultType = typeof result?.result === "string" ? result.result : "LOSS"
      const scoreValue = typeof result?.score === "string" || typeof result?.score === "number" ? BigInt(result.score) : 0n
      const answers = answersByMatch.get(match.id) ?? { correct: 0, total: 0, timeMs: 0n }
      gamesPlayed += 1
      if (resultType === "WIN") wins += 1
      else if (resultType === "DRAW") draws += 1
      else if (resultType === "FORFEIT") forfeits += 1
      else losses += 1
      totalCorrect += answers.correct
      totalQuestions += answers.total
      totalTimeMs += answers.timeMs
      totalScore += scoreValue
      if (scoreValue > bestScore) bestScore = scoreValue
      if (match.endedAt) lastPlayedAt = match.endedAt
    }

    const stats = await transaction.playerGameStats.upsert({
      where: { userId_gameDefinitionId: { userId: input.userId, gameDefinitionId: game.id } },
      create: { userId: input.userId, gameDefinitionId: game.id, gamesPlayed, wins, losses, draws, forfeits, totalCorrect, totalQuestions, totalTimeMs, totalScore, bestScore, lastPlayedAt },
      update: { gamesPlayed, wins, losses, draws, forfeits, totalCorrect, totalQuestions, totalTimeMs, totalScore, bestScore, lastPlayedAt },
    })
    return { gameKey: game.key, userId: input.userId, rebuiltMatches: matches.length, stats }
  }
}
