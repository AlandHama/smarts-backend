export enum GemType {
  Ruby = "ruby",
  Sapphire = "sapphire",
  Emerald = "emerald",
  Amethyst = "amethyst",
  Citrine = "citrine",
  Aqua = "aqua",
}

export enum GemSpecial {
  None = "none",
  RocketHorizontal = "rocketHorizontal",
  RocketVertical = "rocketVertical",
  Bomb = "bomb",
  ColorBomb = "colorBomb",
}

export interface GemTile {
  type: GemType
  special: GemSpecial
}

export interface GemBlitzMove {
  fromRow: number
  fromColumn: number
  toRow: number
  toColumn: number
  timestamp?: number
}

export type GemBlitzRulesPolicy = { scoring?: { scoreCap?: number; feverThreshold?: number; feverMultiplier?: number; fastMoveWindowMs?: number; cascadeMultipliers?: number[] } }

export interface GemBlitzMoveResult {
  accepted: boolean
  board: GemBlitzEngine
  scoreDelta: number
  cleared: number
  cascades: number
  speedCombo: number
  fever: boolean
  specialCreated?: GemSpecial
  events: string[]
  animation: GemBlitzAnimationStep[]
  reason?: string
  reshuffled: boolean
}

export interface GemBlitzAnimationStep {
  cascade: number
  before: GemTile[]
  cleared: number[]
  after: GemTile[]
}

interface GemGroup {
  cells: number[]
  special: GemSpecial
}

class SeededRandom {
  private state: number

  constructor(seed: number, state?: number) {
    this.state = (state ?? seed) & 0x7fffffff
  }

  get snapshot() { return this.state }

  nextInt(max: number): number {
    this.state = (1103515245 * this.state + 12345) & 0x7fffffff
    return this.state % max
  }
}

const GEM_TYPES = Object.values(GemType)

/**
 * Pure deterministic Gem Blitz rules engine for Phase 1 and shared fixtures.
 * It deliberately has no NestJS, Prisma, socket, or HTTP dependency.
 */
export class GemBlitzEngine {
  private constructor(
    readonly seed: number,
    readonly rows: number,
    readonly columns: number,
    private readonly cells: Array<GemTile | null>,
    private readonly random: SeededRandom,
    readonly score = 0,
    readonly moves = 0,
    readonly speedCombo = 0,
    readonly fever = false,
    readonly lastMoveTimestamp = 0,
    private readonly rulesPolicy: GemBlitzRulesPolicy = {},
  ) {}

  static newGame(seed = 18421, requestedSize = 7, rulesPolicy: GemBlitzRulesPolicy = {}): GemBlitzEngine {
    const size = Math.max(5, Math.min(9, Math.trunc(requestedSize)))

    for (let attempt = 0; attempt < 100; attempt += 1) {
      const random = new SeededRandom(seed + attempt * 7919)
      const cells: Array<GemTile | null> = Array(size * size).fill(null)
      for (let row = 0; row < size; row += 1) {
        for (let column = 0; column < size; column += 1) {
          cells[row * size + column] = this.randomTile(random, cells, size, row, column)
        }
      }

      const engine = new GemBlitzEngine(
        seed,
        size,
        size,
        cells,
        new SeededRandom(seed ^ 0x45d9f3b), 0, 0, 0, false, 0, rulesPolicy,
      )
      if (engine.hasLegalMove) return engine
    }

    const fallback = Array.from({ length: size * size }, (_, index) => ({
      type: GEM_TYPES[(index * 2 + Math.floor(index / size)) % GEM_TYPES.length],
      special: GemSpecial.None,
    }))
    return new GemBlitzEngine(
      seed,
      size,
      size,
      fallback,
      new SeededRandom(seed ^ 0x45d9f3b), 0, 0, 0, false, 0, rulesPolicy,
    )
  }

  static fromCells(seed: number, size: number, cells: GemTile[]): GemBlitzEngine {
    if (cells.length !== size * size) {
      throw new Error("Gem Blitz board must contain size × size cells")
    }
    return new GemBlitzEngine(
      seed,
      size,
      size,
      cells.map((cell) => ({ ...cell })),
      new SeededRandom(seed ^ 0x45d9f3b),
    )
  }

