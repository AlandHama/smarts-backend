import { createHash } from "node:crypto"
import { WordDashDictionary } from "./word-dash-dictionary"
import { wordDashBoardHash } from "./word-dash-hash"
import { DEFAULT_WORD_DASH_POLICY, WordDashPolicy } from "./word-dash-score"

const LETTERS = "EEEEEEEEEEEEAAAAAAAAAARRRRRRIIIIIIIIOOOOOOOOTTTTTTNNNNNNSSSSSSLLLLDDDDGGGGUUUUMMMMBBBBCCCCFFFFHHHHPPPPVVVWWYYKJXQZ"
const FALLBACK_BOARD = "SMARTENTLGPAYOHCDIVERUSHK"

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
  const boardSize = 5
  const random = new SeededRandom(`${seed}:${policy.rulesVersion}:${dictionary.version}`)
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

function finalize(seed: string, letters: string, words: Array<{ word: string; path: number[] }>, policy: WordDashPolicy, dictionary: WordDashDictionary): WordDashBoard {
  const map = new Map<string, number[]>()
  for (const item of words) map.set(item.word, item.path)
  return { seed, letters, boardHash: wordDashBoardHash(policy.rulesVersion, dictionary.version, letters), validWords: map }
}
