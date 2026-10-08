export enum TileRushSpecial {
  None = "none",
  Blast = "blast",
  Lightning = "lightning",
  Prism = "prism",
  ColorCrush = "colorCrush",
}

export interface TileRushPoint {
  row: number
  column: number
}

export interface TileRushPolicy {
  boardSize?: number
  tileTypes?: number
  durationSeconds?: number
  minimumChain?: number
  comboWindowMs?: number
  finalRushEndsAtMs?: number
  finalRushMultiplier?: number
  loopsEnabled?: boolean
  loopMinimumLength?: number
  special5Threshold?: number
  special7Threshold?: number
  prismThreshold?: number
  scoreCap?: number
  scoring?: {
    scoreCap?: number
    chainTable?: Record<string, number>
    specialBonuses?: Record<string, number>
    cascadeMultipliers?: number[]
    refillCascadeLimit?: number
  }
}

export interface TileRushPlayerState {
  seed: number
  board: number[][]
  randomState: number
  score: number
  sequence: number
  combo: number
  lastActionTimestamp: number
  bestChain: number
  longestCombo: number
  tilesCleared: number
  colorCrushes: number
  nextBotAt?: number
}

export interface TileRushActionResult {
  accepted: boolean
  player: TileRushPlayerState
  scoreDelta: number
  totalScore: number
  chainLength: number
  combo: number
  special: TileRushSpecial
  clearedCells: TileRushPoint[]
  cascadeCount: number
  boardHash: string
  reason?: string
}

export interface TileRushPathCandidate {
  path: TileRushPoint[]
  length: number
  isLoop: boolean
}

class SeededRandom {
  private state: number

  constructor(seed: number, state?: number) {
    this.state = ((state ?? seed) || 0x6d2b79f5) & 0x7fffffff
  }

  get snapshot() { return this.state }

  nextInt(max: number) {
    this.state = (1103515245 * this.state + 12345) & 0x7fffffff
    return this.state % max
  }

  nextFloat() { return this.nextInt(1000000) / 1000000 }
}

const copyBoard = (board: number[][]) => board.map((row) => [...row])
const copyPoint = (point: TileRushPoint): TileRushPoint => ({ row: point.row, column: point.column })
const pointKey = (point: TileRushPoint) => `${point.row}:${point.column}`

/**
 * Server-side deterministic Tile Rush rules.
 *
 * It accepts only a path intent and derives score, specials, combo state,
 * refill state, and the next board. It never trusts a client score or board.
 */
export class TileRushEngine {
  private constructor(
    readonly seed: number,
    readonly boardSize: number,
    readonly tileTypes: number,
    readonly minimumChain: number,
    readonly comboWindowMs: number,
    readonly loopsEnabled: boolean,
    private readonly boardCells: number[][],
    private readonly random: SeededRandom,
    private scoreValue = 0,
    private comboValue = 0,
    private lastActionValue = 0,
    private bestChainValue = 0,
    private longestComboValue = 0,
    private tilesClearedValue = 0,
    private colorCrushesValue = 0,
    private readonly policy: TileRushPolicy = {},
  ) {}

  static newGame(seed = 18421, requestedSize = 7, policy: TileRushPolicy = {}): TileRushEngine {
    const size = clampInt(policy.boardSize ?? requestedSize, 5, 9, 7)
    const types = clampInt(policy.tileTypes ?? 5, 3, 8, 5)
    const minimum = clampInt(policy.minimumChain ?? 3, 3, 5, 3)
    for (let attempt = 0; attempt < 64; attempt += 1) {
      const random = new SeededRandom(seed + attempt * 7919)
      const cells = this.generateBoard(size, types, random)
      const engine = new TileRushEngine(seed, size, types, minimum, Number(policy.comboWindowMs ?? 2000), policy.loopsEnabled ?? true, cells, new SeededRandom(seed ^ 0x45d9f3b), 0, 0, 0, 0, 0, 0, 0, policy)
      if (engine.findPlayablePath() !== null) return engine
    }
    const random = new SeededRandom(seed ^ 0x45d9f3b)
    const fallback = this.generateBoard(size, types, random)
    for (let column = 0; column < minimum; column += 1) fallback[0][column] = 0
    return new TileRushEngine(seed, size, types, minimum, Number(policy.comboWindowMs ?? 2000), policy.loopsEnabled ?? true, fallback, new SeededRandom(seed ^ 0x45d9f3b), 0, 0, 0, 0, 0, 0, 0, policy)
  }

