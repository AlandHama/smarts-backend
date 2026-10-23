import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common"
import { MatchParticipantResult, Prisma } from "@prisma/client"
import { PrismaService } from "../../prisma.service"
import { SettleMatchTransaction } from "../matches/transactions/settle-match-transaction"
import { FraudService } from "../fraud/fraud.service"
import { BombPathCompleteDto, BombPathStepDto } from "./dtos/bomb-path.dto"
import { BombPathField, BombPathPoint, bombPathStateHash, findSafePath, generateBombPathField, scoreBombPathSuccess, validateBombPathStep } from "./engine/bomb-path-engine"
import { BombPathPolicy, BombPathRoundSpec, BombPathRoundStatus, DEFAULT_BOMB_PATH_POLICY, bombPathRoundSpec, mergeBombPathPolicy } from "./engine/bomb-path-score"

type MatchRow = any
type RuntimePlayer = { participantId: string; score: number; sequence: number; path: BombPathPoint[]; roundStatus: BombPathRoundStatus; roundScore: number; roundElapsedMs: number | null; nextBotAt?: number }
type RuntimeRound = { spec: BombPathRoundSpec; field: BombPathField; phase: "MEMORIZE" | "PLAY" | "RESULT" | "COMPLETE"; phaseStartedAt: number; memorizeEndsAt: number; playEndsAt: number; resultEndsAt: number | null; players: Record<string, { status: BombPathRoundStatus; path: BombPathPoint[]; score: number; elapsedMs: number | null; pathLength: number; reason?: string }> }
type BombPathState = { rulesVersion: string; generationVersion: string; policyVersion: number | null; seed: string; status: "ACTIVE" | "FINISHED"; phase: "MEMORIZE" | "PLAY" | "RESULT" | "COMPLETE"; currentRoundIndex: number; startedAt: string; endsAt: string; rounds: RuntimeRound[]; players: Record<string, RuntimePlayer>; replay: Array<Record<string, unknown>>; stateHash: string; winnerParticipantId?: string | null; settlement?: unknown }

const MAX_REPLAY_EVENTS = 300

@Injectable()
export class BombPathService {
  constructor(private readonly prisma: PrismaService, private readonly settleMatch: SettleMatchTransaction, private readonly fraud: FraudService) {}

  async snapshot(userId: string, matchId: string): Promise<any> {
    const result = await this.prisma.$transaction(async (tx) => {
      await this.lockMatch(tx, matchId)
      let match = await this.loadMatch(tx, matchId)
      const participant = this.authorize(match, userId)
      const policy = this.policy(match)
      let state = this.readState(match.metadata)
      let finalized = false
      if (state && state.status === "ACTIVE") {
        const replayBeforeBots = state.replay.length
        state = await this.advanceBots(tx, match, state, policy, Date.now())
        const advanced = this.advanceState(state, Date.now(), policy)
        state = advanced.state
        if (advanced.finished) {
          await this.finish(tx, match, state, null, policy)
          finalized = true
          match = await this.loadMatch(tx, matchId)
        } else if (advanced.changed || state.replay.length !== replayBeforeBots) {
          await this.saveState(tx, match, state)
        }
      }
      return { projection: this.project(match, participant.id, state, policy), finalized }
    })
    if (result.finalized) await this.settleFinishedMatch(matchId)
    return result.finalized ? this.snapshot(userId, matchId) : result.projection
  }

