import { comboBonus, scoreForWord, WordDashPolicy } from "./word-dash-score"

export type WordDashPlayerState = {
  score: number
  combo: number
  bestCombo: number
  acceptedWordCount: number
  longestWordLength: number
  lastAcceptedAt: number | null
  nextSequence: number
}

export type WordDashSubmissionResult = {
  accepted: boolean
  word?: string
  length?: number
  scoreDelta: number
  totalScore: number
  combo: number
  comboLabel: string | null
  reason?: string
}

export class WordDashEngine {
  constructor(private readonly board: string, private readonly policy: WordDashPolicy) {}

  resolve(path: number[], state: WordDashPlayerState, nowMs: number): WordDashSubmissionResult {
    const reason = this.validatePath(path)
    if (reason) return { accepted: false, scoreDelta: 0, totalScore: state.score, combo: state.combo, comboLabel: null, reason }
    const word = path.map((index) => this.board[index]).join("")
    const base = scoreForWord(word.length, this.policy)
    if (!base) return { accepted: false, scoreDelta: 0, totalScore: state.score, combo: state.combo, comboLabel: null, reason: "WORD_TOO_SHORT" }
    const combo = state.lastAcceptedAt !== null && nowMs - state.lastAcceptedAt <= this.policy.comboWindowMs ? state.combo + 1 : 1
    const multiplier = comboBonus(combo, this.policy)
    const scoreDelta = Math.min(this.policy.wordScoreCap, Math.max(0, Math.floor(base * (1 + multiplier.bonus))))
    const totalScore = Math.min(this.policy.matchScoreCap, state.score + scoreDelta)
    return { accepted: true, word, length: word.length, scoreDelta: Math.max(0, totalScore - state.score), totalScore, combo, comboLabel: multiplier.label }
  }

  validatePath(path: number[]): string | null {
    if (!Array.isArray(path) || path.length < this.policy.minimumWordLength) return "WORD_TOO_SHORT"
    if (path.length > this.board.length) return "PATH_TOO_LONG"
    const used = new Set<number>()
    for (let index = 0; index < path.length; index++) {
      const tile = path[index]
      if (!Number.isInteger(tile) || tile < 0 || tile >= this.board.length) return "INVALID_INDEX"
      if (used.has(tile)) return "REPEATED_TILE"
      used.add(tile)
      if (index === 0) continue
      if (!this.areAdjacent(path[index - 1], tile)) return "NON_ADJACENT_PATH"
    }
    const word = path.map((index) => this.board[index]).join("")
    if (!/^[A-Z]+$/.test(word)) return "INVALID_WORD"
    return null
  }

  private areAdjacent(first: number, second: number) {
    const size = this.policy.boardSize
    const firstRow = Math.floor(first / size)
    const firstColumn = first % size
    const secondRow = Math.floor(second / size)
    const secondColumn = second % size
    const rowDelta = Math.abs(firstRow - secondRow)
    const columnDelta = Math.abs(firstColumn - secondColumn)
    return rowDelta <= 1 && columnDelta <= 1 && (rowDelta !== 0 || columnDelta !== 0) && (this.policy.allowDiagonal || rowDelta + columnDelta === 1)
  }
}