  static fromState(state: TileRushPlayerState, policy: TileRushPolicy = {}): TileRushEngine {
    if (!Array.isArray(state.board) || state.board.length === 0 || state.board.some((row) => !Array.isArray(row) || row.length !== state.board.length)) throw new Error("Tile Rush board must be a non-empty square")
    const size = state.board.length
    const types = clampInt(policy.tileTypes ?? 5, 3, 8, 5)
    if (state.board.some((row) => row.some((tile) => !Number.isInteger(tile) || tile < 0 || tile >= types))) throw new Error("Tile Rush board contains an unknown tile")
    return new TileRushEngine(state.seed, size, types, clampInt(policy.minimumChain ?? 3, 3, 5, 3), Number(policy.comboWindowMs ?? 2000), policy.loopsEnabled ?? true, copyBoard(state.board), new SeededRandom(state.seed ^ 0x45d9f3b, state.randomState), state.score, state.combo, state.lastActionTimestamp, state.bestChain, state.longestCombo, state.tilesCleared, state.colorCrushes, policy)
  }

  get stateSnapshot(): TileRushPlayerState {
    return {
      seed: this.seed,
      board: copyBoard(this.boardCells),
      randomState: this.random.snapshot,
      score: this.scoreValue,
      sequence: 0,
      combo: this.comboValue,
      lastActionTimestamp: this.lastActionValue,
      bestChain: this.bestChainValue,
      longestCombo: this.longestComboValue,
      tilesCleared: this.tilesClearedValue,
      colorCrushes: this.colorCrushesValue,
    }
  }

  snapshot(sequence = 0, nextBotAt?: number): TileRushPlayerState {
    return { ...this.stateSnapshot, sequence, ...(nextBotAt === undefined ? {} : { nextBotAt }) }
  }

  get score() { return this.scoreValue }
  get combo() { return this.comboValue }
  get board() { return copyBoard(this.boardCells) }
  get boardHash() { return this.boardCells.flat().join(",") }
  get hasValidPath() { return this.findPlayablePath() !== null }

  scoreForChain(length: number) {
    const configured = this.policy.scoring?.chainTable?.[String(length)]
    if (typeof configured === "number" && Number.isFinite(configured)) return Math.max(0, Math.trunc(configured))
    if (length <= 3) return 100
    if (length === 4) return 160
    if (length === 5) return 240
    if (length === 6) return 340
    if (length === 7) return 470
    if (length === 8) return 630
    if (length === 9) return 820
    if (length === 10) return 1050
    const extra = length - 10
    return 1050 + extra * 260 + extra * (extra - 1) * 20
  }

  /** Returns real same-type paths for the casual bot; no fabricated scores. */
  candidatePaths(limit = 160): TileRushPathCandidate[] {
    const found: TileRushPathCandidate[] = []
    const seen = new Set<string>()
    for (let row = 0; row < this.boardSize && found.length < limit; row += 1) {
      for (let column = 0; column < this.boardSize && found.length < limit; column += 1) {
        this.walkPaths([{ row, column }], new Set([`${row}:${column}`]), found, seen, limit)
      }
    }
    return found.sort((first, second) => {
      const specialWeight = (candidate: TileRushPathCandidate) => candidate.isLoop ? 4 : candidate.length >= 10 ? 3 : candidate.length >= 7 ? 2 : candidate.length >= 5 ? 1 : 0
      return second.length - first.length || specialWeight(second) - specialWeight(first)
    })
  }