  static fromState(state: {
    seed: number
    size: number
    cells: GemTile[]
    score?: number
    moves?: number
    speedCombo?: number
    fever?: boolean
    lastMoveTimestamp?: number
    randomState?: number
  }, rulesPolicy: GemBlitzRulesPolicy = {}): GemBlitzEngine {
    if (state.cells.length !== state.size * state.size) throw new Error("Gem Blitz board must contain size × size cells")
    return new GemBlitzEngine(state.seed, state.size, state.size, state.cells.map((cell) => ({ ...cell })), new SeededRandom(state.seed ^ 0x45d9f3b, state.randomState), state.score ?? 0, state.moves ?? 0, state.speedCombo ?? 0, state.fever ?? false, state.lastMoveTimestamp ?? 0, rulesPolicy)
  }

  get stateSnapshot() {
    return { seed: this.seed, size: this.rows, cells: this.board.map((cell) => ({ ...cell })), score: this.score, moves: this.moves, speedCombo: this.speedCombo, fever: this.fever, lastMoveTimestamp: this.lastMoveTimestamp, randomState: this.random.snapshot }
  }

  get board(): readonly GemTile[] {
    return this.cells.map((cell) => cell ?? { type: GemType.Aqua, special: GemSpecial.None })
  }

  get hasLegalMove(): boolean {
    for (let row = 0; row < this.rows; row += 1) {
      for (let column = 0; column < this.columns; column += 1) {
        if (column + 1 < this.columns && this.wouldCreateMatch(row, column, row, column + 1)) return true
        if (row + 1 < this.rows && this.wouldCreateMatch(row, column, row + 1, column)) return true
      }
    }
    return false
  }

  /** Candidate swaps used by the authoritative casual bot and admin replay tools. */
  get legalMoves(): GemBlitzMove[] {
    const moves: GemBlitzMove[] = []
    for (let row = 0; row < this.rows; row += 1) {
      for (let column = 0; column < this.columns; column += 1) {
        if (column + 1 < this.columns && this.wouldCreateMatch(row, column, row, column + 1)) moves.push({ fromRow: row, fromColumn: column, toRow: row, toColumn: column + 1 })
        if (row + 1 < this.rows && this.wouldCreateMatch(row, column, row + 1, column)) moves.push({ fromRow: row, fromColumn: column, toRow: row + 1, toColumn: column })
      }
    }
    return moves
  }

  swap(move: GemBlitzMove): GemBlitzMoveResult {
    if (!this.inside(move.fromRow, move.fromColumn) || !this.inside(move.toRow, move.toColumn)) {
      return this.rejected("That move is outside the board.")
    }
    const distance = Math.abs(move.fromRow - move.toRow) + Math.abs(move.fromColumn - move.toColumn)
    if (distance !== 1) return this.rejected("Gems must be next to each other.")

    const next = this.cells.map((cell) => (cell ? { ...cell } : null))
    const from = this.index(move.fromRow, move.fromColumn)
    const to = this.index(move.toRow, move.toColumn)
    const first = next[from]
    const second = next[to]
    if (!first || !second) return this.rejected("Empty tile.")
    next[from] = second
    next[to] = first

    const specialSwap = first.special !== GemSpecial.None ? from : second.special !== GemSpecial.None ? to : undefined
    if (specialSwap === undefined && this.findMatches(next).length === 0) {
      return this.rejected("Make a match of three or more.")
    }

    const timestamp = move.timestamp ?? 0
    const speedCombo = this.nextSpeedCombo(timestamp)
    const updated = new GemBlitzEngine(
      this.seed,
      this.rows,
      this.columns,
      next,
      this.random,
      this.score,
      this.moves + 1,
      speedCombo,
      this.fever || speedCombo >= Number(this.rulesPolicy.scoring?.feverThreshold ?? 5),
      timestamp,
      this.rulesPolicy,
    )
    return updated.resolve(
      specialSwap,
      specialSwap === undefined ? undefined : specialSwap === from ? to : from,
      to,
    )
  }

