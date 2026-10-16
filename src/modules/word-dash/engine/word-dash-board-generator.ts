import { createHash } from "node:crypto"
import { WordDashDictionary } from "./word-dash-dictionary"
import { wordDashBoardHash } from "./word-dash-hash"
import { DEFAULT_WORD_DASH_POLICY, WordDashPolicy } from "./word-dash-score"

const LETTERS = "EEEEEEEEEEEEAAAAAAAAAARRRRRRIIIIIIIIOOOOOOOOTTTTTTNNNNNNSSSSSSLLLLDDDDGGGGUUUUMMMMBBBBCCCCFFFFHHHHPPPPVVVWWYYKJXQZ"
const FALLBACK_BOARD = "SMARTENTLGPAYOHCDIVERUSHK"

// These are deliberately familiar, short words. A board should feel
// discoverable at a glance, especially for new players, rather than forcing
// them to search a dictionary for long or uncommon words. The list is still
// checked against the loaded dictionary below, so the server remains the only
// authority for what can be submitted.
const BEGINNER_WORDS = [
  "ACT", "AGE", "AIR", "ALL", "AND", "ARM", "ART", "ASK", "BAD", "BAR",
  "BED", "BIG", "BIT", "BOX", "BUS", "BUY", "DAY", "DOG", "END", "FAR",
  "FAST", "GET", "HAS", "HOT", "ICE", "JOB", "KEY", "LET", "LOW", "MAP",
  "MIX", "NEW", "NOT", "ONE", "PAY", "RED", "RUN", "SEE", "SET", "SIX",
  "THE", "TOP", "TWO", "USE", "WAY", "WIN", "YES", "YOU", "GAME", "PLAY",
  "SMART", "WORD",
]

class SeededRandom {
  private state: number
  constructor(seed: string) {
    const hash = createHash("sha256").update(seed).digest()
    this.state = hash.readUInt32BE(0) || 0x9e3779b9
  }
  next() { this.state = (this.state ^ (this.state << 13)) >>> 0; this.state = (this.state ^ (this.state >>> 17)) >>> 0; this.state = (this.state ^ (this.state << 5)) >>> 0; return this.state / 0x100000000 }
  pick<T>(values: readonly T[]) { return values[Math.floor(this.next() * values.length)] }
}

export type WordDashBoard = { seed: string; letters: string; boardHash: string; validWords: Map<string, number[]> }

export function generateWordDashBoard(seed: string, policy: WordDashPolicy = DEFAULT_WORD_DASH_POLICY, dictionary: WordDashDictionary): WordDashBoard {
  const boardSize = policy.boardSize
  const random = new SeededRandom(`${seed}:${policy.rulesVersion}:${dictionary.version}`)

  // Build the beginner board first. Each row contains one guaranteed,
  // dictionary-backed word on a straight path. This gives players several
  // obvious 3-letter starting points while the remaining cells still create
  // additional valid words and preserve board variety through the seed.
  const easyBoard = generateBeginnerBoard(boardSize, random, dictionary, policy)
  if (easyBoard) return finalize(seed, easyBoard.letters, easyBoard.words, policy, dictionary)

  let best: { letters: string; words: ReturnType<WordDashDictionary["findWordsOnBoard"]> } | null = null
  for (let attempt = 0; attempt < 160; attempt++) {
    const letters = Array.from({ length: boardSize * boardSize }, () => random.pick(LETTERS.split(""))).join("")
    const words = dictionary.findWordsOnBoard(letters, boardSize, policy.minimumWordLength, policy.allowDiagonal)
    if (!best || words.length > best.words.length) best = { letters, words }
    if (words.length >= 12 && words.some((item) => item.word.length >= 6)) return finalize(seed, letters, words, policy, dictionary)
  }
  const fallbackWords = dictionary.findWordsOnBoard(FALLBACK_BOARD, boardSize, policy.minimumWordLength, policy.allowDiagonal)
  return finalize(seed, best && best.words.length >= fallbackWords.length ? best.letters : FALLBACK_BOARD, best && best.words.length >= fallbackWords.length ? best.words : fallbackWords, policy, dictionary)
}

function generateBeginnerBoard(boardSize: number, random: SeededRandom, dictionary: WordDashDictionary, policy: WordDashPolicy) {
  if (boardSize !== 5 || policy.minimumWordLength > 3) return null

  const available = BEGINNER_WORDS.filter((word) => word.length >= policy.minimumWordLength && dictionary.has(word))
  const shortWords = available.filter((word) => word.length === 3)
  if (shortWords.length < boardSize) return null

  // Use five different short words, one per row. Four-letter words remain in
  // the candidate list for natural discoveries, but the guaranteed anchors
  // stay mostly 3 letters as the beginner rule requires.
  const selected: string[] = []
  const remaining = [...shortWords]
  while (selected.length < boardSize && remaining.length) {
    const index = Math.floor(random.next() * remaining.length)
    selected.push(remaining.splice(index, 1)[0])
  }
  if (selected.length < boardSize) return null

  const cells = Array<string | null>(boardSize * boardSize).fill(null)
  for (let row = 0; row < boardSize; row++) {
    const word = selected[row]
    const start = Math.floor(random.next() * (boardSize - word.length + 1))
    // Keep the guaranteed anchors readable in the normal left-to-right
    // direction. Players can still discover reverse and diagonal words in
    // the rest of the board, but the first words should be immediately clear.
    for (let offset = 0; offset < word.length; offset++) cells[row * boardSize + start + offset] = word[offset]
  }

  for (let index = 0; index < cells.length; index++) if (!cells[index]) cells[index] = random.pick(LETTERS.split(""))
  const letters = cells.join("")
  const words = dictionary.findWordsOnBoard(letters, boardSize, policy.minimumWordLength, policy.allowDiagonal)
  const guaranteed = selected.every((word) => words.some((item) => item.word === word))
  return guaranteed ? { letters, words } : null
}

function finalize(seed: string, letters: string, words: Array<{ word: string; path: number[] }>, policy: WordDashPolicy, dictionary: WordDashDictionary): WordDashBoard {
  const map = new Map<string, number[]>()
  for (const item of words) map.set(item.word, item.path)
  return { seed, letters, boardHash: wordDashBoardHash(policy.rulesVersion, dictionary.version, letters), validWords: map }
}
