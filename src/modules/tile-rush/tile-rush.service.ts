import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common"
import { MatchParticipantResult, Prisma } from "@prisma/client"
import { PrismaService } from "../../prisma.service"
import { SettleMatchTransaction } from "../matches/transactions/settle-match-transaction"
import { FraudService } from "../fraud/fraud.service"
import { TileRushActionDto } from "./dtos/tile-rush.dto"
import { TileRushActionResult, TileRushEngine, TileRushPlayerState, TileRushPolicy, TileRushPoint, TileRushSpecial } from "./engine/tile-rush-engine"

const DEFAULT_POLICY: TileRushPolicy & Record<string, any> = {
  enabled: true,
  visibleName: "Tile Rush",
  description: "Connect. Clear. Rush.",
  boardSize: 7,
  tileTypes: 5,
  durationSeconds: 60,
  minimumChain: 3,
  rulesVersion: "tile-rush.v1",
  connectionMode: "ORTHOGONAL",
  comboWindowMs: 2000,
  maxComboBonus: 0.2,
  finalRushSeconds: 10,
  finalRushMultiplier: 1.1,
  special5Threshold: 5,
  special7Threshold: 7,
  prismThreshold: 10,
  loopsEnabled: true,
  loopMinimumLength: 4,
  casualEnabled: true,
  rankedEnabled: true,
  rankedBotFallback: false,
  scoreCap: 250000,
  maxActionsPerSecond: 8,
  bot: { enabled: true, reactionDelayMs: 1700, jitterMs: 900, skill: 0.32, maxActions: 32, errorRate: 0.28 },
  scoring: { scoreCap: 250000, cascadeMultipliers: [0.5, 0.65, 0.8, 1], refillCascadeLimit: 6, specialBonuses: {} },
}

const MAX_REPLAY_EVENTS = 160
type RuntimePlayer = TileRushPlayerState & { sequence: number; nextBotAt?: number }
type TileRushState = {
  rulesVersion: string
  policyVersion: number | null
  seed: number
  boardSize: number
  tileTypes: number
  durationSeconds: number
  startedAt: string
  endsAt: string
  status: "ACTIVE" | "FINISHED"
  players: Record<string, RuntimePlayer>
  replay: Array<Record<string, unknown>>
  winnerParticipantId?: string | null
  policy?: Record<string, any>
  settlement?: any
}

@Injectable()
export class TileRushService {
  constructor(private readonly prisma: PrismaService, private readonly settleMatch: SettleMatchTransaction, private readonly fraud: FraudService) {}

  async snapshot(userId: string, matchId: string): Promise<any> {
    const result = await this.prisma.$transaction(async (tx) => {
      await this.lockMatch(tx, matchId)
      const match = await this.loadMatch(tx, matchId)
      const participant = this.authorize(match, userId)
      let state = this.readState(match.metadata)
      let finalized = false
      const repaired = this.repairState(state, match)
      state = repaired.state
      if (repaired.changed && state) await tx.match.update({ where: { id: matchId }, data: { metadata: this.withState(match.metadata, state) } })
      if (state?.status === "ACTIVE") {
        state = await this.advanceBots(tx, match, state, Date.now())
        if (Date.now() >= Date.parse(state.endsAt)) {
          state = await this.finish(tx, match, state, null)
          finalized = true
        }
      }
      return { projection: this.project(match, participant.id, state), finalized }
    })
    if (result.finalized) {
      await this.settleFinishedMatch(matchId)
      return this.snapshot(userId, matchId)
    }
    return result.projection
  }

