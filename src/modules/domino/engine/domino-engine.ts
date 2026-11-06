import { createHash } from "node:crypto"

export type DominoSide = "LEFT" | "RIGHT"
export type DominoActionType = "PLAY_TILE" | "DRAW_TILE" | "PASS"
export type DominoOrientation = "HORIZONTAL" | "VERTICAL"

export type DominoTile = { tileKey: string; a: number; b: number }
export type DominoPlacedTile = DominoTile & { side: "CENTER" | DominoSide; orientation: DominoOrientation; playedByParticipantId: string }
export type DominoPolicy = {
  rulesVersion: string; scoreVersion: string; seatCount: number; handSize: number; boneyardSize: number
  targetScore: number; maxRounds: number; roundDurationSeconds: number; matchDurationSeconds: number
}
export type DominoRoundResult = { roundNumber: number; winnerParticipantId: string; points: number; blocked: boolean; pipTotals: Record<string, number> }
export type DominoState = {
  status: "ACTIVE" | "ROUND_COMPLETE" | "FINISHED"; seed: string; roundNumber: number; currentSeat: number
  participantIds: string[]; hands: Record<string, DominoTile[]>; boneyard: DominoTile[]; chain: DominoPlacedTile[]
  leftOpenValue: number | null; rightOpenValue: number | null; scores: Record<string, number>; roundScores: Record<string, number>
  nextSequence: Record<string, number>; consecutivePasses: number; chainHash: string; startedAt: string; endsAt: string
  matchEndsAt: string; roundWinnerParticipantId?: string | null; lastRoundResult?: DominoRoundResult
  /** Set while the clients display the completed round before dealing again. */
  nextRoundAt?: string | null; botNextActionAt?: Record<string, number>
}

const tile = (a: number, b: number): DominoTile => ({ tileKey: `${a}-${b}`, a, b })
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

export function createDeck() {
  const deck: DominoTile[] = []
  for (let a = 0; a <= 6; a += 1) for (let b = a; b <= 6; b += 1) deck.push(tile(a, b))
  return deck
}

function randomValue(seed: string, index: number) {
  const digest = createHash("sha256").update(`${seed}:${index}`).digest()
  return digest.readUInt32BE(0) / 0x100000000
}

export function shuffleDeck(deck: DominoTile[], seed: string) {
  const output = deck.map(clone)
  for (let index = output.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(randomValue(seed, output.length - index) * (index + 1))
    ;[output[index], output[swap]] = [output[swap], output[index]]
  }
  return output
}

export function tilePips(value: DominoTile) { return value.a + value.b }
export function isDouble(value: DominoTile) { return value.a === value.b }
export function tileFits(value: DominoTile, open: number | null) { return open === null || value.a === open || value.b === open }

export function computeChainHash(state: Pick<DominoState, "chain" | "leftOpenValue" | "rightOpenValue" | "roundNumber">) {
  const ends = exposedEnds(state)
  return createHash("sha256").update(JSON.stringify({ chain: state.chain, left: ends.left, right: ends.right, round: state.roundNumber })).digest("hex")
}

function openingTile(hands: Record<string, DominoTile[]>, participantIds: string[]) {
  const all = participantIds.flatMap((participantId, seat) => hands[participantId].map((value) => ({ value, participantId, seat })))
  return all.sort((left, right) => (isDouble(right.value) ? 1 : 0) - (isDouble(left.value) ? 1 : 0) || tilePips(right.value) - tilePips(left.value) || left.seat - right.seat || left.value.tileKey.localeCompare(right.value.tileKey))[0]
}