  resolvePath(path: TileRushPoint[], timestamp = Date.now()): TileRushActionResult {
    const reason = this.validatePath(path)
    if (reason) return { accepted: false, player: this.snapshot(), scoreDelta: 0, totalScore: this.scoreValue, chainLength: 0, combo: this.comboValue, special: TileRushSpecial.None, clearedCells: [], cascadeCount: 0, boardHash: this.boardHash, reason }
    const loop = path.length > 1 && pointKey(path[0]) === pointKey(path[path.length - 1])
    const uniquePath = loop ? path.slice(0, -1) : path
    const tile = this.boardCells[uniquePath[0].row][uniquePath[0].column]
    const special = this.specialFor(uniquePath.length, loop)
    const cleared = new Map<string, TileRushPoint>()
    for (const point of uniquePath) cleared.set(pointKey(point), copyPoint(point))
    if (special === TileRushSpecial.ColorCrush || special === TileRushSpecial.Prism) {
      for (let row = 0; row < this.boardSize; row += 1) for (let column = 0; column < this.boardSize; column += 1) if (this.boardCells[row][column] === tile) cleared.set(`${row}:${column}`, { row, column })
    } else if (special === TileRushSpecial.Blast) {
      const center = uniquePath[Math.floor(uniquePath.length / 2)]
      for (let row = center.row - 1; row <= center.row + 1; row += 1) for (let column = center.column - 1; column <= center.column + 1; column += 1) if (this.inside(row, column)) cleared.set(`${row}:${column}`, { row, column })
    } else if (special === TileRushSpecial.Lightning) {
      const horizontal = this.horizontalEdges(uniquePath) >= this.verticalEdges(uniquePath)
      if (horizontal) { const row = uniquePath[Math.floor(uniquePath.length / 2)].row; for (let column = 0; column < this.boardSize; column += 1) cleared.set(`${row}:${column}`, { row, column }) } else { const column = uniquePath[Math.floor(uniquePath.length / 2)].column; for (let row = 0; row < this.boardSize; row += 1) cleared.set(`${row}:${column}`, { row, column }) }
    }

    const previousScore = this.scoreValue
    this.comboValue = this.lastActionValue > 0 && timestamp - this.lastActionValue <= this.comboWindowMs ? Math.min(5, this.comboValue + 1) : 1
    this.lastActionValue = timestamp
    this.bestChainValue = Math.max(this.bestChainValue, uniquePath.length)
    this.longestComboValue = Math.max(this.longestComboValue, this.comboValue)
    const comboMultiplier = 1 + Math.min(9, Math.max(0, this.comboValue - 1)) * 0.05
    const specialMultiplier = this.policy.scoring?.specialBonuses?.[special] ?? ({ [TileRushSpecial.None]: 1, [TileRushSpecial.Blast]: 1.2, [TileRushSpecial.Lightning]: 1.35, [TileRushSpecial.Prism]: 1.5, [TileRushSpecial.ColorCrush]: 1.55 }[special] ?? 1)
    const finalRushMultiplier = Number(this.policy.finalRushEndsAtMs && timestamp >= this.policy.finalRushEndsAtMs ? this.policy.finalRushMultiplier ?? 1 : 1)
    let points = Math.round(this.scoreForChain(uniquePath.length) * comboMultiplier * specialMultiplier * (Number.isFinite(finalRushMultiplier) ? finalRushMultiplier : 1))
    if (special === TileRushSpecial.ColorCrush) this.colorCrushesValue += 1
    for (const point of cleared.values()) this.boardCells[point.row][point.column] = -1
    this.refill()
    let cascadeCount = 0
    const cascadeLimit = clampInt(this.policy.scoring?.refillCascadeLimit ?? 6, 0, 12, 6)
    const cascadeMultipliers = this.policy.scoring?.cascadeMultipliers ?? [0.5, 0.65, 0.8, 1]
    while (cascadeCount < cascadeLimit) {
      const automatic = this.findAutomaticMatches()
      if (!automatic.length) break
      cascadeCount += 1
      for (const point of automatic) { cleared.set(pointKey(point), copyPoint(point)); this.boardCells[point.row][point.column] = -1 }
      const multiplier = Number(cascadeMultipliers[Math.min(cascadeCount - 1, cascadeMultipliers.length - 1)] ?? 0.5)
      points += Math.round(this.scoreForChain(Math.max(this.minimumChain, automatic.length)) * (Number.isFinite(multiplier) ? multiplier : 0.5))
      this.refill()
    }
    // Refilling can produce a dead board without producing an automatic
    // match. Keep every active board playable while the timer is running.
    this.ensurePlayablePath()
    const cap = Number(this.policy.scoreCap ?? Number.MAX_SAFE_INTEGER)
    this.scoreValue = Math.min(Number.isFinite(cap) ? cap : Number.MAX_SAFE_INTEGER, this.scoreValue + points)
    this.tilesClearedValue += cleared.size
    const player = this.snapshot()
    return { accepted: true, player, scoreDelta: this.scoreValue - previousScore, totalScore: this.scoreValue, chainLength: uniquePath.length, combo: this.comboValue, special, clearedCells: [...cleared.values()], cascadeCount, boardHash: this.boardHash }
  }

