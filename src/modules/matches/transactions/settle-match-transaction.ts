import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common"
import { createHash } from "node:crypto"
import { PlayerAuditActorType, Prisma, ProgressionEventSourceType, WalletTransactionSourceType, LeaderboardScoreSourceType } from "@prisma/client"

import { PrismaTransaction } from "../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../prisma.service"
import { ApplyLeaderboardScoreTransaction } from "../../leaderboard/transactions/apply-score-transaction"
import { AwardProgressionPointsTransaction } from "../../progression/transactions/award-progression-points-transaction"
import { CreditWalletTransaction } from "../../economy/transactions/credit-wallet-transaction"
import { writePlayerAudit } from "../../../common/helpers/player-audit"

type SettleInput = { matchId: string; userId: string; idempotencyKey: string }

@Injectable()
export class SettleMatchTransaction extends PrismaTransaction<SettleInput, any> {
  constructor(
    prisma: PrismaService,
    private readonly awardProgression: AwardProgressionPointsTransaction,
    private readonly creditWallet: CreditWalletTransaction,
    private readonly applyLeaderboardScore: ApplyLeaderboardScoreTransaction,
  ) { super(prisma) }

  protected async execute(input: SettleInput, transaction: Prisma.TransactionClient) {
    const match = await transaction.match.findUnique({ where: { id: input.matchId }, include: { gameDefinition: true, gameConfig: true, participants: { include: { user: { include: { profile: true } } } } } })
    if (!match) throw new NotFoundException("Match not found")
    if (!match.participants.some((item) => item.userId === input.userId)) throw new NotFoundException("Player is not a participant in this match")
    await transaction.$queryRaw`SELECT "id" FROM "Match" WHERE "id" = ${match.id} FOR UPDATE`
    const lockedMatch = await transaction.match.findUniqueOrThrow({ where: { id: match.id }, include: { gameDefinition: true, gameConfig: true, participants: { include: { user: { include: { profile: true } } } }, settlement: true } })
    if (lockedMatch.settlement) return lockedMatch.settlement.settlementJson
    if (lockedMatch.status === "CANCELLED" || lockedMatch.status === "SETTLED") throw new ConflictException("The match cannot be settled")

    const humanParticipants = lockedMatch.participants.filter((item) => item.participantType === "PLAYER")
    if (humanParticipants.some((item) => item.result === "PENDING")) return { status: "PENDING", matchId: lockedMatch.id, message: "Waiting for all players to finish" }
    const acceptedAnswers = await transaction.matchEvent.count({ where: { matchId: lockedMatch.id, eventType: "ANSWER", accepted: true } })
    if (!acceptedAnswers) {
      await transaction.match.update({ where: { id: lockedMatch.id }, data: { status: "REVIEW", endedAt: new Date() } })
      return { status: "REVIEW", matchId: lockedMatch.id, message: "No server-verified answers were recorded; competitive rewards were withheld" }
    }
    const config = lockedMatch.gameConfig
    if (!config || !config.active) throw new BadRequestException("Game reward configuration is inactive")
    const requestHash = createHash("sha256").update(JSON.stringify({ matchId: lockedMatch.id, idempotencyKey: input.idempotencyKey.trim() })).digest("hex")
    const idemScope = `match-settlement:${lockedMatch.id}`
    const idem = await transaction.idempotencyKey.upsert({ where: { scope_key: { scope: idemScope, key: input.idempotencyKey.trim() } }, create: { userId: input.userId, scope: idemScope, key: input.idempotencyKey.trim(), requestHash, status: "PROCESSING" }, update: {} })
    if (idem.requestHash !== requestHash) throw new ConflictException("The settlement idempotency key is invalid")
    if (idem.status === "COMPLETED" && idem.responseJson) return idem.responseJson

    const scores = humanParticipants.map((item) => ({ participant: item, score: BigInt(item.finalScore ?? 0) }))
    const highest = scores.reduce((max, current) => current.score > max ? current.score : max, scores[0]?.score ?? 0n)
    const winners = scores.filter((item) => item.score === highest && item.participant.result !== "FORFEIT")
    const forfeited = scores.find((item) => item.participant.result === "FORFEIT")
    const winner = forfeited ? scores.find((item) => item.participant.id !== forfeited.participant.id) : winners.length === 1 ? winners[0] : undefined
    const draw = !winner && !forfeited && scores.length > 1 && winners.length === scores.length
    const policyVersion = `${lockedMatch.gameDefinition.key}:v${config.version}`
    const results: any[] = []

    for (const item of scores) {
      const player = item.participant.user
      if (!player?.id) continue
      const isWinner = winner?.participant.id === item.participant.id
      const isDraw = draw
      const result = isWinner ? "WIN" : isDraw ? "DRAW" : item.participant.result === "FORFEIT" ? "FORFEIT" : "LOSS"
      const scoreDiff = winner && !isDraw ? item.score - (winner.participant.id === item.participant.id ? scores.find((candidate) => candidate.participant.id !== item.participant.id)?.score ?? 0n : winner.score) : 0n
      const eloDelta = item.participant.result === "FORFEIT" ? 0n : lockedMatch.mode === "SINGLE_PLAYER" || lockedMatch.mode === "BOT"
        ? this.multiply(BigInt(Math.min(config.soloEloMaxDelta, Number(item.score / BigInt(config.soloEloScoreDivisor)))), config.rankingEnabled ? config.rankingEloMultiplier.toString() : "1")
        : this.clamp(scoreDiff, -BigInt(config.maxEloDelta), BigInt(config.maxEloDelta))
      const xp = this.multiply(this.multiply(item.score, config.scoreMultiplierForXp.toString()), config.rankingEnabled ? config.rankingLevelMultiplier.toString() : "1")
      const rewardBase = isDraw ? config.drawReward : isWinner ? config.winnerBaseReward : config.loserBaseReward
      const rewardBonus = lockedMatch.mode === "SINGLE_PLAYER" || lockedMatch.mode === "BOT"
        ? this.min(config.scoreRewardCap, item.score / BigInt(config.scoreRewardDivisor))
        : isDraw ? 0n : this.min(isWinner ? config.winnerRewardBonusMax : config.loserRewardBonusMax, this.ratio(this.abs(scoreDiff), config.multiplayerRewardReference, isWinner ? config.winnerRewardBonusMax : config.loserRewardBonusMax))
      const coinReward = this.multiply(rewardBase + rewardBonus, config.rankingEnabled ? config.rankingCoinMultiplier.toString() : "1")

      const progression = await this.awardProgression.runWithinTransaction({ userId: player.id, progressionKey: config.mainProgressionKey, amount: xp, sourceId: `${lockedMatch.id}:xp:${player.id}`, sourceType: ProgressionEventSourceType.MATCH, metadata: { matchId: lockedMatch.id, policyVersion } }, transaction)
      const eloProgression = await this.awardProgression.runWithinTransaction({ userId: player.id, progressionKey: config.eloProgressionKey, amount: eloDelta, sourceId: `${lockedMatch.id}:elo:${player.id}`, sourceType: ProgressionEventSourceType.MATCH, metadata: { matchId: lockedMatch.id, policyVersion } }, transaction)
      const wallet = await this.creditWallet.runWithinTransaction({ userId: player.id, currencyCode: config.rewardCurrencyCode, amount: coinReward, sourceId: `${lockedMatch.id}:currency:${player.id}`, sourceType: WalletTransactionSourceType.MATCH, metadata: { matchId: lockedMatch.id, result, policyVersion } }, transaction)
      const answerEvents = await transaction.matchEvent.findMany({ where: { matchId: lockedMatch.id, participantId: item.participant.id, eventType: "ANSWER", accepted: true }, select: { payload: true } })
      const answerSummary = answerEvents.reduce((summary, event) => {
        const payload = event.payload && typeof event.payload === "object" && !Array.isArray(event.payload) ? event.payload as Record<string, unknown> : {}
        const timeTakenMs = typeof payload.timeTakenMs === "number" && Number.isSafeInteger(payload.timeTakenMs) && payload.timeTakenMs >= 0 ? payload.timeTakenMs : 0
        return { totalQuestions: summary.totalQuestions + 1, totalCorrect: summary.totalCorrect + (payload.correct === true ? 1 : 0), totalTimeMs: summary.totalTimeMs + BigInt(timeTakenMs) }
      }, { totalQuestions: 0, totalCorrect: 0, totalTimeMs: 0n })
      await this.updateStats(transaction, lockedMatch, item.participant, result, item.score, answerSummary)
      if (eloDelta > 0n && winner?.participant.id === item.participant.id) {
        const leaderboardKeys = this.getLeaderboardKeys(config)
        for (const leaderboardKey of [leaderboardKeys.playerWeekly, leaderboardKeys.playerMonthly]) await this.applyLeaderboardScore.runWithinTransaction({ leaderboardKey, playerId: player.id, delta: eloDelta, sourceId: `${lockedMatch.id}:leaderboard:${leaderboardKey}:${player.id}`, sourceType: LeaderboardScoreSourceType.MATCH, metadata: { matchId: lockedMatch.id, policyVersion } }, transaction)
        const country = player.profile?.countryCode?.trim().toUpperCase()
        const opponent = humanParticipants.find((candidate) => candidate.id !== item.participant.id)?.user?.profile?.countryCode?.trim().toUpperCase()
        if (country && country !== opponent) for (const leaderboardKey of [leaderboardKeys.countryWeekly, leaderboardKeys.countryMonthly]) await this.applyLeaderboardScore.runWithinTransaction({ leaderboardKey, memberKey: country, delta: eloDelta, sourceId: `${lockedMatch.id}:leaderboard:${leaderboardKey}:${country}`, sourceType: LeaderboardScoreSourceType.MATCH, metadata: { matchId: lockedMatch.id, policyVersion } }, transaction)
      }
      await transaction.matchParticipant.update({ where: { id: item.participant.id }, data: { result, submittedAt: item.participant.submittedAt ?? new Date() } })
      await writePlayerAudit(transaction, { userId: player.id, actorType: PlayerAuditActorType.SYSTEM, action: "MATCH_SETTLED", entityType: "Match", entityId: lockedMatch.id, summary: `Match settled with result ${result}`, metadata: { gameKey: lockedMatch.gameDefinition.key, result, score: item.score.toString(), eloDelta: eloDelta.toString(), xp: xp.toString(), currencyReward: coinReward.toString(), policyVersion } })
      results.push({ playerId: player.id, username: player.username, result, score: item.score.toString(), eloDelta: eloDelta.toString(), progression, eloProgression, wallet })
    }

    const settlementJson = { status: "SETTLED", matchId: lockedMatch.id, policyVersion, winnerPlayerId: winner?.participant.userId ?? null, draw, results }
    const settlement = await transaction.matchSettlement.create({ data: { matchId: lockedMatch.id, policyVersion, winnerParticipantId: winner?.participant.id, settlementJson: settlementJson as Prisma.InputJsonValue, idempotencyKeyId: idem.id } })
    await transaction.outboxEvent.create({ data: { eventType: "MATCH_SETTLED", aggregateType: "Match", aggregateId: lockedMatch.id, payload: settlementJson as Prisma.InputJsonValue } })
    await transaction.match.update({ where: { id: lockedMatch.id }, data: { status: "SETTLED", endedAt: lockedMatch.endedAt ?? new Date(), settledAt: new Date() } })
    await transaction.idempotencyKey.update({ where: { id: idem.id }, data: { status: "COMPLETED", responseJson: settlementJson as Prisma.InputJsonValue, completedAt: new Date() } })
    return settlementJson
  }

