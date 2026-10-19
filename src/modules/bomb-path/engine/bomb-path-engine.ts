import { createHash } from "node:crypto"
import { BombPathPolicy, BombPathRoundSpec, BombPathRoundStatus, scoreBombPathRound } from "./bomb-path-score"

export interface BombPathPoint { row: number; column: number }
export interface BombPathField {
  roundIndex: number
  gridSize: number
  flag: BombPathPoint
  trophy: BombPathPoint
  bombs: BombPathPoint[]
  safePath: BombPathPoint[]
  shortestSafePathLength: number
  commitment: string
}

export interface BombPathPhaseState {
  phase: "MEMORIZE" | "PLAY" | "RESULT" | "COMPLETE"
  currentRoundIndex: number
  roundCount: number
  memorizeEndsAt: number
  playEndsAt: number
  resultEndsAt: number | null
}

const key = (point: BombPathPoint) => `${point.row}:${point.column}`
const same = (a: BombPathPoint, b: BombPathPoint) => a.row === b.row && a.column === b.column
const inside = (point: BombPathPoint, size: number) => point.row >= 0 && point.column >= 0 && point.row < size && point.column < size
const neighbors = (point: BombPathPoint, size: number): BombPathPoint[] => [{ row: point.row - 1, column: point.column }, { row: point.row + 1, column: point.column }, { row: point.row, column: point.column - 1 }, { row: point.row, column: point.column + 1 }].filter((item) => inside(item, size))

function unit(seed: string, index: number) {
  return Number.parseInt(createHash("sha256").update(`${seed}:${index}`).digest("hex").slice(0, 8), 16) / 0xffffffff
}

function shuffle<T>(items: T[], seed: string, offset: number) {
  const copy = [...items]
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const target = Math.floor(unit(seed, offset + index) * (index + 1))
    ;[copy[index], copy[target]] = [copy[target], copy[index]]
  }
  return copy
}

function makeSafePath(size: number, seed: string): BombPathPoint[] {
  const start = { row: 0, column: 0 }
  const goal = { row: size - 1, column: size - 1 }
  const path = [start]
  let current = start
  let step = 0
  while (!same(current, goal)) {
    const choices = [
      current.row < size - 1 ? { row: current.row + 1, column: current.column } : null,
      current.column < size - 1 ? { row: current.row, column: current.column + 1 } : null,
    ].filter((item): item is BombPathPoint => item !== null)
    const ordered = shuffle(choices, seed, step * 17 + current.row * 7 + current.column)
    current = ordered[0]
    path.push(current)
    step += 1
  }
  return path
}

function shortestSafePath(size: number, start: BombPathPoint, goal: BombPathPoint, bombs: Set<string>) {
  const queue: Array<{ point: BombPathPoint; distance: number }> = [{ point: start, distance: 1 }]
  const visited = new Set([key(start)])
  while (queue.length) {
    const item = queue.shift()!
    if (same(item.point, goal)) return item.distance
    for (const next of neighbors(item.point, size)) {
      if (bombs.has(key(next)) || visited.has(key(next))) continue
      visited.add(key(next)); queue.push({ point: next, distance: item.distance + 1 })
    }
  }
  return Number.POSITIVE_INFINITY
}

export function generateBombPathField(seed: string, spec: BombPathRoundSpec): BombPathField {
  const flag = { row: 0, column: 0 }
  const trophy = { row: spec.gridSize - 1, column: spec.gridSize - 1 }
  const safePath = makeSafePath(spec.gridSize, `${seed}:${spec.roundIndex}`)
  const protectedCells = new Set(safePath.map(key))
  const candidates: BombPathPoint[] = []
  for (let row = 0; row < spec.gridSize; row += 1) for (let column = 0; column < spec.gridSize; column += 1) if (!protectedCells.has(`${row}:${column}`)) candidates.push({ row, column })
  const bombs = shuffle(candidates, `${seed}:bombs`, spec.roundIndex * 100).slice(0, Math.min(spec.bombCount, candidates.length))
  const bombKeys = new Set(bombs.map(key))
  const shortest = shortestSafePath(spec.gridSize, flag, trophy, bombKeys)
  const canonical = bombPathFieldCanonical({ roundIndex: spec.roundIndex, gridSize: spec.gridSize, flag, trophy, bombs }, "bomb-path.v1", "bomb-path-field.v1")
  return { roundIndex: spec.roundIndex, gridSize: spec.gridSize, flag, trophy, bombs, safePath, shortestSafePathLength: shortest, commitment: createHash("sha256").update(canonical).digest("hex") }
}