  async start(userId: string, matchId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockMatch(tx, matchId)
      const match = await this.loadMatch(tx, matchId)
      const participant = this.authorize(match, userId)
      if (match.status !== "CREATED" && match.status !== "STARTED") throw new ConflictException("The match cannot be started")
      const now = new Date()
      await tx.matchParticipant.update({ where: { id: participant.id }, data: { readyAt: participant.readyAt ?? now } })
      const readiness = await tx.matchParticipant.findMany({ where: { matchId }, select: { id: true, participantType: true, readyAt: true } })
      const ready = readiness.filter((item) => item.participantType === "BOT" || item.readyAt !== null)
      const existingResult = this.repairState(this.readState(match.metadata), match)
      const existing = existingResult.state
      if (existingResult.changed && existing) await tx.match.update({ where: { id: matchId }, data: { metadata: this.withState(match.metadata, existing) } })
      if (ready.length < readiness.length && !existing) return { ...this.project(match, participant.id, null), waitingForPlayers: true, readyCount: ready.length, requiredCount: readiness.length }
      const state = existing ?? this.newState(match, readiness.map((item) => item.id), now)
      const metadata = this.withState(match.metadata, state)
      await tx.match.update({ where: { id: matchId }, data: { status: "STARTED", startedAt: match.startedAt ?? now, metadata } })
      await tx.matchRound.updateMany({ where: { matchId, status: "CREATED" }, data: { status: "STARTED", startedAt: now } })
      await tx.analyticsEvent.create({ data: { eventName: "TILE_RUSH_MATCH_STARTED", occurredAt: now, matchId, playerId: participant.userId ?? undefined, properties: { rulesVersion: state.rulesVersion, boardSize: state.boardSize, tileTypes: state.tileTypes, durationSeconds: state.durationSeconds, mode: match.mode, policyVersion: state.policyVersion } as Prisma.InputJsonValue } })
      return this.project({ ...match, status: "STARTED", startedAt: match.startedAt ?? now, metadata }, participant.id, state)
    })
  }

  async action(userId: string, matchId: string, dto: TileRushActionDto) {
    const response = await this.prisma.$transaction(async (tx) => {
      await this.lockMatch(tx, matchId)
      const match = await this.loadMatch(tx, matchId)
      const participant = this.authorize(match, userId)
      const initialState = this.readState(match.metadata)
      if (!initialState) throw new ConflictException("The match is waiting for all players to ready up")
      const repaired = this.repairState(initialState, match)
      if (!repaired.state) throw new ConflictException("The Tile Rush board is unavailable")
      let state: TileRushState = repaired.state
      if (repaired.changed && state) await tx.match.update({ where: { id: matchId }, data: { metadata: this.withState(match.metadata, state) } })
      if (state.status === "FINISHED" || match.status === "FINISHED" || match.status === "SETTLED") return { ...this.project(match, participant.id, state), duplicate: true }
      if (Date.now() >= Date.parse(state.endsAt)) {
        state = await this.advanceBots(tx, match, state, Date.now())
        const finished = await this.finish(tx, match, state, null)
        return { ...this.project({ ...match, metadata: this.withState(match.metadata, finished) }, participant.id, finished), expired: true }
      }

      const duplicate = await tx.matchEvent.findFirst({ where: { matchId, clientEventId: dto.clientActionId }, orderBy: { serverReceivedAt: "desc" }, select: { accepted: true, payload: true, sequence: true } })
      if (duplicate) return { ...this.project(match, participant.id, state), duplicate: true, action: duplicate.payload }
      const current = state.players[participant.id]
      if (!current) throw new ConflictException("Player state is unavailable")
      if (dto.sequence <= current.sequence) return { ...this.project(match, participant.id, state), duplicate: true }
      if (dto.sequence !== current.sequence + 1) throw new ConflictException("Action sequence is out of date; reconcile the match")
      const engine = TileRushEngine.fromState(current, state.policy)
      const path = dto.path.map((point) => ({ row: point.row, column: point.column }))
      const now = Date.now()
      const authoritativeBoardHash = current.board.flat().join(",")
      const boardHashMismatch = Boolean(dto.boardHashBefore && dto.boardHashBefore !== authoritativeBoardHash)
      const minimumActionGap = 1000 / Math.max(1, Number(state.policy?.maxActionsPerSecond ?? 8))
      if (current.lastActionTimestamp > 0 && now - current.lastActionTimestamp < minimumActionGap) {
        const reason = "Actions are arriving too quickly"
        await tx.matchEvent.create({ data: { matchId, participantId: participant.id, eventType: "SCORE_UPDATE", sequence: dto.sequence, clientEventId: dto.clientActionId, payload: { accepted: false, path, reason, boardHash: authoritativeBoardHash, boardHashMismatch } as Prisma.InputJsonValue, accepted: false, rejectionReason: reason } })
        return { ...this.project(match, participant.id, state), action: { accepted: false, reason, sequence: dto.sequence, boardHash: authoritativeBoardHash, boardHashMismatch } }
      }
      const action = engine.resolvePath(path, now)
      const clientOccurredAt = dto.clientReleasedAt && !Number.isNaN(Date.parse(dto.clientReleasedAt)) ? new Date(dto.clientReleasedAt) : undefined
      if (!action.accepted) {
        await tx.matchEvent.create({ data: { matchId, participantId: participant.id, eventType: "SCORE_UPDATE", sequence: dto.sequence, clientEventId: dto.clientActionId, payload: { accepted: false, path, reason: action.reason ?? "Path rejected", boardHash: action.boardHash } as Prisma.InputJsonValue, accepted: false, clientOccurredAt } })
        return { ...this.project(match, participant.id, state), action: { accepted: false, reason: action.reason ?? "Path rejected", sequence: dto.sequence, boardHash: action.boardHash, boardHashMismatch } }
      }

      const nextPlayer: RuntimePlayer = { ...action.player, sequence: dto.sequence, nextBotAt: current.nextBotAt }
      state = { ...state, players: { ...state.players, [participant.id]: nextPlayer }, replay: [...state.replay, { sequence: dto.sequence, participantId: participant.id, path, scoreDelta: action.scoreDelta, chainLength: action.chainLength, combo: action.combo, special: action.special, clearedCells: action.clearedCells, cascadeCount: action.cascadeCount, boardHash: action.boardHash, acceptedAt: new Date().toISOString() }].slice(-MAX_REPLAY_EVENTS) }
      const payload = { ...this.actionPayload(dto.sequence, path, action, nextPlayer, false), boardHashBefore: dto.boardHashBefore ?? null, boardHashMismatch }
      // The live response still contains the board for the Flutter animation,
      // but persisting the same 7x7 board in every replay event multiplies
      // database/WAL volume. The bounded replay and authoritative metadata
      // already contain enough state to reconstruct the action.
      await tx.matchEvent.create({ data: { matchId, participantId: participant.id, eventType: "SCORE_UPDATE", sequence: dto.sequence, clientEventId: dto.clientActionId, payload: this.persistedActionPayload(payload) as Prisma.InputJsonValue, accepted: true, clientOccurredAt } })
      const metadata = this.withState(match.metadata, state)
      await tx.match.update({ where: { id: matchId }, data: { metadata } })
      state = await this.advanceBots(tx, { ...match, metadata }, state, Date.now())
      await tx.match.update({ where: { id: matchId }, data: { metadata: this.withState(metadata, state) } })
      return { ...this.project({ ...match, metadata }, participant.id, state), action: payload }
    })
    if ((response as any)?.expired) {
      await this.settleFinishedMatch(matchId)
      return this.snapshot(userId, matchId)
    }
    if ((response as any)?.action?.accepted === false) void this.fraud.observe(userId, { type: "REPEATED_INVALID_EVENTS", sourceType: "TILE_RUSH", sourceId: `${matchId}:${dto.clientActionId}`, metadata: { matchId, sequence: dto.sequence, reason: (response as any).action.reason, boardHashMismatch: Boolean((response as any).action.boardHashMismatch) } }).catch(() => undefined)
    if (Boolean((response as any)?.action?.boardHashMismatch)) void this.fraud.observe(userId, { type: "TILE_RUSH_BOARD_HASH_MISMATCH", sourceType: "TILE_RUSH", sourceId: `${matchId}:${dto.clientActionId}:hash`, metadata: { matchId, sequence: dto.sequence } }).catch(() => undefined)
    if ((response as any)?.action?.accepted === true && Number((response as any).action.scoreDelta ?? 0) > 5000) void this.fraud.observe(userId, { type: "TILE_RUSH_SCORE_VELOCITY", sourceType: "TILE_RUSH", sourceId: `${matchId}:${dto.clientActionId}:score`, metadata: { matchId, sequence: dto.sequence, scoreDelta: (response as any).action.scoreDelta } }).catch(() => undefined)
    return response
  }

  async forfeit(userId: string, matchId: string) {
    const response = await this.prisma.$transaction(async (tx) => {
      await this.lockMatch(tx, matchId)
      const match = await this.loadMatch(tx, matchId)
      const participant = this.authorize(match, userId)
      const state = this.readState(match.metadata)
      if (!state || state.status === "FINISHED") return this.project(match, participant.id, state)
      const finished = await this.finish(tx, match, state, participant.id)
      return { ...this.project({ ...match, metadata: this.withState(match.metadata, finished) }, participant.id, finished), expired: true }
    })
    if ((response as any)?.expired) {
      await this.settleFinishedMatch(matchId)
      return this.snapshot(userId, matchId)
    }
    return response
  }

  async finalizeExpiredMatches() {
    const active = await this.prisma.match.findMany({ where: { gameDefinition: { key: "tile_rush" }, status: "STARTED" }, select: { id: true, participants: { where: { participantType: "PLAYER", userId: { not: null } }, select: { userId: true }, take: 1 } }, orderBy: { startedAt: "asc" }, take: 100 })
    let finalized = 0
    for (const match of active) {
      const userId = match.participants[0]?.userId
      if (!userId) continue
      try { const snapshot = await this.snapshot(userId, match.id); if (snapshot.status === "FINISHED" || snapshot.status === "SETTLED") finalized += 1 } catch { /* next worker tick retries a concurrent match */ }
    }
    return { finalized }
  }

  async retryPendingSettlements() {
    const pending = await this.prisma.match.findMany({ where: { gameDefinition: { key: "tile_rush" }, status: "FINISHED", settlement: null }, select: { id: true, participants: { where: { participantType: "PLAYER", userId: { not: null } }, select: { userId: true }, take: 1 } }, orderBy: { endedAt: "asc" }, take: 100 })
    let settled = 0
    for (const match of pending) if (match.participants[0]?.userId) { const result = await this.settleFinishedMatch(match.id); if (result?.settlement?.status === "SETTLED") settled += 1 }
    return { settled }
  }

  /** Explicit recovery entry point for system administrators. The normal worker
   * remains the primary path; this is idempotent and safe to repeat. */
  async retrySettlement(matchId: string) {
    const match = await this.prisma.match.findFirst({ where: { id: matchId, gameDefinition: { key: "tile_rush" } }, select: { id: true, status: true } })
    if (!match) throw new NotFoundException("Tile Rush match not found")
    if (!["FINISHED", "REVIEW", "SETTLED"].includes(match.status)) throw new ConflictException("Only finished Tile Rush matches can be settled")
    if (match.status === "SETTLED") return this.prisma.matchSettlement.findUnique({ where: { matchId } })
    await this.settleFinishedMatch(matchId, true)
    return this.prisma.matchSettlement.findUnique({ where: { matchId } })
  }

  private async finish(tx: Prisma.TransactionClient, match: any, state: TileRushState, forfeitingParticipantId: string | null) {
    const participants = match.participants as Array<{ id: string; participantType: string }>
    const scores = participants.map((item) => ({ id: item.id, score: state.players[item.id]?.score ?? 0 }))
    const winner = forfeitingParticipantId ? scores.find((item) => item.id !== forfeitingParticipantId)?.id ?? null : scores.sort((first, second) => second.score - first.score)[0]?.id ?? null
    const tied = !forfeitingParticipantId && scores.length > 1 && scores.every((item) => item.score === scores[0].score)
    const finished: TileRushState = { ...state, status: "FINISHED", winnerParticipantId: tied ? null : winner }
    const endedAt = new Date()
    await tx.match.update({ where: { id: match.id }, data: { status: "FINISHED", endedAt, metadata: this.withState(match.metadata, finished) } })
    await tx.matchRound.updateMany({ where: { matchId: match.id, status: { in: ["CREATED", "STARTED"] } }, data: { status: "FINISHED", endedAt } })
    for (const item of participants) {
      const result: MatchParticipantResult = forfeitingParticipantId === item.id ? "FORFEIT" : tied ? "DRAW" : item.id === winner ? "WIN" : "LOSS"
      await tx.matchParticipant.update({ where: { id: item.id }, data: { finalScore: state.players[item.id]?.score ?? 0, result, submittedAt: endedAt } })
    }
    const actionEvents = await tx.matchEvent.findMany({ where: { matchId: match.id, eventType: "SCORE_UPDATE" }, select: { accepted: true, payload: true } })
    const acceptedEvents = actionEvents.filter((event) => event.accepted)
    const rejectedEvents = actionEvents.filter((event) => !event.accepted)
    const payloads = acceptedEvents.map((event) => event.payload && typeof event.payload === "object" && !Array.isArray(event.payload) ? event.payload as Record<string, unknown> : {})
    const chains = payloads.map((payload) => Number(payload.chainLength ?? 0)).filter((value) => Number.isFinite(value) && value > 0)
    const specials = payloads.filter((payload) => payload.special && payload.special !== TileRushSpecial.None).length
    const combos = payloads.filter((payload) => Number(payload.combo ?? 0) > 1).length
    const boardHashMismatches = payloads.filter((payload) => payload.boardHashMismatch === true).length
    await tx.analyticsEvent.create({ data: { eventName: "TILE_RUSH_MATCH_FINISHED", occurredAt: endedAt, matchId: match.id, properties: { winnerParticipantId: finished.winnerParticipantId, scores, acceptedActions: acceptedEvents.length, rejectedActions: rejectedEvents.length, specials, combos, maxCombo: payloads.reduce((max, payload) => Math.max(max, Number(payload.combo ?? 0)), 0), averageChain: chains.length ? chains.reduce((total, value) => total + value, 0) / chains.length : 0, maxChain: chains.length ? Math.max(...chains) : 0, boardHashMismatches } as Prisma.InputJsonValue } })
    return finished
  }

  private async settleFinishedMatch(matchId: string, allowReview = false): Promise<TileRushState | null> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.lockMatch(tx, matchId)
        const match = await this.loadMatch(tx, matchId)
        const state = this.readState(match.metadata)
        if (!state || state.status !== "FINISHED" || match.settlement || (match.status !== "FINISHED" && !(allowReview && match.status === "REVIEW"))) return state
        const human = match.participants.find((item: any) => item.participantType === "PLAYER" && item.userId)
        if (!human?.userId) return state
        const settlement = await this.settleMatch.runWithinTransaction({ matchId, userId: human.userId, idempotencyKey: `tile-rush-settle:${matchId}` }, tx)
        const settled = { ...state, settlement }
        await tx.match.update({ where: { id: matchId }, data: { status: settlement?.status === "SETTLED" ? "SETTLED" : undefined, metadata: this.withState(match.metadata, settled) } })
        await tx.analyticsEvent.create({ data: { eventName: "TILE_RUSH_MATCH_SETTLED", occurredAt: new Date(), matchId, playerId: human.userId, properties: { winnerParticipantId: settled.winnerParticipantId, settlementStatus: settlement?.status ?? "UNKNOWN", policyVersion: settled.policyVersion } as Prisma.InputJsonValue } })
        return settled
      })
    } catch {
      await this.prisma.analyticsEvent.create({ data: { eventName: "TILE_RUSH_SETTLEMENT_RETRY_FAILED", occurredAt: new Date(), matchId, properties: { matchId } as Prisma.InputJsonValue } }).catch(() => undefined)
      return null
    }
  }

  private newState(match: any, participantIds: string[], now: Date): TileRushState {
    const policy = this.policyFor(match)
    const runtimePolicy = { ...policy, finalRushEndsAtMs: now.getTime() + Math.max(0, Number(policy.durationSeconds) - Number(policy.finalRushSeconds ?? 10)) * 1000 }
    const seed = Math.abs(Number.parseInt(String(match.serverNonce).slice(0, 8), 16)) || 18421
    const initial = TileRushEngine.newGame(seed, runtimePolicy.boardSize, runtimePolicy)
    const botPolicy = this.humanBotPolicy(runtimePolicy, match)
    const players = Object.fromEntries(participantIds.map((id) => [id, { ...initial.snapshot(0, now.getTime() + Number(botPolicy.bot.reactionDelayMs)), seed: initial.seed }]))
    return { rulesVersion: String(runtimePolicy.rulesVersion), policyVersion: match.gameConfig?.version ?? null, seed, boardSize: initial.boardSize, tileTypes: initial.tileTypes, durationSeconds: Number(runtimePolicy.durationSeconds), startedAt: now.toISOString(), endsAt: new Date(now.getTime() + Number(runtimePolicy.durationSeconds) * 1000).toISOString(), status: "ACTIVE", players, replay: [], policy: runtimePolicy }
  }

  private policyFor(match: any) {
    const config = match.gameConfig?.settings && typeof match.gameConfig.settings === "object" && !Array.isArray(match.gameConfig.settings) ? match.gameConfig.settings as Record<string, any> : {}
    const mode = match.gameDefinition?.modePolicy && typeof match.gameDefinition.modePolicy === "object" && !Array.isArray(match.gameDefinition.modePolicy) ? match.gameDefinition.modePolicy as Record<string, any> : {}
    const configured = config.tileRushPolicy ?? mode
    const policy: any = { ...DEFAULT_POLICY, ...configured, bot: { ...DEFAULT_POLICY.bot, ...(configured?.bot ?? {}) }, scoring: { ...DEFAULT_POLICY.scoring, ...(configured?.scoring ?? {}) } }
    policy.boardSize = clampInt(policy.boardSize, 5, 9, 7)
    policy.tileTypes = clampInt(policy.tileTypes, 3, 8, 5)
    policy.minimumChain = clampInt(policy.minimumChain, 3, 5, 3)
    policy.durationSeconds = clampInt(policy.durationSeconds, 30, 180, 60)
    policy.comboWindowMs = Math.max(250, Math.min(10000, Number(policy.comboWindowMs) || 2000))
    policy.maxActionsPerSecond = Math.max(1, Math.min(20, Number(policy.maxActionsPerSecond) || 8))
    policy.scoreCap = Math.max(1000, Math.min(10000000, Number(policy.scoreCap ?? 250000) || 250000))
    return policy
  }

  private async advanceBots(tx: Prisma.TransactionClient, match: any, state: TileRushState, nowMs: number) {
    const policy = state.policy ?? this.policyFor(match)
    if (!policy.bot?.enabled || state.status !== "ACTIVE") return state
    const botPolicy = this.humanBotPolicy(policy, match)
    const simulationLimit = Math.min(nowMs, Date.parse(state.endsAt))
    let nextState = state
    for (const bot of (match.participants as any[]).filter((item) => item.participantType === "BOT")) {
      let player = nextState.players[bot.id]
      if (!player) {
        const fresh = TileRushEngine.newGame(state.seed + this.botOffset(bot.id), state.boardSize, botPolicy)
        player = { ...fresh.snapshot(0, Date.parse(state.startedAt) + Number(botPolicy.bot.reactionDelayMs)), sequence: 0 }
        nextState = { ...nextState, players: { ...nextState.players, [bot.id]: player } }
      }
      let moves = 0
      const maxActions = Math.min(80, Math.max(1, Number(botPolicy.bot.maxActions ?? 32) || 32))
      while (Number(player.nextBotAt ?? simulationLimit) <= simulationLimit && moves < maxActions) {
        const engine = TileRushEngine.fromState(player, botPolicy)
        const candidates = engine.candidatePaths(180)
        if (!candidates.length) { player = { ...player, nextBotAt: Number(player.nextBotAt ?? simulationLimit) + Number(botPolicy.bot.reactionDelayMs) }; nextState = { ...nextState, players: { ...nextState.players, [bot.id]: player } }; moves += 1; continue }
        const skill = Math.max(0, Math.min(1, Number(botPolicy.bot.skill ?? 0.32)))
        const errorRate = Math.max(0, Math.min(.8, Number(botPolicy.bot.errorRate ?? .28)))
        const nonce = Number.parseInt(String(match.serverNonce).slice(0, 8), 16) || 0
        const roll = ((player.sequence * 29 + nonce) % 1000) / 1000
        const reaction = Number(player.nextBotAt ?? simulationLimit)
        if (player.sequence > 0 && roll < errorRate) {
          player = { ...player, nextBotAt: reaction + Number(botPolicy.bot.reactionDelayMs) + ((player.sequence * 37) % Math.max(1, Number(botPolicy.bot.jitterMs ?? 900))) }
          nextState = { ...nextState, players: { ...nextState.players, [bot.id]: player } }
          moves += 1
          continue
        }
        const maxChain = Math.max(3, Math.min(10, 3 + Math.floor(skill * 7)))
        const viable = candidates.filter((candidate) => candidate.length <= maxChain && (skill > .55 || !candidate.isLoop))
        const choices = viable.length ? viable : candidates
        const chosen = choices[(nonce + player.sequence * 17 + Math.floor((1 - skill) * 11)) % choices.length]
        const result = engine.resolvePath(chosen.path, reaction)
        if (!result.accepted) {
          player = { ...player, nextBotAt: reaction + Number(botPolicy.bot.reactionDelayMs) }
          nextState = { ...nextState, players: { ...nextState.players, [bot.id]: player } }
          moves += 1
          continue
        }
        const sequence = player.sequence + 1
        player = { ...result.player, sequence, nextBotAt: reaction + Number(botPolicy.bot.reactionDelayMs) + ((sequence * 37) % Math.max(1, Number(botPolicy.bot.jitterMs ?? 900))) }
        nextState = { ...nextState, players: { ...nextState.players, [bot.id]: player }, replay: [...nextState.replay, { sequence, participantId: bot.id, path: chosen.path, scoreDelta: result.scoreDelta, chainLength: result.chainLength, combo: result.combo, special: result.special, clearedCells: result.clearedCells, cascadeCount: result.cascadeCount, boardHash: result.boardHash, bot: true, acceptedAt: new Date().toISOString() }].slice(-MAX_REPLAY_EVENTS) }
        await tx.matchEvent.create({ data: { matchId: match.id, participantId: bot.id, eventType: "SCORE_UPDATE", sequence, clientEventId: `tile-rush:${bot.id}:${sequence}`, payload: this.persistedActionPayload(this.actionPayload(sequence, chosen.path, result, player, true)) as Prisma.InputJsonValue, accepted: true } })
        moves += 1
      }
    }
    if (nextState !== state) await tx.match.update({ where: { id: match.id }, data: { metadata: this.withState(match.metadata, nextState) } })
    return nextState
  }

  private humanBotPolicy(policy: any, match: any) {
    const profiles = [{ reactionDelayMs: 2100, jitterMs: 1200, skill: .24, maxActions: 22, errorRate: .38 }, { reactionDelayMs: 1500, jitterMs: 900, skill: .38, maxActions: 30, errorRate: .27 }, { reactionDelayMs: 1000, jitterMs: 650, skill: .52, maxActions: 38, errorRate: .18 }]
    const nonce = Number.parseInt(String(match.serverNonce ?? "").slice(0, 6), 16) || 0
    const profile = profiles[nonce % profiles.length]
    return { ...policy, bot: { ...policy.bot, reactionDelayMs: Math.max(profile.reactionDelayMs, Number(policy.bot?.reactionDelayMs ?? profile.reactionDelayMs)), jitterMs: Math.max(profile.jitterMs, Number(policy.bot?.jitterMs ?? profile.jitterMs)), skill: Math.min(profile.skill, Number(policy.bot?.skill ?? profile.skill)), maxActions: Math.min(profile.maxActions, Math.max(1, Number(policy.bot?.maxActions ?? profile.maxActions))), errorRate: Math.max(profile.errorRate, Number(policy.bot?.errorRate ?? profile.errorRate)) } }
  }

  private actionPayload(sequence: number, path: TileRushPoint[], result: TileRushActionResult, player: RuntimePlayer, bot: boolean) {
    return { accepted: true, sequence, path, scoreDelta: result.scoreDelta, totalScore: result.totalScore, chainLength: result.chainLength, combo: result.combo, special: result.special, clearedCells: result.clearedCells, cascadeCount: result.cascadeCount, boardHash: result.boardHash, board: player.board, bot }
  }

  private persistedActionPayload(payload: Record<string, unknown>) {
    const { board: _board, ...compact } = payload
    return compact
  }

  private botOffset(id: string) { return Math.abs(Number.parseInt(id.replace(/[^0-9a-f]/gi, "").slice(0, 8) || "1", 16)) }

  private readState(metadata: Prisma.JsonValue | Prisma.InputJsonValue | null | undefined): TileRushState | null { if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null; const state = (metadata as Record<string, unknown>).tileRush; return state && typeof state === "object" ? state as TileRushState : null }
  private repairState(state: TileRushState | null, match: any): { state: TileRushState | null; changed: boolean } {
    if (!state || state.status !== "ACTIVE") return { state, changed: false }
    const policy = this.policyFor(match)
    const expectedSize = Number(policy.boardSize)
    const expectedTypes = Number(policy.tileTypes)
    let changed = state.boardSize !== expectedSize || state.tileTypes !== expectedTypes
    const players = { ...state.players }
    for (const [participantId, player] of Object.entries(state.players ?? {})) {
      const runtime = player as RuntimePlayer
      const validBoard = Array.isArray(runtime.board) && runtime.board.length === expectedSize && runtime.board.every((row) => Array.isArray(row) && row.length === expectedSize && row.every((tile) => Number.isInteger(tile) && tile >= 0 && tile < expectedTypes))
      if (validBoard) {
        try {
          const engine = TileRushEngine.fromState(runtime, policy)
          if (engine.hasValidPath) continue
        } catch {
          // Fall through to a fresh playable board for malformed legacy state.
        }
      }
      const fresh = TileRushEngine.newGame(Number(runtime.seed ?? state.seed), expectedSize, policy)
      const generated = fresh.stateSnapshot
      players[participantId] = { ...runtime, board: generated.board, randomState: generated.randomState, seed: generated.seed }
      changed = true
    }
    if (!changed) return { state, changed: false }
    return { state: { ...state, boardSize: expectedSize, tileTypes: expectedTypes, policy, players }, changed: true }
  }
  private withState(metadata: Prisma.JsonValue | Prisma.InputJsonValue | null | undefined, state: TileRushState): Prisma.InputJsonValue { const base = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata as Record<string, unknown> : {}; return { ...base, tileRush: state } as unknown as Prisma.InputJsonValue }
  private async lockMatch(tx: Prisma.TransactionClient, matchId: string) { await tx.$executeRaw`SELECT "id" FROM "Match" WHERE "id" = ${matchId} FOR UPDATE` }
  private async loadMatch(tx: Prisma.TransactionClient, matchId: string) {
    const match = await tx.match.findUnique({ where: { id: matchId }, include: { gameDefinition: { select: { key: true, modePolicy: true } }, gameConfig: true, participants: { select: { id: true, userId: true, participantType: true, readyAt: true, finalScore: true, result: true, user: { select: { username: true, profile: { select: { displayName: true, avatarUrl: true } } } } } }, rounds: { orderBy: { roundIndex: "desc" }, take: 1 }, settlement: true } })
    if (!match) throw new NotFoundException("Match not found")
    if (match.gameDefinition.key !== "tile_rush") throw new BadRequestException("This is not a Tile Rush match")
    return match
  }
  private authorize(match: any, userId: string) { const participant = match.participants.find((item: any) => item.userId === userId); if (!participant) throw new NotFoundException("Player is not a participant in this match"); return participant }
  private project(match: any, participantId: string, state: TileRushState | null) {
    const players = match.participants.map((item: any) => { const player = state?.players[item.id]; return { participantId: item.id, userId: item.userId, participantType: item.participantType, name: item.user?.profile?.displayName || item.user?.username || "SMARTS bot", avatarUrl: item.user?.profile?.avatarUrl ?? null, score: player?.score ?? item.finalScore ?? 0, combo: player?.combo ?? 0, sequence: player?.sequence ?? 0, bestChain: player?.bestChain ?? 0, longestCombo: player?.longestCombo ?? 0, tilesCleared: player?.tilesCleared ?? 0, colorCrushes: player?.colorCrushes ?? 0, result: item.result } })
    const self = state?.players[participantId]
    const policy = state?.policy ?? this.policyFor(match)
    return { matchId: match.id, selfParticipantId: participantId, status: state?.status === "FINISHED" ? "FINISHED" : match.status, rulesVersion: state?.rulesVersion ?? policy.rulesVersion, policyVersion: state?.policyVersion ?? match.gameConfig?.version ?? null, seed: state?.seed ?? null, boardSize: state?.boardSize ?? policy.boardSize, tileTypes: state?.tileTypes ?? policy.tileTypes, minimumChain: policy.minimumChain, durationSeconds: state?.durationSeconds ?? policy.durationSeconds, startedAt: state?.startedAt ?? match.startedAt?.toISOString() ?? null, endsAt: state?.endsAt ?? null, serverNow: new Date().toISOString(), board: self?.board ?? [], self: self ? { ...self, board: self.board } : null, players, winnerParticipantId: state?.winnerParticipantId ?? null, replayLength: state?.replay.length ?? 0, settlement: state?.settlement ?? match.settlement?.settlementJson ?? null, policy: { rulesVersion: policy.rulesVersion, boardSize: policy.boardSize, tileTypes: policy.tileTypes, durationSeconds: policy.durationSeconds, minimumChain: policy.minimumChain, loopsEnabled: policy.loopsEnabled, finalRushSeconds: policy.finalRushSeconds, finalRushMultiplier: policy.finalRushMultiplier, comboWindowMs: policy.comboWindowMs } }
  }
}

function clampInt(value: number, minimum: number, maximum: number, fallback: number) { const number = Number(value); return Number.isInteger(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback }
