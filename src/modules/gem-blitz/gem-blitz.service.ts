import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common"
import { MatchParticipantResult, Prisma } from "@prisma/client"
import { PrismaService } from "../../prisma.service"
import { GemBlitzEngine, GemBlitzMove } from "./engine/gem-blitz-engine"
import { GemBlitzMoveDto } from "./dtos/gem-blitz.dto"

const RULES_VERSION = "gem-blitz.v1"
const BOARD_SIZE = 7
const DURATION_SECONDS = 75
const MAX_REPLAY_EVENTS = 100
type PlayerState = GemBlitzEngine["stateSnapshot"] & { sequence: number }
type GemState = { rulesVersion: string; seed: number; boardSize: number; durationSeconds: number; startedAt: string; endsAt: string; status: "ACTIVE" | "FINISHED"; players: Record<string, PlayerState>; replay: Array<Record<string, unknown>>; winnerParticipantId?: string | null }

@Injectable()
export class GemBlitzService {
  constructor(private readonly prisma: PrismaService) {}

  async snapshot(userId: string, matchId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockMatch(tx, matchId)
      const match = await this.loadMatch(tx, matchId)
      const participant = this.authorize(match, userId)
      let state = this.readState(match.metadata)
      if (state?.status === "ACTIVE" && Date.now() >= Date.parse(state.endsAt)) state = await this.finish(tx, match, state, null)
      return this.project(match, participant.id, state)
    })
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
      const existing = this.readState(match.metadata)
      if (ready.length < readiness.length && !existing) return { ...this.project(match, participant.id, null), waitingForPlayers: true, readyCount: ready.length, requiredCount: readiness.length }
      const state = existing ?? this.newState(match, readiness.map((item) => item.id), now)
      await tx.match.update({ where: { id: matchId }, data: { status: "STARTED", startedAt: match.startedAt ?? now, metadata: this.withState(match.metadata, state) } })
      await tx.matchRound.updateMany({ where: { matchId, status: "CREATED" }, data: { status: "STARTED", startedAt: now } })
      return this.project({ ...match, status: "STARTED", startedAt: match.startedAt ?? now, metadata: this.withState(match.metadata, state) }, participant.id, state)
    })
  }

  async move(userId: string, matchId: string, dto: GemBlitzMoveDto) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockMatch(tx, matchId)
      const match = await this.loadMatch(tx, matchId)
      const participant = this.authorize(match, userId)
      let state = this.readState(match.metadata)
      if (!state) throw new ConflictException("The match is waiting for all players to ready up")
      if (state.status === "FINISHED" || match.status === "FINISHED") return { ...this.project(match, participant.id, state), duplicate: true }
      if (Date.now() >= Date.parse(state.endsAt)) return this.project(match, participant.id, await this.finish(tx, match, state, null))
      const current = state.players[participant.id]
      if (!current) throw new ConflictException("Player state is unavailable")
      if (dto.sequence <= current.sequence) return { ...this.project(match, participant.id, state), duplicate: true }
      if (dto.sequence !== current.sequence + 1) throw new ConflictException("Move sequence is out of date; resync the match")
      const result = GemBlitzEngine.fromState(current).swap({ fromRow: dto.fromRow, fromColumn: dto.fromColumn, toRow: dto.toRow, toColumn: dto.toColumn, timestamp: dto.clientTimestamp ? Date.parse(dto.clientTimestamp) : Date.now() } as GemBlitzMove)
      if (!result.accepted) throw new BadRequestException(result.reason ?? "That move is not valid")
      const next = { ...result.board.stateSnapshot, sequence: dto.sequence }
      state = { ...state, players: { ...state.players, [participant.id]: next }, replay: [...state.replay, { sequence: dto.sequence, participantId: participant.id, fromRow: dto.fromRow, fromColumn: dto.fromColumn, toRow: dto.toRow, toColumn: dto.toColumn, scoreDelta: result.scoreDelta, cleared: result.cleared, cascades: result.cascades, acceptedAt: new Date().toISOString() }].slice(-MAX_REPLAY_EVENTS) }
      await tx.matchEvent.create({ data: { matchId, participantId: participant.id, eventType: "SCORE_UPDATE", sequence: dto.sequence, clientEventId: `gem-blitz:${participant.id}:${dto.sequence}`, payload: { fromRow: dto.fromRow, fromColumn: dto.fromColumn, toRow: dto.toRow, toColumn: dto.toColumn, scoreDelta: result.scoreDelta, cleared: result.cleared, cascades: result.cascades, score: next.score } as Prisma.InputJsonValue, accepted: true, clientOccurredAt: dto.clientTimestamp ? new Date(dto.clientTimestamp) : undefined } })
      const metadata = this.withState(match.metadata, state)
      await tx.match.update({ where: { id: matchId }, data: { metadata } })
      return { ...this.project({ ...match, metadata }, participant.id, state), move: { scoreDelta: result.scoreDelta, cleared: result.cleared, cascades: result.cascades, events: result.events, reshuffled: result.reshuffled } }
    })
  }

  async forfeit(userId: string, matchId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockMatch(tx, matchId)
      const match = await this.loadMatch(tx, matchId)
      const participant = this.authorize(match, userId)
      const state = this.readState(match.metadata)
      if (!state || state.status === "FINISHED") return this.project(match, participant.id, state)
      const finished = await this.finish(tx, match, state, participant.id)
      return this.project({ ...match, metadata: this.withState(match.metadata, finished) }, participant.id, finished)
    })
  }

  private async finish(tx: Prisma.TransactionClient, match: any, state: GemState, forfeitingParticipantId: string | null) {
    const participants = match.participants as Array<{ id: string; participantType: string }>
    const scores = participants.map((item) => ({ id: item.id, score: state.players[item.id]?.score ?? 0 }))
    const winner = forfeitingParticipantId ? scores.find((item) => item.id !== forfeitingParticipantId)?.id ?? null : scores.sort((a, b) => b.score - a.score)[0]?.id ?? null
    const tied = !forfeitingParticipantId && scores.length > 1 && scores.every((item) => item.score === scores[0].score)
    const finished = { ...state, status: "FINISHED" as const, winnerParticipantId: tied ? null : winner }
    const endedAt = new Date()
    await tx.match.update({ where: { id: match.id }, data: { status: "FINISHED", endedAt, metadata: this.withState(match.metadata, finished) } })
    await tx.matchRound.updateMany({ where: { matchId: match.id, status: { in: ["CREATED", "STARTED"] } }, data: { status: "FINISHED", endedAt } })
    for (const item of participants) {
      const result: MatchParticipantResult = forfeitingParticipantId === item.id ? "FORFEIT" : tied ? "DRAW" : item.id === winner ? "WIN" : "LOSS"
      await tx.matchParticipant.update({ where: { id: item.id }, data: { finalScore: state.players[item.id]?.score ?? 0, result, submittedAt: endedAt } })
    }
    return finished
  }

  private newState(match: any, participantIds: string[], now: Date): GemState {
    const seed = Math.abs(Number.parseInt(match.serverNonce.slice(0, 8), 16)) || 18421
    const players = Object.fromEntries(participantIds.map((id) => [id, { ...GemBlitzEngine.newGame(seed, BOARD_SIZE).stateSnapshot, sequence: 0 }]))
    return { rulesVersion: RULES_VERSION, seed, boardSize: BOARD_SIZE, durationSeconds: DURATION_SECONDS, startedAt: now.toISOString(), endsAt: new Date(now.getTime() + DURATION_SECONDS * 1000).toISOString(), status: "ACTIVE", players, replay: [] }
  }

  private readState(metadata: Prisma.JsonValue | null | undefined): GemState | null { if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null; const state = (metadata as Record<string, unknown>).gemBlitz; return state && typeof state === "object" ? state as GemState : null }
  private withState(metadata: Prisma.JsonValue | null | undefined, state: GemState): Prisma.InputJsonValue { const base = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata as Record<string, unknown> : {}; return { ...base, gemBlitz: state } as Prisma.InputJsonValue }
  private async lockMatch(tx: Prisma.TransactionClient, matchId: string) { await tx.$executeRaw`SELECT "id" FROM "Match" WHERE "id" = ${matchId} FOR UPDATE` }
  private async loadMatch(tx: Prisma.TransactionClient, matchId: string) {
    const match = await tx.match.findUnique({ where: { id: matchId }, include: { gameDefinition: { select: { key: true } }, participants: { select: { id: true, userId: true, participantType: true, readyAt: true, finalScore: true, result: true, user: { select: { username: true, profile: { select: { displayName: true, avatarUrl: true } } } } } }, rounds: { orderBy: { roundIndex: "desc" }, take: 1 } } })
    if (!match) throw new NotFoundException("Match not found")
    if (match.gameDefinition.key !== "gem_blitz") throw new BadRequestException("This is not a Gem Blitz match")
    return match
  }
  private authorize(match: any, userId: string) { const participant = match.participants.find((item: any) => item.userId === userId); if (!participant) throw new NotFoundException("Player is not a participant in this match"); return participant }
  private project(match: any, participantId: string, state: GemState | null) {
    const players = match.participants.map((item: any) => ({ participantId: item.id, userId: item.userId, participantType: item.participantType, name: item.user?.profile?.displayName || item.user?.username || "SMARTS bot", avatarUrl: item.user?.profile?.avatarUrl ?? null, score: state?.players[item.id]?.score ?? item.finalScore ?? 0, moves: state?.players[item.id]?.moves ?? 0, sequence: state?.players[item.id]?.sequence ?? 0, result: item.result }))
    const self = state?.players[participantId]
    return { matchId: match.id, selfParticipantId: participantId, status: state?.status === "FINISHED" ? "FINISHED" : match.status, rulesVersion: state?.rulesVersion ?? RULES_VERSION, seed: state?.seed ?? null, boardSize: state?.boardSize ?? BOARD_SIZE, durationSeconds: state?.durationSeconds ?? DURATION_SECONDS, startedAt: state?.startedAt ?? match.startedAt?.toISOString() ?? null, endsAt: state?.endsAt ?? null, serverNow: new Date().toISOString(), self: self ? { ...self, board: self.cells } : null, players, winnerParticipantId: state?.winnerParticipantId ?? null, replayLength: state?.replay.length ?? 0 }
  }
}