  private resolve(specialSwap: number | undefined, specialOtherIndex: number | undefined, preferredSpecialIndex: number): GemBlitzMoveResult {
    let working = this.cells.map((cell) => (cell ? { ...cell } : null))
    let totalScore = 0
    let totalCleared = 0
    let totalCascades = 0
    let specialCreated: GemSpecial | undefined
    const events: string[] = []
    const animation: GemBlitzAnimationStep[] = []
    let pendingSpecialSwap = specialSwap

    while (true) {
      const matches = this.findMatchGroups(working)
      if (matches.length === 0 && pendingSpecialSwap === undefined) break

      totalCascades += 1
      const clear = new Set<number>()
      const placements = new Map<number, GemSpecial>()
      let basePoints = 0

      for (const group of matches) {
        group.cells.forEach((cell) => clear.add(cell))
        basePoints += group.cells.length >= 5 ? 300 : group.cells.length === 4 ? 180 : 100
        if (group.special !== GemSpecial.None) {
          const anchor = group.cells.includes(preferredSpecialIndex)
            ? preferredSpecialIndex
            : group.cells[Math.floor(group.cells.length / 2)]
          placements.set(anchor, group.special)
          clear.delete(anchor)
          specialCreated ??= group.special
        }
      }

      if (pendingSpecialSwap !== undefined) {
        const specialIndex = pendingSpecialSwap
        const otherIndex = specialOtherIndex ?? (specialIndex === preferredSpecialIndex
          ? this.neighbourForSpecial(preferredSpecialIndex)
          : preferredSpecialIndex)
        this.applySpecialSwap(specialIndex, otherIndex, working, clear, events)
        pendingSpecialSwap = undefined
        basePoints += 220
      }

      if (clear.size === 0 && placements.size === 0) break

      const queue: number[] = []
      const activated = new Set<number>()
      for (const cell of clear) {
        if (working[cell]?.special !== GemSpecial.None) queue.push(cell)
      }
      while (queue.length > 0) {
        const index = queue.pop() as number
        if (activated.has(index)) continue
        activated.add(index)
        const tile = working[index]
        if (!tile) continue
        for (const target of this.specialTargets(index, tile, working)) {
          if (!clear.has(target)) {
            clear.add(target)
            if (working[target]?.special !== GemSpecial.None) queue.push(target)
          }
        }
      }

      const before = this.animationBoard(working)
      const cleared = Array.from(clear)

      totalCleared += clear.size
      const gained = Math.round(
        (basePoints + clear.size * 20) *
          this.cascadeMultiplier(totalCascades) *
          (1 + Math.min(Math.max(this.speedCombo - 1, 0) * 0.05, 0.25)) *
          (this.fever ? Number(this.rulesPolicy.scoring?.feverMultiplier ?? 1.25) : 1),
      )
      totalScore += gained
      if (totalCascades > 1) events.push(`CASCADE x${totalCascades}`)
      if (this.speedCombo >= 2) events.push(`FAST x${this.speedCombo}`)
      if (this.fever) events.push("FEVER")
      if (clear.size >= 8) events.push("BIG CLEAR")

      clear.forEach((cell) => { working[cell] = null })
      placements.forEach((special, cell) => {
        working[cell] = {
          type: working[cell]?.type ?? GEM_TYPES[this.random.nextInt(GEM_TYPES.length)],
          special,
        }
      })
      this.collapseAndFill(working)
      animation.push({ cascade: totalCascades, before, cleared, after: this.animationBoard(working) })
      preferredSpecialIndex = -1
    }

    let finalBoard = new GemBlitzEngine(
      this.seed,
      this.rows,
      this.columns,
      working,
      this.random,
      Math.min(Number(this.rulesPolicy.scoring?.scoreCap ?? Number.MAX_SAFE_INTEGER), this.score + totalScore),
      this.moves,
      this.speedCombo,
      this.fever,
      this.lastMoveTimestamp,
      this.rulesPolicy,
    )
    let reshuffled = false
    if (!finalBoard.hasLegalMove) {
      finalBoard = finalBoard.reshuffled()
      reshuffled = true
      events.push("NO MOVES — SHUFFLING")
    }

    return {
      accepted: true,
      board: finalBoard,
      scoreDelta: finalBoard.score - this.score,
      cleared: totalCleared,
      cascades: totalCascades,
      speedCombo: finalBoard.speedCombo,
      fever: finalBoard.fever,
      specialCreated,
      events,
      animation,
      reshuffled,
    }
  }