  async start(userId: string, matchId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockMatch(tx, matchId)
      const match = await this.loadMatch(tx, matchId)
      const participant = this.authorize(match, userId)
      if (!["CREATED", "STARTED"].includes(match.status)) throw new ConflictException("The Bomb Path match cannot be started")
      const policy = this.policy(match)
      await tx.matchParticipant.update({ where: { id: participant.id }, data: { readyAt: participant.readyAt ?? new Date(), lastActivityAt: new Date(), disconnectGraceUntil: null } })
      const readiness = await tx.matchParticipant.findMany({ where: { matchId }, select: { id: true, participantType: true, readyAt: true } })
      const readyCount = readiness.filter((item) => item.participantType === "BOT" || item.readyAt !== null).length
      let state = this.readState(match.metadata)
      if (readyCount < readiness.length && !state) return { ...this.project(match, participant.id, null, policy), waitingForPlayers: true, readyCount, requiredCount: readiness.length }
      const now = Date.now()
      state ??= this.newState(match, readiness.map((item) => item.id), policy, now)
      await tx.match.update({ where: { id: matchId }, data: { status: "STARTED", startedAt: match.startedAt ?? new Date(now), metadata: this.metadata(match.metadata, state) } })
      await tx.matchRound.updateMany({ where: { matchId, status: "CREATED" }, data: { status: "STARTED", startedAt: new Date(now) } })
      await tx.analyticsEvent.create({ data: { eventName: "BOMB_PATH_MATCH_STARTED", occurredAt: new Date(now), matchId, playerId: participant.userId ?? undefined, properties: { rulesVersion: state.rulesVersion, generationVersion: state.generationVersion, policyVersion: state.policyVersion, roundCount: state.rounds.length, mode: match.mode } as Prisma.InputJsonValue } })
      return this.project({ ...match, status: "STARTED", startedAt: match.startedAt ?? new Date(now), metadata: this.metadata(match.metadata, state) }, participant.id, state, policy)
    })
  }

  async step(userId: string, matchId: string, dto: BombPathStepDto) {
    const result = await this.action(userId, matchId, dto, false)
    if (result.finalized) return this.snapshot(userId, matchId)
    return result.response
  }

  async complete(userId: string, matchId: string, dto: BombPathCompleteDto) {
    const result = await this.prisma.$transaction(async (tx) => {
      await this.lockMatch(tx, matchId)
      const match = await this.loadMatch(tx, matchId)
      const participant = this.authorize(match, userId)
      const policy = this.policy(match)
      let state = this.readState(match.metadata)
      if (!state) throw new ConflictException("The Bomb Path match is waiting for all players")
      const advanced = this.advanceState(state, Date.now(), policy); state = advanced.state
      if (advanced.finished) { await this.finish(tx, match, state, null, policy); return { finalized: true, response: null } }
      const player = state.players[participant.id]
      if (!player || state.currentRoundIndex !== dto.roundIndex) throw new ConflictException("The Bomb Path round is no longer active")
      if (dto.sequence !== player.sequence + 1) throw new ConflictException("Step sequence is out of date; reconcile the match")
      if (player.roundStatus === "PLAYING") {
        player.roundStatus = "INCOMPLETE"; player.roundElapsedMs = Math.max(0, Date.now() - state.rounds[state.currentRoundIndex].phaseStartedAt)
        state.rounds[state.currentRoundIndex].players[participant.id].status = "INCOMPLETE"; player.sequence = dto.sequence
      }
      state.replay = [...state.replay, { participantId: participant.id, sequence: dto.sequence, kind: "COMPLETE", roundIndex: dto.roundIndex, acceptedAt: new Date().toISOString() }].slice(-MAX_REPLAY_EVENTS)
      await this.persistEvent(tx, match, participant.id, dto.sequence, dto.clientActionId, "BOMB_PATH_COMPLETE", true, { roundIndex: dto.roundIndex, status: player.roundStatus }, dto.clientOccurredAt)
      const finished = this.advanceState(state, Date.now(), policy)
      if (finished.finished) { await this.finish(tx, match, finished.state, null, policy); return { finalized: true, response: null } }
      await this.saveState(tx, match, finished.state)
      return { finalized: false, response: { ...this.project(match, participant.id, finished.state, policy), action: { accepted: true, outcome: player.roundStatus, sequence: dto.sequence } } }
    })
    if (result.finalized) { await this.settleFinishedMatch(matchId); return this.snapshot(userId, matchId) }
    return result.response
  }

  async forfeit(userId: string, matchId: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      await this.lockMatch(tx, matchId)
      const match = await this.loadMatch(tx, matchId)
      const participant = this.authorize(match, userId)
      const policy = this.policy(match)
      const state = this.readState(match.metadata)
      if (!state || state.status === "FINISHED" || ["FINISHED", "SETTLED"].includes(match.status)) return { finalized: false, projection: this.project(match, participant.id, state, policy) }
      await this.finish(tx, match, state, participant.id, policy)
      return { finalized: true, projection: null }
    })
    if (result.finalized) { await this.settleFinishedMatch(matchId); return this.snapshot(userId, matchId) }
    return result.projection
  }

  async clock() { return { serverNow: new Date().toISOString(), serverNowMs: Date.now(), protocol: 1 } }

  async finalizeExpiredMatches() {
    const active = await this.prisma.match.findMany({ where: { gameDefinition: { key: "bomb_path" }, status: "STARTED" }, select: { id: true, participants: { where: { participantType: "PLAYER", userId: { not: null } }, select: { userId: true }, take: 1 } }, orderBy: { startedAt: "asc" }, take: 100 })
    let finalized = 0
    for (const match of active) if (match.participants[0]?.userId) try { const snapshot = await this.snapshot(match.participants[0].userId, match.id); if (["FINISHED", "SETTLED"].includes(snapshot.status)) finalized += 1 } catch { /* another worker owns this row */ }
    return { finalized }
  }

  async retryPendingSettlements() {
    const pending = await this.prisma.match.findMany({ where: { gameDefinition: { key: "bomb_path" }, status: { in: ["FINISHED", "REVIEW"] }, settlement: null }, select: { id: true, participants: { where: { participantType: "PLAYER", userId: { not: null } }, select: { userId: true }, take: 1 } }, orderBy: { endedAt: "asc" }, take: 100 })
    let settled = 0
    for (const match of pending) if (match.participants[0]?.userId) { const result = await this.settleFinishedMatch(match.id); if (result && (result as any).status === "SETTLED") settled += 1 }
    return { settled }
  }

  async retrySettlement(matchId: string) {
    const match = await this.prisma.match.findFirst({ where: { id: matchId, gameDefinition: { key: "bomb_path" } }, select: { id: true, status: true } })
    if (!match) throw new NotFoundException("Bomb Path match not found")
    if (!["FINISHED", "REVIEW", "SETTLED"].includes(match.status)) throw new ConflictException("Only finished Bomb Path matches can be settled")
    if (match.status !== "SETTLED") await this.settleFinishedMatch(matchId, true)
    return this.prisma.matchSettlement.findUnique({ where: { matchId } })
  }

  private async action(userId: string, matchId: string, dto: BombPathStepDto, bot: boolean) {
    const result = await this.prisma.$transaction(async (tx) => {
      await this.lockMatch(tx, matchId)
      const match = await this.loadMatch(tx, matchId)
      const participant = this.authorize(match, userId)
      const policy = this.policy(match)
      let state = this.readState(match.metadata)
      if (!state) throw new ConflictException("The Bomb Path match is waiting for all players")
      const duplicate = await tx.matchEvent.findFirst({ where: { matchId, participantId: participant.id, clientEventId: dto.clientActionId }, select: { accepted: true, payload: true, sequence: true } })
      if (duplicate) return { finalized: false, response: { ...this.project(match, participant.id, state, policy), action: duplicate.payload } }
      const lifecycle = this.advanceState(state, Date.now(), policy); state = lifecycle.state
      if (lifecycle.finished) { await this.finish(tx, match, state, null, policy); return { finalized: true, response: null } }
      const player = state.players[participant.id]
      const round = state.rounds[state.currentRoundIndex]
      if (!player || !round || state.phase !== "PLAY" || dto.roundIndex !== state.currentRoundIndex || player.roundStatus !== "PLAYING") throw new ConflictException("The Bomb Path play phase is not active")
      if (dto.sequence !== player.sequence + 1) throw new ConflictException("Step sequence is out of date; reconcile the match")
      const checked = validateBombPathStep(round.field, player.path, { row: dto.cell.row, column: dto.cell.column }, policy.orthogonalOnly)
      player.sequence = dto.sequence
      if (!checked.accepted) {
        player.sequence = dto.sequence
        state.stateHash = bombPathStateHash(state)
        await this.persistEvent(tx, match, participant.id, dto.sequence, dto.clientActionId, "BOMB_PATH_STEP", false, { accepted: false, reason: checked.reason, roundIndex: dto.roundIndex }, dto.clientOccurredAt, checked.reason)
        await this.saveState(tx, match, state)
        void this.fraud.observe(userId, { type: "REPEATED_INVALID_EVENTS", sourceType: "BOMB_PATH", sourceId: matchId + ":" + dto.clientActionId, metadata: { matchId, sequence: dto.sequence, reason: checked.reason } }).catch(() => undefined)
        return { finalized: false, response: { ...this.project(match, participant.id, state, policy), action: { accepted: false, outcome: "INVALID", sequence: dto.sequence, reason: checked.reason } } }
      }
      player.path = checked.path
      const roundPlayer = round.players[participant.id]; roundPlayer.path = checked.path
      let scoreDelta = 0
      if (checked.outcome === "BOMB") { player.roundStatus = "BOMB_HIT"; roundPlayer.status = "BOMB_HIT"; roundPlayer.reason = "BOMB"; player.roundScore = 0 }
      else if (checked.outcome === "SUCCESS") {
        player.roundElapsedMs = Math.max(0, Date.now() - round.phaseStartedAt)
        const score = scoreBombPathSuccess("SUCCESS", player.roundElapsedMs, checked.path.length, round.field, round.spec, policy)
        scoreDelta = score.total; player.roundStatus = "SUCCESS"; player.roundScore = scoreDelta; player.score += scoreDelta
        roundPlayer.status = "SUCCESS"; roundPlayer.score = scoreDelta; roundPlayer.elapsedMs = player.roundElapsedMs; roundPlayer.pathLength = checked.path.length
      } else { player.roundStatus = "PLAYING"; roundPlayer.status = "PLAYING" }
      state.replay = [...state.replay, { participantId: participant.id, sequence: dto.sequence, roundIndex: dto.roundIndex, cell: dto.cell, outcome: checked.outcome, scoreDelta, acceptedAt: new Date().toISOString(), bot }].slice(-MAX_REPLAY_EVENTS)
      state.stateHash = bombPathStateHash(state)
      const payload = { accepted: true, outcome: checked.outcome, sequence: dto.sequence, roundIndex: dto.roundIndex, scoreDelta, totalScore: player.score, path: player.path, stateHash: state.stateHash }
      await this.persistEvent(tx, match, participant.id, dto.sequence, dto.clientActionId, "BOMB_PATH_STEP", true, payload, dto.clientOccurredAt)
      const advanced = this.advanceState(state, Date.now(), policy)
      if (advanced.finished) { await this.finish(tx, match, advanced.state, null, policy); return { finalized: true, response: null } }
      await this.saveState(tx, match, advanced.state)
      return { finalized: false, response: { ...this.project(match, participant.id, advanced.state, policy), action: payload } }
    })
    return result
  }

  private newState(match: MatchRow, participantIds: string[], policy: BombPathPolicy, now: number): BombPathState {
    const rounds: RuntimeRound[] = []
    let cursor = now
    for (let index = 0; index < policy.roundCount; index += 1) {
      const spec = bombPathRoundSpec(policy, index); const field = generateBombPathField(match.serverNonce, spec)
      const round: RuntimeRound = { spec, field, phase: "MEMORIZE", phaseStartedAt: cursor, memorizeEndsAt: cursor + spec.memorizeDurationMs, playEndsAt: cursor + spec.memorizeDurationMs + spec.playDurationMs, resultEndsAt: null, players: {} }
      for (const participantId of participantIds) round.players[participantId] = { status: "READY", path: [], score: 0, elapsedMs: null, pathLength: 0 }
      rounds.push(round); cursor += spec.memorizeDurationMs + spec.playDurationMs + spec.resultDurationMs
    }
    const players: Record<string, RuntimePlayer> = {}
    for (const participantId of participantIds) players[participantId] = { participantId, score: 0, sequence: 0, path: [], roundStatus: "READY", roundScore: 0, roundElapsedMs: null }
    const state: BombPathState = { rulesVersion: policy.rulesVersion, generationVersion: policy.generationVersion, policyVersion: match.gameConfig?.version ?? null, seed: match.serverNonce, status: "ACTIVE", phase: "MEMORIZE", currentRoundIndex: 0, startedAt: new Date(now).toISOString(), endsAt: new Date(now + policy.matchDurationSeconds * 1000).toISOString(), rounds, players, replay: [], stateHash: "" }
    state.stateHash = bombPathStateHash(state); return state
  }

  private advanceState(state: BombPathState, now: number, policy: BombPathPolicy): { state: BombPathState; changed: boolean; finished: boolean } {
    if (state.status === "FINISHED") return { state, changed: false, finished: true }
    let changed = false
    if (now >= Date.parse(state.endsAt)) return { state: this.timeoutState(state), changed: true, finished: true }
    let guard = policy.roundCount + 3
    while (guard-- > 0) {
      const round = state.rounds[state.currentRoundIndex]
      if (!round) return { state: this.timeoutState(state), changed: true, finished: true }
      if (state.phase === "MEMORIZE" && now >= round.memorizeEndsAt) { state.phase = "PLAY"; round.phase = "PLAY"; round.phaseStartedAt = round.memorizeEndsAt; state.players = this.mapPlayers(state.players, (player) => ({ ...player, roundStatus: "PLAYING", path: [], roundScore: 0, roundElapsedMs: null })); changed = true; continue }
      if (state.phase === "PLAY") {
        const someoneFinished = Object.values(round.players).some((player) => ["SUCCESS", "BOMB_HIT", "TIMEOUT", "INCOMPLETE", "ABANDONED"].includes(player.status))
        const playExpired = now >= round.playEndsAt
        if (someoneFinished || playExpired) {
          // A player who resolves the route has finished this challenge. Do
          // not hold that player at the result screen while the opponent is
          // still thinking; advance the shared challenge immediately. Any
          // player who was still moving is recorded as incomplete for this
          // round and can continue from the next field.
          const unresolvedStatus: BombPathRoundStatus = someoneFinished ? "INCOMPLETE" : "TIMEOUT"
          for (const player of Object.values(round.players)) {
            if (player.status === "PLAYING" || player.status === "READY") {
              player.status = unresolvedStatus
              player.reason ??= unresolvedStatus
            }
          }
          state.players = this.mapPlayers(state.players, (player) => player.roundStatus === "PLAYING" || player.roundStatus === "READY" ? { ...player, roundStatus: unresolvedStatus, roundElapsedMs: Math.max(0, Math.min(now, round.playEndsAt) - round.phaseStartedAt) } : player)
          state.phase = "RESULT"; round.phase = "RESULT"; round.resultEndsAt = someoneFinished ? now : Math.max(now, round.playEndsAt) + round.spec.resultDurationMs; changed = true; continue
        }
      }
      if (state.phase === "RESULT" && round.resultEndsAt !== null && now >= round.resultEndsAt) {
        round.phase = "COMPLETE"
        if (state.currentRoundIndex >= state.rounds.length - 1) return { state: this.timeoutState(state), changed: true, finished: true }
        state.currentRoundIndex += 1; state.phase = "MEMORIZE"
        const next = state.rounds[state.currentRoundIndex]; next.phase = "MEMORIZE"; next.phaseStartedAt = round.resultEndsAt; next.memorizeEndsAt = next.phaseStartedAt + next.spec.memorizeDurationMs; next.playEndsAt = next.memorizeEndsAt + next.spec.playDurationMs
        state.players = this.mapPlayers(state.players, (player) => ({ ...player, roundStatus: "READY", path: [], roundScore: 0, roundElapsedMs: null })); changed = true; continue
      }
      break
    }
    state.stateHash = bombPathStateHash(state); return { state, changed, finished: false }
  }

  private timeoutState(state: BombPathState) { const rounds = state.rounds.map((round, index) => index === state.currentRoundIndex ? { ...round, phase: "COMPLETE" as const, players: Object.fromEntries(Object.entries(round.players).map(([id, player]) => [id, player.status === "PLAYING" || player.status === "READY" ? { ...player, status: "TIMEOUT" as const } : player])) } : round); const finished = { ...state, status: "FINISHED" as const, phase: "COMPLETE" as const, rounds, players: this.mapPlayers(state.players, (player) => player.roundStatus === "PLAYING" || player.roundStatus === "READY" ? { ...player, roundStatus: "TIMEOUT" } : player) }; return { ...finished, winnerParticipantId: this.winner(finished), stateHash: bombPathStateHash(finished) } }
  private winner(state: BombPathState) { const scores = Object.values(state.players).map((player) => player.score); const max = Math.max(...scores, 0); const winners = Object.values(state.players).filter((player) => player.score === max); return winners.length === 1 ? winners[0].participantId : null }
  private mapPlayers(players: Record<string, RuntimePlayer>, map: (player: RuntimePlayer) => RuntimePlayer) { return Object.fromEntries(Object.entries(players).map(([id, player]) => [id, map(player)])) }

  private async advanceBots(tx: Prisma.TransactionClient, match: MatchRow, state: BombPathState, policy: BombPathPolicy, now: number) {
    const bot = match.participants.find((item: any) => item.participantType === "BOT")
    if (!bot || !policy.bot.enabled || state.status === "FINISHED") return state
    const player = state.players[bot.id]; const round = state.rounds[state.currentRoundIndex]
    if (!player || !round || state.phase !== "PLAY" || player.roundStatus !== "PLAYING") return state
    let due = player.nextBotAt ?? round.phaseStartedAt + policy.bot.reactionDelayMs
    if (now < due) return state
    let moves = 0
    while (moves < 8) {
    const safe = findSafePath(round.field); const target = safe[player.path.length] ?? round.field.trophy
    const dto: BombPathStepDto = { sequence: player.sequence + 1, roundIndex: state.currentRoundIndex, cell: target, clientActionId: "bot:" + match.id + ":" + state.currentRoundIndex + ":" + (player.sequence + 1) }
    if (policy.bot.errorRate > 0 && player.path.length > 1 && this.unit(match.serverNonce + ":bot", player.sequence) < policy.bot.errorRate) {
      const last = player.path[player.path.length - 1]; const bomb = round.field.bombs.find((candidate) => Math.abs(candidate.row - last.row) + Math.abs(candidate.column - last.column) === 1); if (bomb) dto.cell = bomb
    }
    const checked = validateBombPathStep(round.field, player.path, dto.cell, policy.orthogonalOnly)
    player.sequence = dto.sequence; player.nextBotAt = due + policy.bot.stepDelayMs + Math.round(this.unit(match.serverNonce + ":jitter", player.sequence) * policy.bot.jitterMs); due = player.nextBotAt; player.path = checked.path; round.players[bot.id].path = checked.path
    if (checked.outcome === "BOMB") { player.roundStatus = "BOMB_HIT"; round.players[bot.id].status = "BOMB_HIT" }
    else if (checked.outcome === "SUCCESS") { player.roundStatus = "SUCCESS"; round.players[bot.id].status = "SUCCESS"; player.roundElapsedMs = now - round.phaseStartedAt; const score = scoreBombPathSuccess("SUCCESS", player.roundElapsedMs, checked.path.length, round.field, round.spec, policy); player.roundScore = score.total; player.score += score.total; round.players[bot.id].score = score.total; round.players[bot.id].elapsedMs = player.roundElapsedMs }
    state.replay = [...state.replay, { participantId: bot.id, sequence: dto.sequence, roundIndex: dto.roundIndex, cell: dto.cell, outcome: checked.outcome, bot: true, acceptedAt: new Date().toISOString() }].slice(-MAX_REPLAY_EVENTS)
    await this.persistEvent(tx, match, bot.id, dto.sequence, dto.clientActionId, "BOMB_PATH_STEP", true, { accepted: true, outcome: checked.outcome, sequence: dto.sequence, roundIndex: dto.roundIndex, bot: true, scoreDelta: player.roundScore })
    moves += 1
    if (player.roundStatus !== "PLAYING" || state.phase !== "PLAY" || !player.nextBotAt || player.nextBotAt > now) return state
    }
    return state
  }

  private async finish(tx: Prisma.TransactionClient, match: MatchRow, state: BombPathState, forfeitingParticipantId: string | null, policy: BombPathPolicy) {
    const finished = this.timeoutState(state)
    if (forfeitingParticipantId) { finished.players[forfeitingParticipantId].roundStatus = "ABANDONED"; finished.winnerParticipantId = Object.keys(finished.players).find((id) => id !== forfeitingParticipantId) ?? null }
    const endedAt = new Date()
    await tx.match.update({ where: { id: match.id }, data: { status: "FINISHED", endedAt, metadata: this.metadata(match.metadata, finished) } })
    await tx.matchRound.updateMany({ where: { matchId: match.id, status: { in: ["CREATED", "STARTED"] } }, data: { status: "FINISHED", endedAt } })
    for (const item of match.participants) { const score = finished.players[item.id]?.score ?? 0; const result: MatchParticipantResult = forfeitingParticipantId === item.id ? "FORFEIT" : forfeitingParticipantId ? "WIN" : finished.winnerParticipantId === null ? "DRAW" : finished.winnerParticipantId === item.id ? "WIN" : "LOSS"; await tx.matchParticipant.update({ where: { id: item.id }, data: { finalScore: score, result, submittedAt: endedAt, lastActivityAt: endedAt, disconnectGraceUntil: null, terminationReason: forfeitingParticipantId === item.id ? "VOLUNTARY_FORFEIT" : null } }); await this.persistEvent(tx, match, item.id, 0, "bomb-path:terminal:" + item.id, "BOMB_PATH_TERMINAL", true, { accepted: true, outcome: "MATCH_FINISHED", totalScore: score }) }
    await tx.analyticsEvent.create({ data: { eventName: "BOMB_PATH_MATCH_FINISHED", occurredAt: endedAt, matchId: match.id, properties: { winnerParticipantId: finished.winnerParticipantId, scores: Object.values(finished.players).map((player) => ({ participantId: player.participantId, score: player.score })), rulesVersion: policy.rulesVersion, policyVersion: policy.policyVersion, replayLength: finished.replay.length } as Prisma.InputJsonValue } })
  }

  private async settleFinishedMatch(matchId: string, allowReview = false) {
    try { return await this.prisma.$transaction(async (tx) => { await this.lockMatch(tx, matchId); const match = await this.loadMatch(tx, matchId); if (match.settlement || (match.status !== "FINISHED" && !(allowReview && match.status === "REVIEW"))) return null; const human = match.participants.find((item: any) => item.participantType === "PLAYER" && item.userId); if (!human?.userId) return null; const settlement = await this.settleMatch.runWithinTransaction({ matchId, userId: human.userId, idempotencyKey: "bomb-path-settle:" + matchId }, tx); if (settlement?.status === "SETTLED") await tx.match.update({ where: { id: matchId }, data: { status: "SETTLED" } }); return settlement }) } catch { return null }
  }

  private async persistEvent(tx: Prisma.TransactionClient, match: MatchRow, participantId: string, sequence: number, clientEventId: string, eventType: string, accepted: boolean, payload: Record<string, unknown>, occurredAt?: string, rejectionReason?: string) {
    const roundId = match.rounds?.find((round: any) => round.status === "STARTED")?.id ?? match.rounds?.[0]?.id
    await tx.matchEvent.create({ data: { matchId: match.id, participantId, roundId, sequence, eventType: "SCORE_UPDATE", clientEventId, accepted, rejectionReason, payload: { game: "bomb_path", eventType, ...payload } as Prisma.InputJsonValue, clientOccurredAt: occurredAt && !Number.isNaN(Date.parse(occurredAt)) ? new Date(occurredAt) : undefined } })
    if (accepted) await tx.matchParticipant.update({ where: { id: participantId }, data: { lastActivityAt: new Date() } })
  }

  private async saveState(tx: Prisma.TransactionClient, match: MatchRow, state: BombPathState) { state.stateHash = bombPathStateHash(state); await tx.match.update({ where: { id: match.id }, data: { metadata: this.metadata(match.metadata, state) } }) }
  private project(match: MatchRow, participantId: string, state: BombPathState | null, policy: BombPathPolicy) {
    const current = state?.rounds[state.currentRoundIndex]; const self = state?.players[participantId]; const finished = ["FINISHED", "REVIEW", "SETTLED"].includes(match.status) || state?.status === "FINISHED"
    const phaseDeadlineMs = current ? (state?.phase === "MEMORIZE" ? current.memorizeEndsAt : state?.phase === "PLAY" ? current.playEndsAt : current.resultEndsAt ?? current.playEndsAt) : null
    const participantProjection = match.participants.map((item: any) => { const player = state?.players[item.id]; return { participantId: item.id, userId: item.userId, participantType: item.participantType, name: item.user?.profile?.displayName ?? item.user?.username ?? "SMARTS bot", username: item.user?.username ?? null, avatarUrl: item.user?.profile?.avatarUrl ?? null, score: player?.score ?? item.finalScore ?? 0, roundStatus: player?.roundStatus ?? "READY", result: item.result } })
    const field = current ? { roundIndex: current.spec.roundIndex, gridSize: current.spec.gridSize, flag: current.field.flag, trophy: current.field.trophy, bombs: state?.phase === "MEMORIZE" ? current.field.bombs : [], commitment: current.field.commitment, fieldCommitment: current.field.commitment } : null
    return { matchId: match.id, gameKey: "bomb_path", status: state?.status === "FINISHED" ? match.status === "SETTLED" ? "SETTLED" : "FINISHED" : match.status, mode: match.mode, rulesVersion: state?.rulesVersion ?? policy.rulesVersion, generationVersion: state?.generationVersion ?? policy.generationVersion, policyVersion: state?.policyVersion ?? match.gameConfig?.version ?? null, selfParticipantId: participantId, currentRoundIndex: state?.currentRoundIndex ?? 0, phase: state?.phase ?? "WAITING", roundCount: state?.rounds.length ?? policy.roundCount, serverNow: new Date().toISOString(), serverNowMs: Date.now(), phaseStartedAt: current ? new Date(current.phaseStartedAt).toISOString() : null, phaseDeadlineAt: phaseDeadlineMs === null ? null : new Date(phaseDeadlineMs).toISOString(), remainingMilliseconds: phaseDeadlineMs === null ? 0 : Math.max(0, phaseDeadlineMs - Date.now()), matchEndsAt: state?.endsAt ?? null, field, round: current ? { current: current.spec.roundIndex, total: state?.rounds.length ?? policy.roundCount, phase: state?.phase ?? "WAITING", gridSize: current.spec.gridSize, flag: current.field.flag, trophy: current.field.trophy, bombs: field?.bombs ?? [], fieldCommitment: current.field.commitment, phaseDeadlineAt: phaseDeadlineMs === null ? null : new Date(phaseDeadlineMs).toISOString(), remainingMilliseconds: phaseDeadlineMs === null ? 0 : Math.max(0, phaseDeadlineMs - Date.now()) } : null, self: self ? { participantId, score: self.score, sequence: self.sequence, path: self.path, roundStatus: self.roundStatus, roundScore: self.roundScore, roundElapsedMs: self.roundElapsedMs } : null, players: participantProjection, participants: participantProjection, winnerParticipantId: state?.winnerParticipantId ?? null, replayLength: state?.replay.length ?? 0, result: finished ? { finalScores: participantProjection.map((item: any) => ({ participantId: item.participantId, score: state?.players[item.participantId]?.score ?? item.score, result: item.result })), practice: match.mode === "PRACTICE" } : null, stateHash: state?.stateHash ?? null, policy: { roundCount: policy.roundCount, gridSizeEarly: policy.gridSizeEarly, gridSizeLate: policy.gridSizeLate, bombCountEarly: policy.bombCountEarly, bombCountLate: policy.bombCountLate, memorizeDurationMs: policy.memorizeDurationMs, playDurationMs: policy.playDurationMs, orthogonalOnly: policy.orthogonalOnly } }
  }

  private policy(match: MatchRow): BombPathPolicy { const settings = match.gameConfig?.settings && typeof match.gameConfig.settings === "object" && !Array.isArray(match.gameConfig.settings) ? match.gameConfig.settings as Record<string, unknown> : {}; return mergeBombPathPolicy(settings.bombPathPolicy ?? DEFAULT_BOMB_PATH_POLICY) }
  private readState(metadata: unknown): BombPathState | null { if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null; const state = (metadata as Record<string, unknown>).bombPath; return state && typeof state === "object" ? state as BombPathState : null }
  private metadata(metadata: unknown, state: BombPathState): Prisma.InputJsonValue { const base = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata as Record<string, unknown> : {}; return { ...base, bombPath: state } as unknown as Prisma.InputJsonValue }
  private async loadMatch(tx: Prisma.TransactionClient, matchId: string) { const match = await tx.match.findUnique({ where: { id: matchId }, include: { gameDefinition: true, gameConfig: true, settlement: true, rounds: { orderBy: { roundIndex: "desc" }, take: 5 }, participants: { include: { user: { include: { profile: true } } } } } }); if (!match) throw new NotFoundException("Bomb Path match not found"); if (match.gameDefinition.key !== "bomb_path") throw new BadRequestException("This is not a Bomb Path match"); return match }
  private authorize(match: MatchRow, userId: string) { const participant = match.participants.find((item: any) => item.userId === userId); if (!participant) throw new NotFoundException("Player is not a participant in this match"); return participant }
  private async lockMatch(tx: Prisma.TransactionClient, matchId: string) { await tx.$executeRawUnsafe('SELECT "id" FROM "Match" WHERE "id" = $1 FOR UPDATE', matchId) }
  private unit(seed: string, index: number) { let value = 2166136261; for (const char of seed + ":" + index) value = Math.imul(value ^ char.charCodeAt(0), 16777619); return (value >>> 0) / 0xffffffff }
}
