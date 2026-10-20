import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common"
import { Prisma, MatchParticipantResult } from "@prisma/client"
import { PrismaService } from "../../prisma.service"
import { SettleMatchTransaction } from "../matches/transactions/settle-match-transaction"
import { DominoActionDto, DominoPlayTileDto } from "./dtos/domino.dto"
import { applyAction, computeChainHash, createInitialState, createNextRoundState, DominoActionType, DominoPolicy, DominoState, legalMoves, tilePips } from "./engine/domino-engine"

type MatchRow = any
const DEFAULT_POLICY: DominoPolicy = { rulesVersion: "domino.v1", scoreVersion: "domino-score.v1", seatCount: 4, handSize: 5, boneyardSize: 8, targetScore: 100, maxRounds: 10, roundDurationSeconds: 300, matchDurationSeconds: 900 }

@Injectable()
export class DominoService {
  constructor(private readonly prisma: PrismaService, private readonly settleMatch: SettleMatchTransaction) {}

  async snapshot(userId: string, matchId: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      await this.lockMatch(tx, matchId)
      let match = await this.loadMatch(tx, matchId)
      const participant = this.authorize(match, userId)
      const policy = this.policy(match)
      let state = await this.state(tx, match, policy)
      if (match.status === "STARTED") {
        state = await this.advanceBot(tx, match, state, policy)
        if (Date.now() >= new Date(state.endsAt).getTime() || Date.now() >= new Date(state.matchEndsAt).getTime()) await this.finishMatch(tx, match, state, null, policy)
      }
      match = await this.loadMatch(tx, matchId)
      state = await tx.dominoMatchState.findUniqueOrThrow({ where: { matchId } }).then((row: any) => row.state as DominoState)
      return { projection: this.project(match, state, participant.id, policy), finalized: ["FINISHED", "REVIEW", "SETTLED"].includes(match.status) }
    })
    if (result.finalized) await this.settleFinishedMatch(matchId)
    return result.projection
  }

  async start(userId: string, matchId: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      await this.lockMatch(tx, matchId)
      let match = await this.loadMatch(tx, matchId)
      const participant = this.authorize(match, userId)
      if (!["CREATED", "STARTED"].includes(match.status)) throw new ConflictException("The Domino match cannot be started")
      const policy = this.policy(match)
      await this.ensureSeats(tx, match, policy)
      match = await this.loadMatch(tx, matchId)
      let stateRow = await tx.dominoMatchState.findUnique({ where: { matchId } })
      const now = new Date()
      await tx.matchParticipant.update({ where: { id: participant.id }, data: { readyAt: participant.readyAt ?? now, lastActivityAt: now, disconnectGraceUntil: null } })
      const participants = await tx.matchParticipant.findMany({ where: { matchId }, select: { id: true, participantType: true, readyAt: true } })
      const ready = participants.filter((item: any) => item.participantType === "BOT" || item.readyAt)
      if (!stateRow && ready.length < participants.length) return { projection: this.project(match, null, participant.id, policy), waitingForPlayers: true, readyCount: ready.length, requiredCount: participants.length }
      if (!stateRow) {
        const state = createInitialState(participants.sort((a: any, b: any) => a.id.localeCompare(b.id)).map((item: any) => item.id), `${match.serverNonce}:domino:1`, policy, now)
        stateRow = await tx.dominoMatchState.create({ data: { matchId, rulesVersion: policy.rulesVersion, policyVersion: policy.scoreVersion, seed: state.seed, roundNumber: 1, currentSeat: state.currentSeat, nextSequence: 1, leftOpenValue: state.leftOpenValue ?? 0, rightOpenValue: state.rightOpenValue ?? 0, chainHash: state.chainHash, boneyardCount: state.boneyard.length, state: state as unknown as Prisma.InputJsonValue, replay: [] as unknown as Prisma.InputJsonValue, startedAt: now, roundEndsAt: new Date(state.endsAt), matchEndsAt: new Date(state.matchEndsAt) } })
        await tx.match.update({ where: { id: matchId }, data: { status: "STARTED", startedAt: now } })
        await tx.matchRound.updateMany({ where: { matchId, status: "CREATED" }, data: { status: "STARTED", startedAt: now } })
        await tx.analyticsEvent.create({ data: { eventName: "DOMINO_MATCH_STARTED", occurredAt: now, matchId, playerId: userId, properties: { rulesVersion: policy.rulesVersion, scoreVersion: policy.scoreVersion, seats: policy.seatCount, mode: match.mode } as Prisma.InputJsonValue } })
      }
      const state = (stateRow.state ?? {}) as DominoState
      return this.project({ ...match, status: "STARTED" }, state, participant.id, policy)
    })
    return result
  }

  play(userId: string, matchId: string, dto: DominoPlayTileDto) { return this.action(userId, matchId, dto, "PLAY_TILE") }
  draw(userId: string, matchId: string, dto: DominoActionDto) { return this.action(userId, matchId, dto, "DRAW_TILE") }
  pass(userId: string, matchId: string, dto: DominoActionDto) { return this.action(userId, matchId, dto, "PASS") }

  private async action(userId: string, matchId: string, dto: DominoActionDto & Partial<DominoPlayTileDto>, type: DominoActionType) {
    const result = await this.prisma.$transaction(async (tx) => {
      await this.lockMatch(tx, matchId)
      let match = await this.loadMatch(tx, matchId)
      const participant = this.authorize(match, userId)
      if (match.status !== "STARTED") throw new ConflictException("The Domino match is not active")
      const policy = this.policy(match)
      const row = await tx.dominoMatchState.findUnique({ where: { matchId } })
      if (!row) throw new ConflictException("The Domino match has not started")
      const state = row.state as unknown as DominoState
      const duplicate = await tx.dominoAction.findUnique({ where: { matchId_matchParticipantId_clientActionId: { matchId, matchParticipantId: participant.id, clientActionId: dto.clientActionId } } })
      if (duplicate) return { projection: this.project(match, state, participant.id, policy), action: this.actionProjection(duplicate), finalized: false }
      const expected = state.nextSequence[participant.id] ?? 1
      if (dto.sequence !== expected) throw new ConflictException("Action sequence is out of date; reconcile the match")
      const validation = dto.chainHashBefore && dto.chainHashBefore !== state.chainHash ? "CHAIN_MISMATCH" : null
      const applied: any = validation ? { accepted: false, reason: validation, state } : applyAction(state, participant.id, { type, tileKey: dto.tileKey, side: dto.side }, policy)
      const nextSequence = { ...applied.state.nextSequence, [participant.id]: expected + 1 }
      applied.state.nextSequence = nextSequence
      applied.state.chainHash = computeChainHash(applied.state)
      const action = await tx.dominoAction.create({ data: { matchId, dominoMatchStateId: row.id, matchParticipantId: participant.id, sequence: dto.sequence, clientActionId: dto.clientActionId, actionType: type, accepted: applied.accepted, rejectionReason: applied.accepted ? undefined : applied.reason, payload: { tileKey: dto.tileKey ?? null, side: dto.side ?? null, chainHash: applied.state.chainHash, round: applied.round ?? null } as Prisma.InputJsonValue, clientOccurredAt: dto.clientOccurredAt ? new Date(dto.clientOccurredAt) : undefined } })
      await this.saveState(tx, row, applied.state)
      await tx.matchEvent.create({ data: { matchId, participantId: participant.id, eventType: "SCORE_UPDATE", sequence: dto.sequence, clientEventId: dto.clientActionId, payload: { game: "domino", eventKind: type, accepted: applied.accepted, reason: applied.reason ?? null, tileKey: dto.tileKey ?? null, side: dto.side ?? null, chainHash: applied.state.chainHash, score: applied.state.scores[participant.id] ?? 0 } as Prisma.InputJsonValue, accepted: applied.accepted, rejectionReason: applied.accepted ? undefined : applied.reason } })
      await tx.matchParticipant.update({ where: { id: participant.id }, data: { answeredCount: { increment: 1 }, finalScore: applied.state.scores[participant.id] ?? 0, lastActivityAt: new Date() } })
      if (applied.accepted && applied.round) await this.completeRound(tx, match, row, applied.state, applied.round.winnerParticipantId, policy)
      match = await this.loadMatch(tx, matchId)
      const finalRow = await tx.dominoMatchState.findUniqueOrThrow({ where: { matchId } })
      return { projection: this.project(match, finalRow.state as unknown as DominoState, participant.id, policy), action: this.actionProjection(action), finalized: ["FINISHED", "REVIEW", "SETTLED"].includes(match.status) }
    })
    if (result.finalized) await this.settleFinishedMatch(matchId)
    return { ...result.projection, action: result.action }
  }

  async forfeit(userId: string, matchId: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      await this.lockMatch(tx, matchId)
      const match = await this.loadMatch(tx, matchId)
      const participant = this.authorize(match, userId)
      const policy = this.policy(match)
      const row = await tx.dominoMatchState.findUnique({ where: { matchId } })
      if (!row) throw new ConflictException("The Domino match has not started")
      if (["FINISHED", "SETTLED", "REVIEW"].includes(match.status)) return { projection: this.project(match, row.state as unknown as DominoState, participant.id, policy), finalized: false }
      const state = row.state as unknown as DominoState
      await this.finishMatch(tx, match, state, participant.id, policy)
      const finished = await this.loadMatch(tx, matchId)
      const finalState = (await tx.dominoMatchState.findUniqueOrThrow({ where: { matchId } })).state as unknown as DominoState
      return { projection: this.project(finished, finalState, participant.id, policy), finalized: true }
    })
    if (result.finalized) await this.settleFinishedMatch(matchId)
    return result.projection
  }

  async results(userId: string, matchId: string) { return this.snapshot(userId, matchId) }

  async finalizeExpiredMatches() {
    const active = await this.prisma.match.findMany({ where: { gameDefinition: { key: "domino" }, status: "STARTED" }, select: { id: true, participants: { where: { participantType: "PLAYER", userId: { not: null } }, select: { userId: true }, take: 1 } }, take: 100 })
    let finalized = 0
    for (const match of active) if (match.participants[0]?.userId) { try { const snapshot = await this.snapshot(match.participants[0].userId, match.id); if (["FINISHED", "SETTLED"].includes(snapshot.status)) finalized += 1 } catch { /* retry next tick */ } }
    return { finalized }
  }

  async retryPendingSettlements() {
    const pending = await this.prisma.match.findMany({ where: { gameDefinition: { key: "domino" }, status: { in: ["FINISHED", "REVIEW"] }, settlement: null }, select: { id: true, participants: { where: { participantType: "PLAYER", userId: { not: null } }, select: { userId: true }, take: 1 } }, take: 100 })
    let settled = 0
    for (const item of pending) if (item.participants[0]?.userId && await this.settleFinishedMatch(item.id)) settled += 1
    return { settled }
  }

  async retrySettlement(matchId: string) {
    const match = await this.prisma.match.findFirst({ where: { id: matchId, gameDefinition: { key: "domino" } }, select: { id: true, status: true } })
    if (!match) throw new NotFoundException("Domino match not found")
    if (!["FINISHED", "REVIEW", "SETTLED"].includes(match.status)) throw new ConflictException("Only finished Domino matches can be settled")
    if (match.status !== "SETTLED") await this.settleFinishedMatch(matchId)
    return this.prisma.matchSettlement.findUnique({ where: { matchId } })
  }

  async advanceBotMatches() {
    const active = await this.prisma.match.findMany({ where: { gameDefinition: { key: "domino" }, status: "STARTED", participants: { some: { participantType: "BOT" } } }, select: { id: true, participants: { where: { participantType: "PLAYER", userId: { not: null } }, select: { userId: true }, take: 1 } }, take: 100 })
    for (const item of active) if (item.participants[0]?.userId) await this.snapshot(item.participants[0].userId, item.id).catch(() => undefined)
    return { advanced: active.length }
  }

  private async advanceBot(tx: Prisma.TransactionClient, match: MatchRow, state: DominoState, policy: DominoPolicy) {
    const botId = state.participantIds[state.currentSeat]
    const bot = match.participants.find((item: any) => item.id === botId && item.participantType === "BOT")
    if (!bot || (state.botNextActionAt?.[botId] ?? 0) > Date.now()) return state
    const moves = legalMoves(state, botId)
    const move = moves.sort((a, b) => tilePips(b.tile) - tilePips(a.tile))[0]
    const action = move ? { type: "PLAY_TILE" as const, tileKey: move.tile.tileKey, side: move.side } : state.boneyard.length ? { type: "DRAW_TILE" as const } : { type: "PASS" as const }
    const applied: any = applyAction(state, botId, action, policy)
    if (!applied.accepted) return state
    applied.state.nextSequence[botId] = (applied.state.nextSequence[botId] ?? 1) + 1
    applied.state.botNextActionAt = { ...(applied.state.botNextActionAt ?? {}), [botId]: Date.now() + 900 }
    const row = await tx.dominoMatchState.findUniqueOrThrow({ where: { matchId: match.id } })
    const clientActionId = `bot:${match.id}:${botId}:${applied.state.nextSequence[botId]}`
    await tx.dominoAction.create({ data: { matchId: match.id, dominoMatchStateId: row.id, matchParticipantId: botId, sequence: applied.state.nextSequence[botId] - 1, clientActionId, actionType: action.type, accepted: true, payload: { tileKey: action.tileKey ?? null, side: action.side ?? null, chainHash: applied.state.chainHash } as Prisma.InputJsonValue } })
    await tx.matchEvent.create({ data: { matchId: match.id, participantId: botId, eventType: "SCORE_UPDATE", sequence: applied.state.nextSequence[botId] - 1, clientEventId: clientActionId, payload: { game: "domino", eventKind: action.type, accepted: true, bot: true, score: applied.state.scores[botId] ?? 0 } as Prisma.InputJsonValue, accepted: true } })
    await tx.matchParticipant.update({ where: { id: botId }, data: { answeredCount: { increment: 1 }, finalScore: applied.state.scores[botId] ?? 0 } })
    await this.saveState(tx, row, applied.state)
    if (applied.round) await this.completeRound(tx, match, row, applied.state, applied.round.winnerParticipantId, policy)
    return applied.state
  }

  private async completeRound(tx: Prisma.TransactionClient, match: MatchRow, row: any, state: DominoState, winnerId: string, policy: DominoPolicy) {
    const reachedTarget = Object.values(state.scores).some((score) => score >= policy.targetScore)
    if (reachedTarget || state.roundNumber >= policy.maxRounds || Date.now() >= new Date(state.matchEndsAt).getTime()) return this.finishMatch(tx, match, state, null, policy)
    const next = createNextRoundState(state, `${state.seed}:round:${state.roundNumber + 1}`, policy)
    await tx.matchRound.updateMany({ where: { matchId: match.id, status: { in: ["CREATED", "STARTED"] } }, data: { status: "FINISHED", endedAt: new Date() } })
    await tx.matchRound.create({ data: { matchId: match.id, roundIndex: next.roundNumber, gameDefinitionId: match.gameDefinitionId, status: "STARTED", challengeSeedHash: next.chainHash, startedAt: new Date(next.startedAt) } })
    await this.saveState(tx, row, next)
  }

  private async finishMatch(tx: Prisma.TransactionClient, match: MatchRow, state: DominoState, forfeitingParticipantId: string | null, policy: DominoPolicy) {
    state.status = "FINISHED"
    const scores = state.participantIds.map((id) => ({ id, score: state.scores[id] ?? 0 }))
    const winner = forfeitingParticipantId ? scores.find((item) => item.id !== forfeitingParticipantId)?.id : scores.slice().sort((a, b) => b.score - a.score)[0]?.id
    const tied = !forfeitingParticipantId && scores.length > 1 && scores.every((item) => item.score === scores[0].score)
    const endedAt = new Date()
    await tx.match.update({ where: { id: match.id }, data: { status: "FINISHED", endedAt } })
    const row = await tx.dominoMatchState.findUniqueOrThrow({ where: { matchId: match.id } })
    await this.saveState(tx, row, state, endedAt)
    await tx.matchRound.updateMany({ where: { matchId: match.id, status: { in: ["CREATED", "STARTED"] } }, data: { status: "FINISHED", endedAt } })
    for (const item of match.participants) {
      const result: MatchParticipantResult = forfeitingParticipantId === item.id ? "FORFEIT" : tied ? "DRAW" : item.id === winner ? "WIN" : "LOSS"
      await tx.matchParticipant.update({ where: { id: item.id }, data: { finalScore: state.scores[item.id] ?? 0, result, submittedAt: endedAt } })
    }
    await tx.analyticsEvent.create({ data: { eventName: "DOMINO_MATCH_FINISHED", occurredAt: endedAt, matchId: match.id, properties: { winnerParticipantId: tied ? null : winner, scores, rulesVersion: policy.rulesVersion, scoreVersion: policy.scoreVersion } as Prisma.InputJsonValue } })
  }

  private async settleFinishedMatch(matchId: string) {
    try { return await this.prisma.$transaction(async (tx) => { await this.lockMatch(tx, matchId); const match = await this.loadMatch(tx, matchId); if (match.status !== "FINISHED" || match.settlement) return match.settlement; const human = match.participants.find((item: any) => item.participantType === "PLAYER" && item.userId); if (!human) return null; const settlement = await this.settleMatch.runWithinTransaction({ matchId, userId: human.userId, idempotencyKey: `domino-settle:${matchId}` }, tx); if (settlement?.status === "SETTLED") await tx.match.update({ where: { id: matchId }, data: { status: "SETTLED" } }); return settlement }) } catch { return null }
  }

  private async ensureSeats(tx: Prisma.TransactionClient, match: MatchRow, policy: DominoPolicy) {
    const participants = await tx.matchParticipant.findMany({ where: { matchId: match.id }, orderBy: { createdAt: "asc" } })
    for (let index = participants.length; index < policy.seatCount; index += 1) await tx.matchParticipant.create({ data: { matchId: match.id, participantType: "BOT", result: "PENDING" } })
  }

  private policy(match: MatchRow): DominoPolicy { const settings = match.gameConfig?.settings && typeof match.gameConfig.settings === "object" && !Array.isArray(match.gameConfig.settings) ? match.gameConfig.settings as Record<string, any> : {}; const configured = settings.dominoPolicy && typeof settings.dominoPolicy === "object" ? settings.dominoPolicy : {}; const bounded = (value: unknown, fallback: number, minimum: number, maximum: number) => { const parsed = Number(value); return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, Math.floor(parsed))) : fallback }; const roundDurationSeconds = bounded(configured.roundDurationSeconds, DEFAULT_POLICY.roundDurationSeconds, 30, 900); return { ...DEFAULT_POLICY, ...configured, seatCount: 4, handSize: 5, boneyardSize: 8, targetScore: bounded(configured.targetScore, DEFAULT_POLICY.targetScore, 25, 500), maxRounds: bounded(configured.maxRounds, DEFAULT_POLICY.maxRounds, 1, 20), roundDurationSeconds, matchDurationSeconds: Math.max(roundDurationSeconds, bounded(configured.matchDurationSeconds, DEFAULT_POLICY.matchDurationSeconds, 60, 1800)) } }
  private async state(tx: Prisma.TransactionClient, match: MatchRow, policy: DominoPolicy) { const existing = await tx.dominoMatchState.findUnique({ where: { matchId: match.id } }); if (existing) return existing.state as unknown as DominoState; return { status: "ACTIVE", participantIds: match.participants.map((item: any) => item.id), scores: {}, roundScores: {}, hands: {}, boneyard: [], chain: [], leftOpenValue: null, rightOpenValue: null, nextSequence: {}, chainHash: "", roundNumber: 1, currentSeat: 0, consecutivePasses: 0, seed: match.serverNonce, startedAt: new Date().toISOString(), endsAt: new Date(Date.now() + policy.roundDurationSeconds * 1000).toISOString(), matchEndsAt: new Date(Date.now() + policy.matchDurationSeconds * 1000).toISOString() } as unknown as DominoState }
  private async saveState(tx: Prisma.TransactionClient, row: any, state: DominoState, endedAt?: Date) { await tx.dominoMatchState.update({ where: { id: row.id }, data: { roundNumber: state.roundNumber, currentSeat: state.currentSeat, nextSequence: Math.max(...Object.values(state.nextSequence), 1), leftOpenValue: state.leftOpenValue ?? 0, rightOpenValue: state.rightOpenValue ?? 0, chainHash: state.chainHash, boneyardCount: state.boneyard.length, state: state as unknown as Prisma.InputJsonValue, replay: (state.chain ?? []) as unknown as Prisma.InputJsonValue, endedAt, roundEndsAt: new Date(state.endsAt), matchEndsAt: new Date(state.matchEndsAt) } }) }
  private project(match: MatchRow, state: DominoState | null, participantId: string, policy: DominoPolicy): any { if (!state || !state.participantIds?.length) return { gameKey: "domino", matchId: match.id, status: match.status, waitingForPlayers: true, players: match.participants.map((item: any, seat: number) => this.playerProjection(item, seat, null)) }; const now = Date.now(); return { gameKey: "domino", matchId: match.id, status: match.status, mode: match.mode, rulesVersion: policy.rulesVersion, scoreVersion: policy.scoreVersion, roundNumber: state.roundNumber, currentSeat: state.currentSeat, yourParticipantId: participantId, yourSeat: state.participantIds.indexOf(participantId), isYourTurn: state.participantIds[state.currentSeat] === participantId && state.status === "ACTIVE", nextSequence: state.nextSequence[participantId] ?? 1, chain: state.chain, openEnds: { left: state.leftOpenValue, right: state.rightOpenValue }, yourHand: state.hands[participantId] ?? [], boneyardCount: state.boneyard.length, players: state.participantIds.map((id, seat) => { const item = match.participants.find((candidate: any) => candidate.id === id); return this.playerProjection(item, seat, state) }), scores: state.scores, roundScores: state.roundScores, targetScore: policy.targetScore, chainHash: state.chainHash, endsAt: state.endsAt, matchEndsAt: state.matchEndsAt, remainingSeconds: Math.max(0, Math.ceil((new Date(state.endsAt).getTime() - now) / 1000)), result: match.status === "FINISHED" || match.status === "SETTLED" ? { winnerParticipantId: state.participantIds.slice().sort((a, b) => (state.scores[b] ?? 0) - (state.scores[a] ?? 0))[0], scores: state.scores } : null }
  }
  private playerProjection(item: any, seat: number, state: DominoState | null) { return { participantId: item?.id, seat, userId: item?.userId ?? null, displayName: item?.user?.profile?.displayName ?? item?.user?.username ?? (item?.participantType === "BOT" ? `Bot ${seat + 1}` : "Player"), avatarUrl: item?.user?.profile?.avatarUrl ?? null, participantType: item?.participantType, handCount: state?.hands?.[item?.id]?.length ?? 0, score: state?.scores?.[item?.id] ?? item?.finalScore ?? 0, result: item?.result ?? "PENDING" } }
  private actionProjection(action: any) { return { accepted: action.accepted, sequence: action.sequence, actionType: action.actionType, reason: action.rejectionReason ?? undefined, payload: action.payload } }
  private async loadMatch(tx: Prisma.TransactionClient, matchId: string): Promise<MatchRow> { const match = await tx.match.findUnique({ where: { id: matchId }, include: { gameDefinition: true, gameConfig: true, settlement: true, participants: { include: { user: { include: { profile: true } } }, orderBy: { createdAt: "asc" } } } }); if (!match) throw new NotFoundException("Domino match not found"); if (match.gameDefinition.key !== "domino") throw new BadRequestException("This is not a Domino match"); return match }
  private authorize(match: MatchRow, userId: string) { const participant = match.participants.find((item: any) => item.userId === userId); if (!participant) throw new NotFoundException("Player is not a participant in this match"); return participant }
  private async lockMatch(tx: Prisma.TransactionClient, matchId: string) { await tx.$queryRaw`SELECT "id" FROM "Match" WHERE "id" = ${matchId} FOR UPDATE` }
}