  private animationBoard(cells: Array<GemTile | null>): GemTile[] {
    return cells.map((cell) => cell ? { ...cell } : { type: GemType.Aqua, special: GemSpecial.None })
  }

  private rejected(reason: string): GemBlitzMoveResult {
    return {
      accepted: false,
      board: this,
      scoreDelta: 0,
      cleared: 0,
      cascades: 0,
      speedCombo: this.speedCombo,
      fever: this.fever,
      events: [],
      animation: [],
      reason,
      reshuffled: false,
    }
  }

  private nextSpeedCombo(timestamp: number): number {
    if (timestamp <= 0 || this.lastMoveTimestamp <= 0) return 1
    return timestamp - this.lastMoveTimestamp <= Number(this.rulesPolicy.scoring?.fastMoveWindowMs ?? 2500) ? this.speedCombo + 1 : 1
  }

  private reshuffled(): GemBlitzEngine {
    const values = this.cells.filter((cell): cell is GemTile => cell !== null).map((cell) => cell.type)
    for (let attempt = 0; attempt < 80; attempt += 1) {
      for (let index = values.length - 1; index > 0; index -= 1) {
        const other = this.random.nextInt(index + 1)
        ;[values[index], values[other]] = [values[other], values[index]]
      }
      const candidate = values.map((type) => ({ type, special: GemSpecial.None }))
      const engine = new GemBlitzEngine(this.seed, this.rows, this.columns, candidate, this.random, this.score, this.moves, this.speedCombo, this.fever, this.lastMoveTimestamp, this.rulesPolicy)
      if (engine.findMatches(candidate).length === 0 && engine.hasLegalMove) return engine
    }
    return this
  }

  private collapseAndFill(cells: Array<GemTile | null>): void {
    for (let column = 0; column < this.columns; column += 1) {
      const compact: GemTile[] = []
      for (let row = this.rows - 1; row >= 0; row -= 1) {
        const tile = cells[this.index(row, column)]
        if (tile) compact.push(tile)
      }
      while (compact.length < this.rows) {
        compact.push({ type: GEM_TYPES[this.random.nextInt(GEM_TYPES.length)], special: GemSpecial.None })
      }
      for (let row = this.rows - 1; row >= 0; row -= 1) {
        cells[this.index(row, column)] = compact[this.rows - row - 1]
      }
    }
  }

  private applySpecialSwap(specialIndex: number, otherIndex: number, cells: Array<GemTile | null>, clear: Set<number>, events: string[]): void {
    const special = cells[specialIndex]
    const other = cells[otherIndex]
    if (!special) return
    if (special.special === GemSpecial.ColorBomb && other) {
      cells.forEach((tile, index) => { if (tile?.type === other.type) clear.add(index) })
      events.push("COLOR BLAST")
      return
    }
    clear.add(specialIndex)
    clear.add(otherIndex)
    events.push("SPECIAL COMBO")
  }

  private neighbourForSpecial(index: number): number {
    const row = Math.floor(index / this.columns)
    const column = index % this.columns
    const points = [[row, column - 1], [row, column + 1], [row - 1, column], [row + 1, column]]
    for (const [candidateRow, candidateColumn] of points) {
      if (this.inside(candidateRow, candidateColumn)) return this.index(candidateRow, candidateColumn)
    }
    return index
  }

  private *specialTargets(index: number, tile: GemTile, cells: Array<GemTile | null>): Generator<number> {
    const row = Math.floor(index / this.columns)
    const column = index % this.columns
    if (tile.special === GemSpecial.RocketHorizontal) {
      for (let current = 0; current < this.columns; current += 1) yield this.index(row, current)
    } else if (tile.special === GemSpecial.RocketVertical) {
      for (let current = 0; current < this.rows; current += 1) yield this.index(current, column)
    } else if (tile.special === GemSpecial.Bomb) {
      for (let currentRow = row - 1; currentRow <= row + 1; currentRow += 1) {
        for (let currentColumn = column - 1; currentColumn <= column + 1; currentColumn += 1) {
          if (this.inside(currentRow, currentColumn)) yield this.index(currentRow, currentColumn)
        }
      }
    } else if (tile.special === GemSpecial.ColorBomb) {
      for (let current = 0; current < cells.length; current += 1) {
        if (cells[current]?.type === tile.type) yield current
      }
    }
  }