export function createInitialState(participantIds: string[], seed: string, policy: DominoPolicy, now = new Date()): DominoState {
  const shuffled = shuffleDeck(createDeck(), seed)
  const hands: Record<string, DominoTile[]> = {}
  participantIds.forEach((id) => { hands[id] = shuffled.splice(0, policy.handSize) })
  // Domino Duel deals the complete seven-tile hand. There is deliberately no
  // boneyard in this ruleset; a player with no legal move passes automatically.
  const boneyard: DominoTile[] = []
  const opening = openingTile(hands, participantIds)
  const startedAt = now.toISOString()
  const matchEndsAt = new Date(now.getTime() + policy.matchDurationSeconds * 1000).toISOString()
  const endsAt = new Date(now.getTime() + policy.roundDurationSeconds * 1000).toISOString()
  const state: DominoState = { status: "ACTIVE", seed, roundNumber: 1, currentSeat: opening.seat, participantIds, hands, boneyard, chain: [], leftOpenValue: null, rightOpenValue: null, scores: Object.fromEntries(participantIds.map((id) => [id, 0])), roundScores: Object.fromEntries(participantIds.map((id) => [id, 0])), nextSequence: Object.fromEntries(participantIds.map((id) => [id, 1])), consecutivePasses: 0, chainHash: "", startedAt, endsAt, matchEndsAt, botNextActionAt: {} }
  state.chainHash = computeChainHash(state)
  return state
}

export function createNextRoundState(previous: DominoState, seed: string, policy: DominoPolicy, now = new Date(), openingParticipantId?: string | null) {
  const next = createInitialState(previous.participantIds, seed, policy, now)
  next.roundNumber = previous.roundNumber + 1
  next.scores = { ...previous.scores }
  const openingSeat = openingParticipantId ? previous.participantIds.indexOf(openingParticipantId) : -1
  if (openingSeat >= 0) next.currentSeat = openingSeat
  // The previous round is intentionally exposed only during the transition
  // window. Keeping it on the new active round makes clients replay the same
  // winner animation every time they reconnect or poll.
  next.lastRoundResult = undefined
  next.roundWinnerParticipantId = undefined
  next.nextRoundAt = undefined
  next.chainHash = computeChainHash(next)
  return next
}

export function legalMoves(state: DominoState, participantId: string) {
  const ends = exposedEnds(state)
  const moves: Array<{ tile: DominoTile; side: DominoSide }> = []
  for (const value of state.hands[participantId] ?? []) {
    if (tileFits(value, ends.left)) moves.push({ tile: value, side: "LEFT" })
    if (tileFits(value, ends.right)) moves.push({ tile: value, side: "RIGHT" })
  }
  return moves
}

/**
 * The chain is the source of truth for exposed pips. Persisted endpoint
 * fields are projections and may be stale in matches created by older rules.
 */
export function exposedEnds(state: Pick<DominoState, "chain" | "leftOpenValue" | "rightOpenValue">) {
  if (!state.chain.length) return { left: null, right: null }
  return {
    left: state.chain[0].a,
    right: state.chain[state.chain.length - 1].b,
  }
}

/**
 * Advances players that cannot connect a tile. This is kept in the engine so
 * bot turns, API requests, and realtime snapshots all apply the same rule.
 */
export function skipBlockedTurns(state: DominoState) {
  while (state.status === "ACTIVE" && legalMoves(state, state.participantIds[state.currentSeat]).length === 0) {
    state.consecutivePasses += 1
    state.currentSeat = (state.currentSeat + 1) % state.participantIds.length
    if (state.consecutivePasses >= state.participantIds.length) return scoreRound(state, null, true)
  }
  return null
}

function orient(value: DominoTile, side: DominoSide, open: number | null): DominoTile {
  if (open === null) return value
  // The chain is stored from LEFT to RIGHT. A left placement therefore has
  // to end at the previous left open value, while a right placement has to
  // start at the previous right open value.
  if (side === "LEFT") return value.b === open ? value : { tileKey: value.tileKey, a: value.b, b: value.a }
  return value.a === open ? value : { tileKey: value.tileKey, a: value.b, b: value.a }
}