  private validatePath(path: TileRushPoint[]) {
    if (!Array.isArray(path) || path.length < this.minimumChain) return `Choose at least ${this.minimumChain} tiles`
    if (path.some((point) => !point || !Number.isInteger(point.row) || !Number.isInteger(point.column) || !this.inside(point.row, point.column))) return "Tile is outside the board"
    const loop = pointKey(path[0]) === pointKey(path[path.length - 1])
    const unique = loop ? path.slice(0, -1) : path
    const keys = unique.map(pointKey)
    if (new Set(keys).size !== keys.length) return "A tile can only be used once"
    if (loop && (!this.loopsEnabled || unique.length < clampInt(this.policy.loopMinimumLength ?? 4, 4, this.boardSize * this.boardSize, 4))) return "That loop is too short"
    const expected = this.boardCells[unique[0].row][unique[0].column]
    if (unique.some((point) => this.boardCells[point.row][point.column] !== expected)) return "Choose tiles of the same color"
    for (let index = 1; index < path.length; index += 1) if (!this.adjacent(path[index - 1], path[index])) return "Tiles must touch orthogonally"
    return undefined
  }

  private specialFor(length: number, loop: boolean) {
    if (loop) return TileRushSpecial.ColorCrush
    if (length >= clampInt(this.policy.prismThreshold ?? 10, 10, 49, 10)) return TileRushSpecial.Prism
    if (length >= clampInt(this.policy.special7Threshold ?? 7, 7, 48, 7)) return TileRushSpecial.Lightning
    if (length >= clampInt(this.policy.special5Threshold ?? 5, 5, 47, 5)) return TileRushSpecial.Blast
    return TileRushSpecial.None
  }

  private refill() {
    for (let column = 0; column < this.boardSize; column += 1) {
      const survivors: number[] = []
      for (let row = this.boardSize - 1; row >= 0; row -= 1) if (this.boardCells[row][column] >= 0) survivors.push(this.boardCells[row][column])
      for (let row = this.boardSize - 1, index = 0; row >= 0; row -= 1, index += 1) this.boardCells[row][column] = index < survivors.length ? survivors[index] : this.random.nextInt(this.tileTypes)
    }
  }

  private ensurePlayablePath() {
    if (this.findPlayablePath() !== null) return

    const original = copyBoard(this.boardCells)
    const restore = (base: number[][]) => {
      for (let row = 0; row < this.boardSize; row += 1) {
        for (let column = 0; column < this.boardSize; column += 1) {
          this.boardCells[row][column] = base[row][column]
        }
      }
    }
    const validCandidate = () => this.findAutomaticMatches().length === 0 && this.findPlayablePath() !== null

    const tryRepairFrom = (base: number[][]) => {
      for (const path of this.repairPathCandidates()) {
        for (let tile = 0; tile < this.tileTypes; tile += 1) {
          restore(base)
          for (const point of path) this.boardCells[point.row][point.column] = tile
          if (validCandidate()) return true
        }
      }
      return false
    }

    if (tryRepairFrom(original)) return

    for (let attempt = 0; attempt < 64; attempt += 1) {
      const generated = TileRushEngine.generateBoard(this.boardSize, this.tileTypes, this.random)
      if (tryRepairFrom(generated)) return
    }
    restore(original)
  }

  private repairPathCandidates() {
    const paths: TileRushPoint[][] = []
    const rowSpan = Math.floor((this.minimumChain - 1) / 2)
    const columnSpan = Math.floor(this.minimumChain / 2)
    for (let row = 0; row + rowSpan < this.boardSize; row += 1) {
      for (let column = 0; column + columnSpan < this.boardSize; column += 1) {
        paths.push(Array.from({ length: this.minimumChain }, (_, index) => ({ row: row + Math.floor(index / 2), column: column + Math.floor((index + 1) / 2) })))
        if (row + columnSpan < this.boardSize && column + rowSpan < this.boardSize) {
          paths.push(Array.from({ length: this.minimumChain }, (_, index) => ({ row: row + Math.floor((index + 1) / 2), column: column + Math.floor(index / 2) })))
        }
      }
    }
    return paths
  }

  private findAutomaticMatches() {
    const matches = new Map<string, TileRushPoint>()
    for (let row = 0; row < this.boardSize; row += 1) { let start = 0; while (start < this.boardSize) { let end = start + 1; while (end < this.boardSize && this.boardCells[row][end] === this.boardCells[row][start]) end += 1; if (this.boardCells[row][start] >= 0 && end - start >= this.minimumChain) for (let column = start; column < end; column += 1) matches.set(`${row}:${column}`, { row, column }); start = end } }
    for (let column = 0; column < this.boardSize; column += 1) { let start = 0; while (start < this.boardSize) { let end = start + 1; while (end < this.boardSize && this.boardCells[end][column] === this.boardCells[start][column]) end += 1; if (this.boardCells[start][column] >= 0 && end - start >= this.minimumChain) for (let row = start; row < end; row += 1) matches.set(`${row}:${column}`, { row, column }); start = end } }
    return [...matches.values()]
  }

