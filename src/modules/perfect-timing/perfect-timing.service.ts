import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common"
import { MatchParticipantResult, Prisma } from "@prisma/client"

import { PrismaService } from "../../prisma.service"
import { SettleMatchTransaction } from "../matches/transactions/settle-match-transaction"
import { FraudService } from "../fraud/fraud.service"
import { PerfectTimingTapDto } from "./dtos/perfect-timing.dto"
import { createPerfectTimingSchedule, evaluatePerfectTimingTap, markerPositionAt, perfectTimingScheduleCommitment, perfectTimingStateHash, PerfectTimingRoundSpec, targetCenterAt } from "./engine/perfect-timing-engine"
import { DEFAULT_PERFECT_TIMING_POLICY, mergePerfectTimingPolicy, PerfectTimingJudgement, PerfectTimingMode, PerfectTimingPolicy } from "./engine/perfect-timing-score"

type MatchRow = any
type TimingRow = any

@Injectable()
export class PerfectTimingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settleMatch: SettleMatchTransaction,
    private readonly fraud: FraudService,
  ) {}

  async snapshot(userId: string, matchId: string): Promise<any> {
    const response = await this.prisma.$transaction(async (tx) => {
      await this.lockMatch(tx, matchId)
      let match = await this.loadMatch(tx, matchId)
      const participant = this.authorize(match, userId)
      const policy = this.policy(match)
      let timing = await this.ensureState(tx, match, policy)
      let finalized = false
      if (match.status === "STARTED") {
        timing = await this.advanceBot(tx, match, timing, policy, Date.now())
        timing = await this.advanceLifecycle(tx, match, timing, policy, Date.now())
        if (timing.endedAt) {
          finalized = true
          match = await this.loadMatch(tx, matchId)
        }
      }
      return { projection: await this.project(tx, match, timing, participant.id, policy), finalized }
    })
    if (response.finalized) await this.settleFinishedMatch(matchId)
    return response.projection
  }

  async start(userId: string, matchId: string) {
    const response = await this.prisma.$transaction(async (tx) => {
      await this.lockMatch(tx, matchId)
      const match = await this.loadMatch(tx, matchId)
      const participant = this.authorize(match, userId)
      if (!['CREATED', 'STARTED'].includes(match.status)) throw new ConflictException("The Perfect Timing match cannot be started")
      const policy = this.policy(match)
      let timing = await this.ensureState(tx, match, policy)
      const now = new Date()
      await tx.matchParticipant.update({ where: { id: participant.id }, data: { readyAt: participant.readyAt ?? now, lastActivityAt: now, disconnectGraceUntil: null } })
      const participants = await tx.matchParticipant.findMany({ where: { matchId }, select: { participantType: true, readyAt: true } })
      const readyCount = participants.filter((item: any) => item.participantType === "BOT" || item.readyAt !== null).length
      if (readyCount < participants.length) return { ...(await this.project(tx, match, timing, participant.id, policy)), waitingForPlayers: true, readyCount, requiredCount: participants.length }
      if (!timing.startedAt) {
        timing = await this.beginMatch(tx, match, timing, policy, now)
      } else if (match.status === "CREATED") {
        await tx.match.update({ where: { id: matchId }, data: { status: "STARTED", startedAt: timing.startedAt } })
      }
      const currentMatch = await this.loadMatch(tx, matchId)
      return this.project(tx, currentMatch, timing, participant.id, policy)
    })
    return response
  }

  async tap(userId: string, matchId: string, dto: PerfectTimingTapDto) {
    const response = await this.prisma.$transaction(async (tx) => {
      await this.lockMatch(tx, matchId)
      let match = await this.loadMatch(tx, matchId)
      const participant = this.authorize(match, userId)
      const policy = this.policy(match)
      let timing = await this.ensureState(tx, match, policy)
      const state = await tx.perfectTimingParticipantState.findUnique({ where: { matchParticipantId: participant.id } })
      if (!state) throw new ConflictException("The Perfect Timing player state is unavailable")
      const existing = await tx.perfectTimingAction.findUnique({ where: { matchId_matchParticipantId_clientActionId: { matchId, matchParticipantId: participant.id, clientActionId: dto.clientActionId } } })
      if (existing) return { projection: await this.project(tx, match, timing, participant.id, policy), tap: this.actionProjection(existing, state.score), finalized: false }
      if (match.status !== "STARTED") throw new ConflictException("The Perfect Timing match is not active")
      if (dto.sequence !== state.nextSequence) throw new ConflictException("Tap sequence is out of date; reconcile the match")

      timing = await this.advanceBot(tx, match, timing, policy, Date.now())
      timing = await this.advanceLifecycle(tx, match, timing, policy, Date.now())
      if (timing.endedAt || timing.currentRoundStatus !== "ACTIVE") {
        return { projection: await this.project(tx, await this.loadMatch(tx, matchId), timing, participant.id, policy), tap: { accepted: false, sequence: dto.sequence, scoreDelta: 0, totalScore: state.score, reason: "MATCH_ALREADY_RESOLVED" }, finalized: Boolean(timing.endedAt) }
      }
      const nowMs = Date.now()
      const challengeIndex = Math.min(state.nextSequence - 1, timing.roundCount - 1)
      const challenge = this.challengeAt(timing, challengeIndex)
      const startedMs = state.lastTapAt?.getTime() ?? timing.startedAt?.getTime() ?? nowMs
      const deadlineMs = timing.roundDeadlineAt?.getTime() ?? startedMs + policy.matchDurationMs
      const estimatedTapMs = this.estimateTapServerMs(dto, nowMs, policy)
      if (estimatedTapMs < (timing.startedAt?.getTime() ?? startedMs) || estimatedTapMs > deadlineMs) {
        const rejected = await this.recordRejected(tx, match, timing, participant.id, dto, "TAP_OUTSIDE_MATCH_WINDOW", estimatedTapMs, challengeIndex)
        return { projection: await this.project(tx, match, timing, participant.id, policy), tap: this.actionProjection(rejected, state.score), finalized: false }
      }
      const evaluation = evaluatePerfectTimingTap(challenge, estimatedTapMs, startedMs, policy)
      const accepted = await this.recordAccepted(tx, match, timing, participant.id, dto, evaluation, estimatedTapMs, "TAP", challengeIndex)
      timing = await tx.perfectTimingMatch.findUniqueOrThrow({ where: { matchId } })
      const updatedState = await tx.perfectTimingParticipantState.findUniqueOrThrow({ where: { matchParticipantId: participant.id } })
      const finalized = Boolean(timing.endedAt)
      if (finalized) match = await this.loadMatch(tx, matchId)
      return { projection: await this.project(tx, match, timing, participant.id, policy), tap: this.actionProjection(accepted, updatedState.score), finalized }
    })
    if (response.finalized) await this.settleFinishedMatch(matchId)
    if (response.tap?.accepted === false && response.tap.reason) void this.fraud.observe(userId, { type: "PERFECT_TIMING_INVALID_TAP", sourceType: "PERFECT_TIMING", sourceId: `${matchId}:${response.tap.sequence}`, metadata: { matchId, reason: response.tap.reason } }).catch(() => undefined)
    return { ...response.projection, tap: response.tap }
  }

  async forfeit(userId: string, matchId: string) {
    const response = await this.prisma.$transaction(async (tx) => {
      await this.lockMatch(tx, matchId)
      const match = await this.loadMatch(tx, matchId)
      const participant = this.authorize(match, userId)
      const policy = this.policy(match)
      const timing = await this.ensureState(tx, match, policy)
      if (["FINISHED", "SETTLED"].includes(match.status)) return { projection: await this.project(tx, match, timing, participant.id, policy), finalized: false }
      await this.finish(tx, match, timing, participant.id, policy)
      const finishedMatch = await this.loadMatch(tx, matchId)
      const finishedTiming = await tx.perfectTimingMatch.findUniqueOrThrow({ where: { matchId } })
      return { projection: await this.project(tx, finishedMatch, finishedTiming, participant.id, policy), finalized: true }
    })
    if (response.finalized) await this.settleFinishedMatch(matchId)
    return response.projection
  }

  async clock() {
    return { serverNow: new Date().toISOString(), serverNowMs: Date.now(), protocol: 1 }
  }

  async finalizeExpiredMatches() {
    const active = await this.prisma.match.findMany({ where: { gameDefinition: { key: "perfect_timing" }, status: "STARTED" }, select: { id: true, participants: { where: { participantType: "PLAYER", userId: { not: null } }, select: { userId: true }, take: 1 } }, orderBy: { startedAt: "asc" }, take: 100 })
    let finalized = 0
    for (const match of active) {
      const userId = match.participants[0]?.userId
      if (!userId) continue
      try { const snapshot = await this.snapshot(userId, match.id); if (["FINISHED", "REVIEW", "SETTLED"].includes(snapshot.status)) finalized += 1 } catch { /* another worker owns this match */ }
    }
    return { finalized }
  }

  async retryPendingSettlements() {
    const pending = await this.prisma.match.findMany({ where: { gameDefinition: { key: "perfect_timing" }, status: { in: ["FINISHED", "REVIEW"] }, settlement: null }, select: { id: true, participants: { where: { participantType: "PLAYER", userId: { not: null } }, select: { userId: true }, take: 1 } }, orderBy: { endedAt: "asc" }, take: 100 })
    let settled = 0
    for (const match of pending) if (match.participants[0]?.userId) { const result = await this.settleFinishedMatch(match.id); if (result?.status === "SETTLED") settled += 1 }
    return { settled }
  }

  async retrySettlement(matchId: string) {
    const match = await this.prisma.match.findFirst({ where: { id: matchId, gameDefinition: { key: "perfect_timing" } }, select: { id: true, status: true } })
    if (!match) throw new NotFoundException("Perfect Timing match not found")
    if (!["FINISHED", "REVIEW", "SETTLED"].includes(match.status)) throw new ConflictException("Only finished Perfect Timing matches can be settled")
    if (match.status !== "SETTLED") await this.settleFinishedMatch(matchId)
    return this.prisma.matchSettlement.findUnique({ where: { matchId } })
  }

  private async beginMatch(tx: Prisma.TransactionClient, match: MatchRow, timing: TimingRow, policy: PerfectTimingPolicy, now: Date) {
    const startedAt = now
    const updated = await tx.perfectTimingMatch.update({ where: { id: timing.id }, data: { startedAt, roundStartedAt: startedAt, roundDeadlineAt: new Date(now.getTime() + policy.matchDurationMs), currentRoundStatus: "ACTIVE", stateHash: this.stateHash(timing, { startedAt: startedAt.toISOString(), currentRoundStatus: "ACTIVE", roundDeadlineAt: new Date(now.getTime() + policy.matchDurationMs).toISOString() }) } })
    await tx.match.update({ where: { id: match.id }, data: { status: "STARTED", startedAt } })
    await tx.analyticsEvent.create({ data: { eventName: "PERFECT_TIMING_MATCH_STARTED", occurredAt: now, matchId: match.id, playerId: match.createdByUserId, properties: { rulesVersion: policy.rulesVersion, policyVersion: policy.policyVersion, challengeCount: timing.roundCount, matchDurationMs: policy.matchDurationMs, mode: match.mode } as Prisma.InputJsonValue } })
    return updated
  }

  private async advanceLifecycle(tx: Prisma.TransactionClient, match: MatchRow, timing: TimingRow, policy: PerfectTimingPolicy, nowMs: number): Promise<TimingRow> {
    if (timing.currentRoundStatus === "ACTIVE" && timing.roundDeadlineAt && nowMs >= timing.roundDeadlineAt.getTime()) {
      await this.finish(tx, match, timing, null, policy)
      return tx.perfectTimingMatch.findUniqueOrThrow({ where: { matchId: match.id } })
    }
    return timing
  }

  private async advanceBot(tx: Prisma.TransactionClient, match: MatchRow, timing: TimingRow, policy: PerfectTimingPolicy, nowMs: number): Promise<TimingRow> {
    const bot = match.participants.find((item: any) => item.participantType === "BOT")
    if (!bot || !policy.bot.enabled || timing.currentRoundStatus !== "ACTIVE" || !timing.startedAt) return timing
    if (timing.roundDeadlineAt && nowMs >= timing.roundDeadlineAt.getTime()) return timing
    const state = await tx.perfectTimingParticipantState.findUniqueOrThrow({ where: { matchParticipantId: bot.id } })
    const challengeIndex = Math.min(state.nextSequence - 1, timing.roundCount - 1)
    const challenge = this.challengeAt(timing, challengeIndex)
    const startedAt = state.lastTapAt?.getTime() ?? timing.startedAt.getTime()
    if (nowMs < startedAt + policy.bot.reactionDelayMs) return timing
    const best = this.bestBotTap(challenge, startedAt, policy, match.serverNonce, challengeIndex)
    const dto = { sequence: state.nextSequence, clientActionId: `bot:${match.id}:${challengeIndex}:${bot.id}`, clientTapMonotonicMs: 0 } as PerfectTimingTapDto
    const evaluation = evaluatePerfectTimingTap(challenge, best, startedAt, policy)
    await this.recordAccepted(tx, match, timing, bot.id, dto, evaluation, best, "BOT_TAP", challengeIndex)
    return tx.perfectTimingMatch.findUniqueOrThrow({ where: { matchId: match.id } })
  }

  private bestBotTap(round: PerfectTimingRoundSpec, startedAt: number, policy: PerfectTimingPolicy, seed: string, roundIndex: number): number {
    let bestTime = startedAt + Math.min(round.durationMs - 100, policy.bot.reactionDelayMs)
    let bestError = Number.POSITIVE_INFINITY
    for (let offset = 0; offset <= round.durationMs; offset += 5) {
      const evaluation = evaluatePerfectTimingTap(round, startedAt + offset, startedAt, policy)
      if (evaluation.timingErrorMs < bestError) { bestError = evaluation.timingErrorMs; bestTime = startedAt + offset }
    }
    const jitter = Math.round((this.seedUnit(`${seed}:bot`, roundIndex) - 0.5) * policy.bot.jitterMs * (1.2 - policy.bot.skill))
    return Math.max(startedAt, Math.min(startedAt + round.durationMs, bestTime + jitter))
  }

  private async recordAccepted(tx: Prisma.TransactionClient, match: MatchRow, timing: TimingRow, participantId: string, dto: PerfectTimingTapDto, evaluation: { markerPosition: number; timingErrorMs: number; judgement: PerfectTimingJudgement; scoreDelta: number }, estimatedTapMs: number, actionType = "TAP", challengeIndex = timing.currentRoundIndex) {
    const now = new Date()
    const state = await tx.perfectTimingParticipantState.findUniqueOrThrow({ where: { matchParticipantId: participantId } })
    const counts = { perfectCount: state.perfectCount + (evaluation.judgement === "PERFECT" ? 1 : 0), greatCount: state.greatCount + (evaluation.judgement === "GREAT" ? 1 : 0), goodCount: state.goodCount + (evaluation.judgement === "GOOD" ? 1 : 0), missCount: state.missCount + (evaluation.judgement === "MISS" ? 1 : 0) }
    const action = await tx.perfectTimingAction.create({ data: { matchId: match.id, perfectTimingMatchId: timing.id, matchParticipantId: participantId, roundIndex: challengeIndex, sequence: dto.sequence, clientActionId: dto.clientActionId, actionType, accepted: true, judgement: evaluation.judgement, timingErrorMs: evaluation.timingErrorMs, scoreDelta: evaluation.scoreDelta, estimatedTapAtServerMs: BigInt(Math.round(estimatedTapMs)), payload: { markerPosition: evaluation.markerPosition, judgement: evaluation.judgement, timingErrorMs: evaluation.timingErrorMs, scoreDelta: evaluation.scoreDelta, challengeIndex } as Prisma.InputJsonValue, clientOccurredAt: this.dateOrUndefined(dto.clientOccurredAt) } })
    await tx.perfectTimingParticipantState.update({ where: { id: state.id }, data: { score: { increment: evaluation.scoreDelta }, ...counts, nextSequence: { increment: 1 }, lastTapAt: now } })
    await tx.perfectTimingMatch.update({ where: { id: timing.id }, data: { stateHash: this.stateHash(timing, { challengeIndex, participantId, sequence: dto.sequence, score: state.score + evaluation.scoreDelta }) } })
    await tx.matchParticipant.update({ where: { id: participantId }, data: { answeredCount: { increment: 1 }, lastActivityAt: now } })
    await tx.matchEvent.create({ data: { matchId: match.id, participantId, sequence: dto.sequence, eventType: "SCORE_UPDATE", clientEventId: dto.clientActionId, payload: { game: "perfect_timing", eventKind: actionType, challengeIndex, judgement: evaluation.judgement, timingErrorMs: evaluation.timingErrorMs, scoreDelta: evaluation.scoreDelta, markerPosition: evaluation.markerPosition, timeTakenMs: evaluation.timingErrorMs } as Prisma.InputJsonValue, accepted: true, clientOccurredAt: this.dateOrUndefined(dto.clientOccurredAt) } })
    return action
  }

  private async recordRejected(tx: Prisma.TransactionClient, match: MatchRow, timing: TimingRow, participantId: string, dto: PerfectTimingTapDto, reason: string, estimatedTapMs?: number, challengeIndex = timing.currentRoundIndex) {
    const action = await tx.perfectTimingAction.create({ data: { matchId: match.id, perfectTimingMatchId: timing.id, matchParticipantId: participantId, roundIndex: challengeIndex, sequence: dto.sequence, clientActionId: dto.clientActionId, actionType: "TAP", accepted: false, rejectionReason: reason, estimatedTapAtServerMs: estimatedTapMs == null ? undefined : BigInt(Math.round(estimatedTapMs)), payload: { reason, challengeIndex } as Prisma.InputJsonValue, clientOccurredAt: this.dateOrUndefined(dto.clientOccurredAt) } })
    await tx.perfectTimingParticipantState.update({ where: { matchParticipantId: participantId }, data: { nextSequence: { increment: 1 } } })
    await tx.perfectTimingMatch.update({ where: { id: timing.id }, data: { stateHash: this.stateHash(timing, { challengeIndex, participantId, sequence: dto.sequence, rejected: true, reason }) } })
    await tx.matchEvent.create({ data: { matchId: match.id, participantId, sequence: dto.sequence, eventType: "SCORE_UPDATE", clientEventId: dto.clientActionId, payload: { game: "perfect_timing", eventKind: "TAP_REJECTED", challengeIndex, reason, scoreDelta: 0 } as Prisma.InputJsonValue, accepted: false, rejectionReason: reason, clientOccurredAt: this.dateOrUndefined(dto.clientOccurredAt) } })
    return action
  }

  private async finish(tx: Prisma.TransactionClient, match: MatchRow, timing: TimingRow, forfeitingParticipantId: string | null, policy: PerfectTimingPolicy) {
    const states = await tx.perfectTimingParticipantState.findMany({ where: { perfectTimingMatchId: timing.id } })
    const highest = Math.max(...states.map((item: any) => item.score), 0)
    const winners = states.filter((item: any) => item.score === highest)
    const endedAt = new Date()
    const finishedStateHash = this.stateHash(timing, { currentRoundStatus: "COMPLETE", endedAt: endedAt.toISOString() })
    await tx.match.update({ where: { id: match.id }, data: { status: "FINISHED", endedAt } })
    await tx.perfectTimingMatch.update({ where: { id: timing.id }, data: { endedAt, currentRoundStatus: "COMPLETE", nextRoundAt: null, stateHash: finishedStateHash } })
    await tx.matchRound.updateMany({ where: { matchId: match.id, status: { in: ["CREATED", "STARTED"] } }, data: { status: "FINISHED", endedAt } })
    for (const participant of match.participants) {
      const state = states.find((item: any) => item.matchParticipantId === participant.id)
      const result: MatchParticipantResult = forfeitingParticipantId === participant.id ? "FORFEIT" : forfeitingParticipantId ? "LOSS" : winners.length !== 1 ? "DRAW" : state?.score === highest ? "WIN" : "LOSS"
      await tx.matchParticipant.update({ where: { id: participant.id }, data: { finalScore: state?.score ?? 0, result, submittedAt: endedAt } })
    }
    await tx.analyticsEvent.create({ data: { eventName: "PERFECT_TIMING_MATCH_FINISHED", occurredAt: endedAt, matchId: match.id, properties: { winnerParticipantIds: winners.map((item: any) => item.matchParticipantId), policyVersion: policy.policyVersion, challengeCount: timing.roundCount } as Prisma.InputJsonValue } })
  }

  private async settleFinishedMatch(matchId: string) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.lockMatch(tx, matchId)
        const match = await this.loadMatch(tx, matchId)
        if (match.status !== "FINISHED" || match.settlement) return match.settlement?.settlementJson ?? null
        const human = match.participants.find((item: any) => item.participantType === "PLAYER" && item.userId)
        if (!human?.userId) return null
        const settlement = await this.settleMatch.runWithinTransaction({ matchId, userId: human.userId, idempotencyKey: `perfect-timing-settle:${matchId}` }, tx)
        await tx.match.update({ where: { id: matchId }, data: { status: settlement?.status === "SETTLED" ? "SETTLED" : undefined } })
        return settlement
      })
    } catch { return null }
  }

  private async ensureState(tx: Prisma.TransactionClient, match: MatchRow, policy: PerfectTimingPolicy): Promise<TimingRow> {
    const existing = await tx.perfectTimingMatch.findUnique({ where: { matchId: match.id } })
    if (existing) {
      const participants = await tx.matchParticipant.findMany({ where: { matchId: match.id }, select: { id: true } })
      for (const participant of participants) await tx.perfectTimingParticipantState.upsert({ where: { matchParticipantId: participant.id }, create: { perfectTimingMatchId: existing.id, matchParticipantId: participant.id }, update: {} })
      return existing
    }
    const mode = String(match.mode) as PerfectTimingMode
    const schedule = createPerfectTimingSchedule(match.serverNonce, policy, mode === "PRACTICE" ? "PRACTICE" : mode === "RANKED" ? "RANKED" : "CASUAL")
    const commitment = perfectTimingScheduleCommitment(schedule, policy.rulesVersion, policy.policyVersion)
    const initial = { matchId: match.id, currentRoundIndex: 0, currentRoundStatus: "CREATED", scheduleCommitment: commitment }
    const created = await tx.perfectTimingMatch.create({ data: { matchId: match.id, seed: match.serverNonce, scheduleCommitment: commitment, rulesVersion: policy.rulesVersion, policyVersion: policy.policyVersion, roundCount: schedule.length, schedule: schedule as unknown as Prisma.InputJsonValue, roundResults: [], stateHash: perfectTimingStateHash(initial) } })
    const participants = await tx.matchParticipant.findMany({ where: { matchId: match.id }, select: { id: true } })
    for (const participant of participants) await tx.perfectTimingParticipantState.create({ data: { perfectTimingMatchId: created.id, matchParticipantId: participant.id } })
    return created
  }

  private async project(tx: Prisma.TransactionClient, match: MatchRow, timing: TimingRow, participantId: string, policy: PerfectTimingPolicy) {
    const states = await tx.perfectTimingParticipantState.findMany({ where: { perfectTimingMatchId: timing.id } })
    const self = states.find((item: any) => item.matchParticipantId === participantId)
    if (!self) throw new ConflictException("The Perfect Timing player state is unavailable")
    const actions = await tx.perfectTimingAction.findMany({ where: { matchId: match.id, accepted: true }, orderBy: { serverReceivedAt: "desc" }, take: Math.max(match.participants.length * 2, 10) })
    const latestActionByParticipant = new Map<string, any>()
    for (const action of actions) if (!latestActionByParticipant.has(action.matchParticipantId)) latestActionByParticipant.set(action.matchParticipantId, action)
    const challengeIndex = Math.min(Math.max(self.nextSequence - 1, 0), timing.roundCount - 1)
    const challenge = this.challengeAt(timing, challengeIndex)
    const challengeStartedAt = self.lastTapAt ?? timing.startedAt
    const finished = ["FINISHED", "REVIEW", "SETTLED"].includes(match.status)
    const participants = match.participants.map((item: any) => {
      const state = states.find((entry: any) => entry.matchParticipantId === item.id)
      const action = latestActionByParticipant.get(item.id)
      const publicAction = action ? this.actionProjection(action, state?.score ?? 0) : null
      return { participantId: item.id, userId: item.userId, participantType: item.participantType, name: item.user?.profile?.displayName ?? item.user?.username ?? "SMARTS bot", username: item.user?.username ?? null, avatarUrl: item.user?.profile?.avatarUrl ?? null, score: state?.score ?? 0, perfectCount: state?.perfectCount ?? 0, greatCount: state?.greatCount ?? 0, goodCount: state?.goodCount ?? 0, missCount: state?.missCount ?? 0, action: publicAction }
    })
    const startedAtMs = challengeStartedAt?.getTime() ?? null
    const remainingMilliseconds = timing.roundDeadlineAt ? Math.max(0, timing.roundDeadlineAt.getTime() - Date.now()) : 0
    const challengeProjection = { current: self.nextSequence, total: timing.roundCount, status: timing.currentRoundStatus, spec: challenge, startedAt: challengeStartedAt, deadlineAt: timing.roundDeadlineAt, remainingMilliseconds, markerPosition: startedAtMs == null ? null : markerPositionAt(challenge, Date.now(), startedAtMs), targetCenter: startedAtMs == null ? challenge.targetCenter : targetCenterAt(challenge, Date.now(), startedAtMs) }
    return {
      matchId: match.id,
      gameKey: "perfect_timing",
      status: match.status,
      mode: match.mode,
      rulesVersion: timing.rulesVersion,
      policyVersion: timing.policyVersion,
      scheduleCommitment: timing.scheduleCommitment,
      challenge: challengeProjection,
      // Keep the old key for older clients while they roll forward.
      round: challengeProjection,
      schedule: timing.schedule,
      roundResults: timing.roundResults,
      serverNow: new Date().toISOString(),
      serverNowMs: Date.now(),
      clock: { maxOffsetMs: policy.clockOffsetLimitMs, maxTapAgeMs: policy.maxTapAgeMs, maxTapLeadMs: policy.maxTapLeadMs },
      selfParticipantId: participantId,
      self: { score: self.score, perfectCount: self.perfectCount, greatCount: self.greatCount, goodCount: self.goodCount, missCount: self.missCount, nextSequence: self.nextSequence, action: latestActionByParticipant.has(participantId) ? this.actionProjection(latestActionByParticipant.get(participantId), self.score) : null },
      participants,
      result: finished ? { finalScores: participants.map((item: any) => ({ participantId: item.participantId, score: item.score })), practice: match.mode === "PRACTICE" } : null,
      stateHash: timing.stateHash,
    }
  }

  private actionProjection(action: any, totalScore: number) { return { accepted: action.accepted, sequence: action.sequence, roundIndex: action.roundIndex, judgement: action.judgement ?? undefined, timingErrorMs: action.timingErrorMs ?? undefined, scoreDelta: action.scoreDelta ?? 0, totalScore, reason: action.rejectionReason ?? undefined, actionType: action.actionType } }

  private challengeAt(timing: TimingRow, index: number): PerfectTimingRoundSpec {
    const schedule = timing.schedule as PerfectTimingRoundSpec[]
    return schedule[Math.max(0, Math.min(index, schedule.length - 1))]
  }

  private currentRound(timing: TimingRow): PerfectTimingRoundSpec { return this.challengeAt(timing, timing.currentRoundIndex) }

  private policy(match: MatchRow): PerfectTimingPolicy {
    const settings = match.gameConfig?.settings && typeof match.gameConfig.settings === "object" && !Array.isArray(match.gameConfig.settings) ? match.gameConfig.settings as Record<string, unknown> : {}
    return mergePerfectTimingPolicy(settings.perfectTimingPolicy ?? DEFAULT_PERFECT_TIMING_POLICY)
  }

  private estimateTapServerMs(dto: PerfectTimingTapDto, receivedAtMs: number, policy: PerfectTimingPolicy): number {
    let estimated = receivedAtMs
    if (dto.clientClockMs != null && dto.clientServerOffsetMs != null) estimated = dto.clientClockMs + Math.max(-policy.clockOffsetLimitMs, Math.min(policy.clockOffsetLimitMs, dto.clientServerOffsetMs))
    const minimum = receivedAtMs - policy.maxTapAgeMs
    const maximum = receivedAtMs + policy.maxTapLeadMs
    return Math.max(minimum, Math.min(maximum, estimated))
  }

  private async loadMatch(tx: Prisma.TransactionClient, matchId: string): Promise<MatchRow> {
    const match = await tx.match.findUnique({ where: { id: matchId }, include: { gameDefinition: true, gameConfig: true, settlement: true, participants: { include: { user: { include: { profile: true } } } } } })
    if (!match) throw new NotFoundException("Perfect Timing match not found")
    if (match.gameDefinition.key !== "perfect_timing") throw new BadRequestException("This is not a Perfect Timing match")
    return match
  }

  private authorize(match: MatchRow, userId: string) { const participant = match.participants.find((item: any) => item.userId === userId); if (!participant) throw new NotFoundException("Player is not a participant in this match"); return participant }
  private async lockMatch(tx: Prisma.TransactionClient, matchId: string) { await tx.$queryRaw`SELECT "id" FROM "Match" WHERE "id" = ${matchId} FOR UPDATE` }
  private jsonArray(value: unknown): any[] { return Array.isArray(value) ? value : [] }
  private dateOrUndefined(value?: string) { if (!value) return undefined; const date = new Date(value); return Number.isNaN(date.getTime()) ? undefined : date }
  private seedUnit(seed: string, index: number) { let hash = 2166136261; for (const char of `${seed}:${index}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619); return (hash >>> 0) / 0xffffffff }
  private stateHash(timing: TimingRow, patch: Record<string, unknown>) { return perfectTimingStateHash({ scheduleCommitment: timing.scheduleCommitment, currentRoundIndex: timing.currentRoundIndex, currentRoundStatus: timing.currentRoundStatus, roundResults: timing.roundResults, ...patch }) }
}