export function bombPathFieldCanonical(field: Pick<BombPathField, "roundIndex" | "gridSize" | "flag" | "trophy" | "bombs">, rulesVersion: string, generationVersion: string) {
  return JSON.stringify({ rulesVersion, generationVersion, roundIndex: field.roundIndex, gridSize: field.gridSize, flag: field.flag, trophy: field.trophy, bombCells: [...field.bombs].sort((a, b) => key(a).localeCompare(key(b))) })
}

export type BombPathStepResult = { accepted: boolean; outcome: "SAFE" | "BACKTRACK" | "SUCCESS" | "BOMB" | "INVALID"; path: BombPathPoint[]; reason?: string }

export function validateBombPathStep(field: BombPathField, currentPath: BombPathPoint[], next: BombPathPoint, orthogonalOnly = true): BombPathStepResult {
  if (!inside(next, field.gridSize)) return { accepted: false, outcome: "INVALID", path: currentPath, reason: "Cell is outside the field" }
  if (!currentPath.length && !same(next, field.flag)) return { accepted: false, outcome: "INVALID", path: currentPath, reason: "Path must begin at the flag" }
  if (currentPath.length) {
    const previous = currentPath[currentPath.length - 1]
    const rowDelta = Math.abs(previous.row - next.row)
    const columnDelta = Math.abs(previous.column - next.column)
    const adjacent = orthogonalOnly ? rowDelta + columnDelta === 1 : rowDelta <= 1 && columnDelta <= 1 && rowDelta + columnDelta > 0
    if (!adjacent) return { accepted: false, outcome: "INVALID", path: currentPath, reason: "Only neighboring cells are allowed" }
    if (currentPath.length > 1 && same(next, currentPath[currentPath.length - 2])) return { accepted: true, outcome: "BACKTRACK", path: currentPath.slice(0, -1) }
    if (currentPath.some((item) => same(item, next))) return { accepted: false, outcome: "INVALID", path: currentPath, reason: "A cell cannot be revisited" }
  }
  if (field.bombs.some((bomb) => same(bomb, next))) return { accepted: true, outcome: "BOMB", path: [...currentPath, next] }
  const path = [...currentPath, next]
  if (same(next, field.trophy)) return { accepted: true, outcome: "SUCCESS", path }
  return { accepted: true, outcome: "SAFE", path }
}

export function validateCompletedBombPath(field: BombPathField, path: BombPathPoint[], orthogonalOnly = true) {
  if (!path.length) return { accepted: false, reason: "Path is empty" }
  let current: BombPathPoint[] = []
  for (const point of path) {
    const result = validateBombPathStep(field, current, point, orthogonalOnly)
    if (!result.accepted || result.outcome === "BOMB") return { accepted: false, reason: result.reason ?? result.outcome }
    current = result.path
  }
  if (!same(current[current.length - 1], field.trophy)) return { accepted: false, reason: "Path does not reach the trophy" }
  return { accepted: true, path: current }
}

export function advanceBombPathPhase(state: BombPathPhaseState, nowMs: number): { state: BombPathPhaseState; changed: boolean; complete: boolean } {
  if (state.phase === "MEMORIZE" && nowMs >= state.memorizeEndsAt) return { state: { ...state, phase: "PLAY" }, changed: true, complete: false }
  if (state.phase === "PLAY" && nowMs >= state.playEndsAt) return { state: { ...state, phase: "RESULT", resultEndsAt: state.resultEndsAt ?? nowMs }, changed: true, complete: false }
  if (state.phase === "RESULT" && state.resultEndsAt !== null && nowMs >= state.resultEndsAt) {
    if (state.currentRoundIndex >= state.roundCount - 1) return { state: { ...state, phase: "COMPLETE" }, changed: true, complete: true }
    return { state: { ...state, phase: "MEMORIZE", currentRoundIndex: state.currentRoundIndex + 1, resultEndsAt: null }, changed: true, complete: false }
  }
  return { state, changed: false, complete: state.phase === "COMPLETE" }
}

export function scoreBombPathSuccess(status: BombPathRoundStatus, elapsedMs: number, pathLength: number, field: BombPathField, spec: BombPathRoundSpec, policy: BombPathPolicy) {
  return scoreBombPathRound(status, elapsedMs, pathLength, field.shortestSafePathLength, spec, policy)
}

export function bombPathStateHash(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex") }

export function findSafePath(field: BombPathField) { return [...field.safePath] }
