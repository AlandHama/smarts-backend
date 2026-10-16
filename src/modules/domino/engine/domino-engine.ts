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
export type DominoState = {
  status: "ACTIVE" | "ROUND_COMPLETE" | "FINISHED"; seed: string; roundNumber: number; currentSeat: number
  participantIds: string[]; hands: Record<string, DominoTile[]>; boneyard: DominoTile[]; chain: DominoPlacedTile[]
  leftOpenValue: number | null; rightOpenValue: number | null; scores: Record<string, number>; roundScores: Record<string, number>
  nextSequence: Record<string, number>; consecutivePasses: number; chainHash: string; startedAt: string; endsAt: string
  matchEndsAt: string; roundWinnerParticipantId?: string | null; botNextActionAt?: Record<string, number>
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
  return createHash("sha256").update(JSON.stringify({ chain: state.chain, left: state.leftOpenValue, right: state.rightOpenValue, round: state.roundNumber })).digest("hex")
}

function openingTile(hands: Record<string, DominoTile[]>, participantIds: string[]) {
  const all = participantIds.flatMap((participantId, seat) => hands[participantId].map((value) => ({ value, participantId, seat })))
  return all.sort((left, right) => (isDouble(right.value) ? 1 : 0) - (isDouble(left.value) ? 1 : 0) || tilePips(right.value) - tilePips(left.value) || left.seat - right.seat || left.value.tileKey.localeCompare(right.value.tileKey))[0]
}

export function createInitialState(participantIds: string[], seed: string, policy: DominoPolicy, now = new Date()): DominoState {
  const shuffled = shuffleDeck(createDeck(), seed)
  const hands: Record<string, DominoTile[]> = {}
  participantIds.forEach((id) => { hands[id] = shuffled.splice(0, policy.handSize) })
  const boneyard = shuffled.slice(0, Math.max(0, policy.boneyardSize))
  const opening = openingTile(hands, participantIds)
  const openingIndex = hands[opening.participantId].findIndex((value) => value.tileKey === opening.value.tileKey)
  hands[opening.participantId].splice(openingIndex, 1)
  const startedAt = now.toISOString()
  const matchEndsAt = new Date(now.getTime() + policy.matchDurationSeconds * 1000).toISOString()
  const endsAt = new Date(now.getTime() + policy.roundDurationSeconds * 1000).toISOString()
  const state: DominoState = { status: "ACTIVE", seed, roundNumber: 1, currentSeat: (opening.seat + 1) % participantIds.length, participantIds, hands, boneyard, chain: [{ ...opening.value, side: "CENTER", orientation: "HORIZONTAL", playedByParticipantId: opening.participantId }], leftOpenValue: opening.value.a, rightOpenValue: opening.value.b, scores: Object.fromEntries(participantIds.map((id) => [id, 0])), roundScores: Object.fromEntries(participantIds.map((id) => [id, 0])), nextSequence: Object.fromEntries(participantIds.map((id) => [id, 1])), consecutivePasses: 0, chainHash: "", startedAt, endsAt, matchEndsAt, botNextActionAt: {} }
  state.chainHash = computeChainHash(state)
  return state
}

export function createNextRoundState(previous: DominoState, seed: string, policy: DominoPolicy, now = new Date()) {
  const next = createInitialState(previous.participantIds, seed, policy, now)
  next.roundNumber = previous.roundNumber + 1
  next.scores = { ...previous.scores }
  next.chainHash = computeChainHash(next)
  return next
}

export function legalMoves(state: DominoState, participantId: string) {
  const moves: Array<{ tile: DominoTile; side: DominoSide }> = []
  for (const value of state.hands[participantId] ?? []) {
    if (tileFits(value, state.leftOpenValue)) moves.push({ tile: value, side: "LEFT" })
    if (tileFits(value, state.rightOpenValue)) moves.push({ tile: value, side: "RIGHT" })
  }
  return moves
}

function orient(value: DominoTile, side: DominoSide, open: number | null): DominoTile {
  if (open === null || side === "LEFT") return value
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
  state.status = "ROUND_COMPLETE"
  return { winnerParticipantId: winner, points, blocked, pipTotals: values }
}

export function applyAction(input: DominoState, participantId: string, action: { type: DominoActionType; tileKey?: string; side?: DominoSide }, policy: DominoPolicy, now = new Date()) {
  const state = clone(input)
  const seat = state.participantIds.indexOf(participantId)
  if (seat < 0) return { accepted: false, reason: "NOT_A_PARTICIPANT", state }
  if (state.status !== "ACTIVE") return { accepted: false, reason: "ROUND_NOT_ACTIVE", state }
  if (state.currentSeat !== seat) return { accepted: false, reason: "NOT_YOUR_TURN", state }
  if (new Date(state.endsAt).getTime() <= now.getTime() || new Date(state.matchEndsAt).getTime() <= now.getTime()) return { accepted: false, reason: "TIME_EXPIRED", state }
  const hand = state.hands[participantId] ?? []
  if (action.type === "DRAW_TILE") {
    if (legalMoves(state, participantId).length) return { accepted: false, reason: "LEGAL_MOVE_AVAILABLE", state }
    if (!state.boneyard.length) return { accepted: false, reason: "BONEYARD_EMPTY", state }
    hand.push(state.boneyard.shift() as DominoTile)
  } else if (action.type === "PASS") {
    if (state.boneyard.length) return { accepted: false, reason: "DRAW_REQUIRED", state }
    if (legalMoves(state, participantId).length) return { accepted: false, reason: "LEGAL_MOVE_AVAILABLE", state }
    state.consecutivePasses += 1
    state.currentSeat = (seat + 1) % state.participantIds.length
    if (state.consecutivePasses >= state.participantIds.length) { state.chainHash = computeChainHash(state); return { accepted: true, state, round: scoreRound(state, null, true), event: { type: action.type } } }
  } else {
    const side = action.side
    const selected = hand.find((value) => value.tileKey === action.tileKey)
    if (!selected || !side) return { accepted: false, reason: "TILE_NOT_IN_HAND", state }
    if (!tileFits(selected, side === "LEFT" ? state.leftOpenValue : state.rightOpenValue)) return { accepted: false, reason: "TILE_DOES_NOT_MATCH", state }
    const placed = orient(selected, side, side === "LEFT" ? state.leftOpenValue : state.rightOpenValue)
    hand.splice(hand.findIndex((value) => value.tileKey === selected.tileKey), 1)
    const placedTile = { ...placed, side, orientation: placed.a === placed.b ? "VERTICAL" : "HORIZONTAL", playedByParticipantId: participantId } as DominoPlacedTile
    state.chain = side === "LEFT" ? [placedTile, ...state.chain] : [...state.chain, placedTile]
    if (side === "LEFT") state.leftOpenValue = placed.b
    else state.rightOpenValue = placed.b
    state.consecutivePasses = 0
    state.currentSeat = (seat + 1) % state.participantIds.length
    if (!hand.length) { state.chainHash = computeChainHash(state); return { accepted: true, state, round: scoreRound(state, participantId, false), event: { type: action.type, tileKey: selected.tileKey, side } } }
  }
  state.chainHash = computeChainHash(state)
  return { accepted: true, state, event: { type: action.type, tileKey: action.tileKey, side: action.side } }
}