  private walkPaths(path: TileRushPoint[], used: Set<string>, found: TileRushPathCandidate[], seen: Set<string>, limit: number) {
    if (path.length >= this.minimumChain) {
      const normalKey = path.map(pointKey).join("|")
      if (!seen.has(normalKey)) { seen.add(normalKey); found.push({ path: path.map(copyPoint), length: path.length, isLoop: false }) }
    }
    if (found.length >= limit || path.length >= this.boardSize * this.boardSize) return
    const current = path[path.length - 1]
    const start = path[0]
    for (const next of this.neighbours(current)) {
      const key = pointKey(next)
      if (next.row === start.row && next.column === start.column && this.loopsEnabled && path.length >= 4) {
        const loopPath = [...path, next]
        const loopKey = loopPath.map(pointKey).join("|")
        if (!seen.has(loopKey)) { seen.add(loopKey); found.push({ path: loopPath, length: path.length, isLoop: true }) }
        continue
      }
      if (used.has(key) || this.boardCells[next.row][next.column] !== this.boardCells[start.row][start.column]) continue
      used.add(key); path.push(next); this.walkPaths(path, used, found, seen, limit); path.pop(); used.delete(key)
      if (found.length >= limit) return
    }
  }

  private findStraightPath(): TileRushPathCandidate | null {
    for (let row = 0; row < this.boardSize; row += 1) for (let column = 0; column < this.boardSize; column += 1) {
      const tile = this.boardCells[row][column]
      if (column + this.minimumChain <= this.boardSize && Array.from({ length: this.minimumChain }, (_, offset) => this.boardCells[row][column + offset]).every((value) => value === tile)) return { path: Array.from({ length: this.minimumChain }, (_, offset) => ({ row, column: column + offset })), length: this.minimumChain, isLoop: false }
      if (row + this.minimumChain <= this.boardSize && Array.from({ length: this.minimumChain }, (_, offset) => this.boardCells[row + offset][column]).every((value) => value === tile)) return { path: Array.from({ length: this.minimumChain }, (_, offset) => ({ row: row + offset, column })), length: this.minimumChain, isLoop: false }
    }
    return null
  }

  private findPlayablePath(): TileRushPathCandidate | null {
    const found: TileRushPathCandidate[] = []
    for (let row = 0; row < this.boardSize && found.length === 0; row += 1) {
      for (let column = 0; column < this.boardSize && found.length === 0; column += 1) {
        this.walkPaths([{ row, column }], new Set([`${row}:${column}`]), found, new Set(), 1)
      }
    }
    return found[0] ?? null
  }

  private neighbours(point: TileRushPoint) { return [{ row: point.row - 1, column: point.column }, { row: point.row + 1, column: point.column }, { row: point.row, column: point.column - 1 }, { row: point.row, column: point.column + 1 }].filter((candidate) => this.inside(candidate.row, candidate.column)) }
  private inside(row: number, column: number) { return row >= 0 && row < this.boardSize && column >= 0 && column < this.boardSize }
  private adjacent(first: TileRushPoint, second: TileRushPoint) { return Math.abs(first.row - second.row) + Math.abs(first.column - second.column) === 1 }
  private horizontalEdges(path: TileRushPoint[]) { return path.slice(1).filter((point, index) => point.row === path[index].row).length }
  private verticalEdges(path: TileRushPoint[]) { return path.slice(1).filter((point, index) => point.column === path[index].column).length }

  private static generateBoard(size: number, types: number, random: SeededRandom) {
    const board = Array.from({ length: size }, () => Array<number>(size).fill(0))
    for (let row = 0; row < size; row += 1) for (let column = 0; column < size; column += 1) {
      const candidates = Array.from({ length: types }, (_, index) => index)
      for (let index = candidates.length - 1; index > 0; index -= 1) { const swap = random.nextInt(index + 1); [candidates[index], candidates[swap]] = [candidates[swap], candidates[index]] }
      board[row][column] = candidates.find((tile) => !(column >= 2 && board[row][column - 1] === tile && board[row][column - 2] === tile) && !(row >= 2 && board[row - 1][column] === tile && board[row - 2][column] === tile)) ?? candidates[0]
    }
    return board
  }
}

function clampInt(value: number, minimum: number, maximum: number, fallback: number) {
  const number = Number(value)
  return Number.isInteger(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback
}