  private findMatchGroups(cells: Array<GemTile | null>): GemGroup[] {
    const groups: GemGroup[] = []
    const covered = new Set<number>()
    for (let row = 0; row < this.rows; row += 1) {
      let start = 0
      while (start < this.columns) {
        const tile = cells[this.index(row, start)]
        if (!tile) { start += 1; continue }
        let end = start + 1
        while (end < this.columns && cells[this.index(row, end)]?.type === tile.type) end += 1
        if (end - start >= 3) {
          const positions = Array.from({ length: end - start }, (_, offset) => this.index(row, start + offset))
          groups.push({ cells: positions, special: this.specialForLine(end - start, true) })
          positions.forEach((position) => covered.add(position))
        }
        start = end
      }
    }
    for (let column = 0; column < this.columns; column += 1) {
      let start = 0
      while (start < this.rows) {
        const tile = cells[this.index(start, column)]
        if (!tile) { start += 1; continue }
        let end = start + 1
        while (end < this.rows && cells[this.index(end, column)]?.type === tile.type) end += 1
        if (end - start >= 3) {
          const positions = Array.from({ length: end - start }, (_, offset) => this.index(start + offset, column))
          groups.push({ cells: positions, special: positions.some((position) => covered.has(position)) ? GemSpecial.Bomb : this.specialForLine(end - start, false) })
          positions.forEach((position) => covered.add(position))
        }
        start = end
      }
    }
    return groups
  }

  private findMatches(cells: Array<GemTile | null>): number[] {
    return [...new Set(this.findMatchGroups(cells).flatMap((group) => group.cells))]
  }

  private specialForLine(length: number, horizontal: boolean): GemSpecial {
    if (length >= 5) return GemSpecial.ColorBomb
    if (length === 4) return horizontal ? GemSpecial.RocketHorizontal : GemSpecial.RocketVertical
    return GemSpecial.None
  }

  private wouldCreateMatch(fromRow: number, fromColumn: number, toRow: number, toColumn: number): boolean {
    const copy = this.cells.map((cell) => (cell ? { ...cell } : null))
    const first = this.index(fromRow, fromColumn)
    const second = this.index(toRow, toColumn)
    ;[copy[first], copy[second]] = [copy[second], copy[first]]
    return this.findMatches(copy).length > 0
  }

  private cascadeMultiplier(cascade: number): number {
    const configured = this.rulesPolicy.scoring?.cascadeMultipliers
    if (Array.isArray(configured) && configured.length) return Number(configured[Math.min(cascade - 1, configured.length - 1)]) || 1
    if (cascade <= 1) return 1
    if (cascade === 2) return 1.2
    if (cascade === 3) return 1.5
    return 2
  }

  private static randomTile(random: SeededRandom, cells: Array<GemTile | null>, size: number, row: number, column: number): GemTile {
    const blocked = new Set<GemType>()
    if (column >= 2) {
      const left = cells[row * size + column - 1]
      const leftTwo = cells[row * size + column - 2]
      if (left && leftTwo && left.type === leftTwo.type) blocked.add(left.type)
    }
    if (row >= 2) {
      const above = cells[(row - 1) * size + column]
      const aboveTwo = cells[(row - 2) * size + column]
      if (above && aboveTwo && above.type === aboveTwo.type) blocked.add(above.type)
    }
    const options = GEM_TYPES.filter((type) => !blocked.has(type))
    return { type: options[random.nextInt(options.length)], special: GemSpecial.None }
  }

  private index(row: number, column: number): number { return row * this.columns + column }
  private inside(row: number, column: number): boolean { return row >= 0 && row < this.rows && column >= 0 && column < this.columns }
}