export function scoreRound(state: DominoState, winnerParticipantId: string | null, blocked: boolean) {
  const values = Object.fromEntries(state.participantIds.map((id) => [id, (state.hands[id] ?? []).reduce((sum, value) => sum + tilePips(value), 0)]))
  const winner = winnerParticipantId ?? state.participantIds.slice().sort((a, b) => values[a] - values[b] || state.participantIds.indexOf(a) - state.participantIds.indexOf(b))[0]
  const opponentPips = state.participantIds.filter((id) => id !== winner).reduce((sum, id) => sum + values[id], 0)
  const points = blocked ? Math.max(1, opponentPips - values[winner]) : Math.max(1, opponentPips)
  state.scores[winner] = (state.scores[winner] ?? 0) + Math.max(1, points)
  state.roundScores = Object.fromEntries(state.participantIds.map((id) => [id, id === winner ? Math.max(1, points) : 0]))
  state.roundWinnerParticipantId = winner
  state.lastRoundResult = { roundNumber: state.roundNumber, winnerParticipantId: winner, points: Math.max(1, points), blocked, pipTotals: values }
  state.status = "ROUND_COMPLETE"
  return { winnerParticipantId: winner, points, blocked, pipTotals: values }
}

export function applyAction(input: DominoState, participantId: string, action: { type: DominoActionType; tileKey?: string; side?: DominoSide }, policy: DominoPolicy, now = new Date()) {
  const state = clone(input)
  const ends = exposedEnds(state)
  state.leftOpenValue = ends.left
  state.rightOpenValue = ends.right
  const seat = state.participantIds.indexOf(participantId)
  if (seat < 0) return { accepted: false, reason: "NOT_A_PARTICIPANT", state }
  if (state.status !== "ACTIVE") return { accepted: false, reason: "ROUND_NOT_ACTIVE", state }
  if (state.currentSeat !== seat) return { accepted: false, reason: "NOT_YOUR_TURN", state }
  if (new Date(state.endsAt).getTime() <= now.getTime() || new Date(state.matchEndsAt).getTime() <= now.getTime()) return { accepted: false, reason: "TIME_EXPIRED", state }
  const hand = state.hands[participantId] ?? []
  if (action.type === "DRAW_TILE") {
    return { accepted: false, reason: "DRAW_DISABLED", state }
  } else if (action.type === "PASS") {
    if (legalMoves(state, participantId).length) return { accepted: false, reason: "LEGAL_MOVE_AVAILABLE", state }
    state.consecutivePasses += 1
    state.currentSeat = (seat + 1) % state.participantIds.length
    if (state.consecutivePasses >= state.participantIds.length) { state.chainHash = computeChainHash(state); return { accepted: true, state, round: scoreRound(state, null, true), event: { type: action.type } } }
  } else {
    const side = action.side
    const selected = hand.find((value) => value.tileKey === action.tileKey)
    if (!selected || !side) return { accepted: false, reason: "TILE_NOT_IN_HAND", state }
    if (!tileFits(selected, side === "LEFT" ? ends.left : ends.right)) return { accepted: false, reason: "TILE_DOES_NOT_MATCH", state }
    const placed = orient(selected, side, side === "LEFT" ? ends.left : ends.right)
    hand.splice(hand.findIndex((value) => value.tileKey === selected.tileKey), 1)
    const placedTile = { ...placed, side: state.chain.length ? side : "CENTER", orientation: placed.a === placed.b ? "VERTICAL" : "HORIZONTAL", playedByParticipantId: participantId } as DominoPlacedTile
    if (!state.chain.length) {
      state.chain = [placedTile]
      state.leftOpenValue = placed.a
      state.rightOpenValue = placed.b
    } else {
      state.chain = side === "LEFT" ? [placedTile, ...state.chain] : [...state.chain, placedTile]
      if (side === "LEFT") state.leftOpenValue = placed.a
      else state.rightOpenValue = placed.b
    }
    state.consecutivePasses = 0
    state.currentSeat = (seat + 1) % state.participantIds.length
    if (!hand.length) { state.chainHash = computeChainHash(state); return { accepted: true, state, round: scoreRound(state, participantId, false), event: { type: action.type, tileKey: selected.tileKey, side } } }
  }
  state.chainHash = computeChainHash(state)
  return { accepted: true, state, event: { type: action.type, tileKey: action.tileKey, side: action.side } }
}
