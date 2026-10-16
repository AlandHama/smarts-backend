import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { Injectable } from "@nestjs/common"

type TrieNode = { terminal: boolean; children: Map<string, TrieNode> }
export type WordDashBoardWord = { word: string; path: number[] }

function node(): TrieNode { return { terminal: false, children: new Map<string, TrieNode>() } }

@Injectable()
export class WordDashDictionary {
  readonly version = "english.v1"
  readonly sha256: string
  private readonly words = new Set<string>()
  private readonly root: TrieNode = node()

  // Keep this constructor dependency-free. Nest inspects constructor
  // parameters at runtime, so an optional string path is still treated as a
  // provider token and prevents the application from booting. The path is
  // configuration, not a Nest dependency.
  constructor() {
    const filePath = process.env.WORD_DASH_DICTIONARY_PATH ?? resolve(process.cwd(), "assets/word-dash/dictionaries/english.v1.txt")
    const source = readFileSync(filePath)
    this.sha256 = createHash("sha256").update(source).digest("hex")
    const expected = process.env.WORD_DASH_DICTIONARY_SHA256?.trim().toLowerCase()
    if (expected && expected !== this.sha256) throw new Error(`Word Dash dictionary checksum mismatch: expected ${expected}, got ${this.sha256}`)
    if (process.env.NODE_ENV === "production" && process.env.WORD_DASH_REQUIRE_DICTIONARY_CHECKSUM === "true" && !expected) throw new Error("WORD_DASH_DICTIONARY_SHA256 is required when checksum enforcement is enabled")
    for (const raw of source.toString("utf8").split(/\r?\n/)) {
      const word = raw.trim().toUpperCase()
      if (!/^[A-Z]{3,25}$/.test(word)) continue
      if (this.words.has(word)) continue
      this.words.add(word)
      let current = this.root
      for (const letter of word) {
        let next = current.children.get(letter)
        if (!next) { next = node(); current.children.set(letter, next) }
        current = next
      }
      current.terminal = true
    }
    if (!this.words.size) throw new Error("Word Dash dictionary is empty")
  }

  get size() { return this.words.size }
  has(word: string) { return this.words.has(word.trim().toUpperCase()) }

  findWordsOnBoard(board: string, boardSize: number, minimumLength: number, allowDiagonal: boolean, maxWords = 5000): WordDashBoardWord[] {
    const letters = board.toUpperCase().split("")
    if (letters.length !== boardSize * boardSize) return []
    const result = new Map<string, number[]>()
    const directions = [-1, 0, 1]
    const visit = (index: number, trie: TrieNode, path: number[], used: Set<number>) => {
      if (result.size >= maxWords) return
      const letter = letters[index]
      const next = trie.children.get(letter)
      if (!next) return
      const nextPath = [...path, index]
      if (next.terminal && nextPath.length >= minimumLength) result.set(nextPath.map((item) => letters[item]).join(""), nextPath)
      if (nextPath.length >= Math.min(25, boardSize * boardSize)) return
      const row = Math.floor(index / boardSize)
      const column = index % boardSize
      for (const rowDelta of directions) for (const columnDelta of directions) {
        if (rowDelta === 0 && columnDelta === 0) continue
        if (!allowDiagonal && rowDelta !== 0 && columnDelta !== 0) continue
        const nextRow = row + rowDelta
        const nextColumn = column + columnDelta
        if (nextRow < 0 || nextRow >= boardSize || nextColumn < 0 || nextColumn >= boardSize) continue
        const nextIndex = nextRow * boardSize + nextColumn
        if (used.has(nextIndex)) continue
        used.add(nextIndex)
        visit(nextIndex, next, nextPath, used)
        used.delete(nextIndex)
      }
    }
    for (let index = 0; index < letters.length; index++) visit(index, this.root, [], new Set([index]))
    return [...result.entries()].map(([word, path]) => ({ word, path }))
  }
}