  private async updateStats(transaction: Prisma.TransactionClient, match: any, participant: any, result: string, score: bigint, answers: { totalCorrect: number; totalQuestions: number; totalTimeMs: bigint }) {
    if (!participant.userId) return
    const stats = await transaction.playerStats.findUnique({ where: { userId: participant.userId } })
    if (stats) {
      await transaction.$queryRaw`SELECT "id" FROM "PlayerStats" WHERE "id" = ${stats.id} FOR UPDATE`
      const streak = result === "WIN" ? stats.currentWinStreak + 1 : 0
      await transaction.playerStats.update({ where: { id: stats.id }, data: { gamesPlayed: { increment: 1 }, wins: result === "WIN" ? { increment: 1 } : undefined, losses: result === "LOSS" ? { increment: 1 } : undefined, draws: result === "DRAW" ? { increment: 1 } : undefined, currentWinStreak: streak, highestWinStreak: streak > stats.highestWinStreak ? streak : undefined, totalScore: { increment: score } } })
    }
    const gameStats = await transaction.playerGameStats.upsert({ where: { userId_gameDefinitionId: { userId: participant.userId, gameDefinitionId: match.gameDefinitionId } }, create: { userId: participant.userId, gameDefinitionId: match.gameDefinitionId, gamesPlayed: 1, wins: result === "WIN" ? 1 : 0, losses: result === "LOSS" ? 1 : 0, draws: result === "DRAW" ? 1 : 0, forfeits: result === "FORFEIT" ? 1 : 0, totalCorrect: answers.totalCorrect, totalQuestions: answers.totalQuestions, totalTimeMs: answers.totalTimeMs, totalScore: score, bestScore: score, lastPlayedAt: new Date() }, update: { gamesPlayed: { increment: 1 }, wins: result === "WIN" ? { increment: 1 } : undefined, losses: result === "LOSS" ? { increment: 1 } : undefined, draws: result === "DRAW" ? { increment: 1 } : undefined, forfeits: result === "FORFEIT" ? { increment: 1 } : undefined, totalCorrect: { increment: answers.totalCorrect }, totalQuestions: { increment: answers.totalQuestions }, totalTimeMs: { increment: answers.totalTimeMs }, totalScore: { increment: score }, lastPlayedAt: new Date() } })
    if (gameStats.bestScore < score) await transaction.playerGameStats.update({ where: { id: gameStats.id }, data: { bestScore: score } })
  }

  private abs(value: bigint) { return value < 0n ? -value : value }
  private min(a: bigint, b: bigint) { return a < b ? a : b }
  private clamp(value: bigint, minimum: bigint, maximum: bigint) { return value < minimum ? minimum : value > maximum ? maximum : value }
  private ratio(numerator: bigint, denominator: bigint, cap: bigint) { return denominator <= 0n ? 0n : this.min(cap, (numerator * cap + denominator / 2n) / denominator) }
  private multiply(value: bigint, multiplier: string) {
    const [whole, fraction = ""] = multiplier.split(".")
    const scale = 10n ** BigInt(fraction.length)
    const scaled = BigInt(whole) * scale + BigInt(fraction || "0")
    const sign = value < 0n ? -1n : 1n
    const absolute = this.abs(value)
    return sign * ((absolute * scaled + scale / 2n) / scale)
  }

  private getLeaderboardKeys(config: any) {
    const keys = (config.settings as Record<string, any> | null)?.leaderboardKeys
    if (!keys?.playerWeekly || !keys?.playerMonthly || !keys?.countryWeekly || !keys?.countryMonthly) throw new BadRequestException("Leaderboard keys are not configured for this game")
    return keys as { playerWeekly: string; playerMonthly: string; countryWeekly: string; countryMonthly: string }
  }
}
