import { createHash } from "node:crypto"

export const MAX_SERVER_CONTENT_PER_MATCH = 100
// Read enough of the active pool to remove imported option-order variants
// before applying the per-match limit. A query limited to 100 rows could be
// made entirely of duplicates and starve a 44-question trivia match.
export const MAX_SERVER_CONTENT_POOL = 10_000

/** Games whose board/challenge is generated and verified by its own engine. */
export function isAuthoritativeBoardGame(gameKey: string): boolean {
  return [
    "gem_blitz",
    "tile_rush",
    "word_dash",
    "domino",
    "perfect_timing",
    "bomb_path",
  ].includes(gameKey.trim().toLowerCase())
}

type ContentIdentity = {
  id: string
  contentType?: unknown
  prompt?: unknown
  options?: unknown
  answerIndex?: unknown
}

/**
 * Trivia is intentionally a rapid-read game. Keep this validation in the
 * shared selection helper as a final safety net: imports, manually-created
 * admin content, and old rows must all follow the same limits before they can
 * become playable.
 */
export const MAX_TRIVIA_PROMPT_CHARACTERS = 180
export const MAX_TRIVIA_OPTION_CHARACTERS = 80

export function normalizeTriviaText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
}

export function isFastTriviaContent(item: {
  prompt?: unknown
  options?: unknown
  answerIndex?: unknown
}): boolean {
  const prompt = localizedPrompt(item.prompt)
  const options = item.options
  if (
    !prompt ||
    prompt.length > MAX_TRIVIA_PROMPT_CHARACTERS ||
    !Array.isArray(options) ||
    options.length < 2 ||
    options.length > 8 ||
    !Number.isSafeInteger(item.answerIndex) ||
    Number(item.answerIndex) < 0 ||
    Number(item.answerIndex) >= options.length
  ) return false
  const normalizedOptions = options.map((option) => normalizeTriviaText(option))
  return normalizedOptions.every((option) => option.length > 0 && option.length <= MAX_TRIVIA_OPTION_CHARACTERS) &&
    new Set(normalizedOptions).size === normalizedOptions.length
}

const MATH_EXPRESSION_PATTERN = /^\s*-?\d+\s*[+*×÷\/-]\s*-?\d+\s*$/
const INTEGER_PATTERN = /^-?\d+$/

/**
 * Math is rendered as an expression, not as a generic server challenge.
 * Keep this rule next to assignment selection so legacy/admin content cannot
 * accidentally become playable math content.
 */
export function isMathServerContent(item: {
  contentType?: unknown
  prompt?: unknown
  options?: unknown
}): boolean {
  const prompt = localizedPrompt(item.prompt)
  const options = item.options
  return (
    MATH_EXPRESSION_PATTERN.test(prompt) &&
    Array.isArray(options) &&
    options.length === 4 &&
    options.every((option) => INTEGER_PATTERN.test(String(option).trim()))
  )
}

function localizedPrompt(value: unknown): string {
  if (typeof value === "string") return value.trim()
  if (!value || typeof value !== "object" || Array.isArray(value)) return ""
  const record = value as Record<string, unknown>
  for (const key of ["en", "en-US", "ar", "ckb"]) {
    if (typeof record[key] === "string" && record[key].trim()) return record[key].trim()
  }
  return Object.values(record).find((candidate): candidate is string => typeof candidate === "string" && candidate.trim().length > 0)?.trim() ?? ""
}

/**
 * Selects content using a server-only match nonce. The database query remains
 * bounded and the same question set is used for every human participant in a
 * match, while the assignment token remains participant-specific.
 */
export function selectServerContent<T extends ContentIdentity>(items: T[], count: number, serverNonce: string, gameKey?: string): T[] {
  const boundedCount = Math.min(Math.max(Math.trunc(count), 1), MAX_SERVER_CONTENT_PER_MATCH)
  const normalizedGameKey = gameKey?.trim().toLowerCase()
  const playableItems = normalizedGameKey === "math"
    ? items.filter(isMathServerContent)
    : normalizedGameKey === "trivia"
      ? items.filter(isFastTriviaContent)
      : items
  const uniqueItems: T[] = []
  const seenContent = new Set<string>()
  for (const item of playableItems) {
    // The same trivia prompt is frequently stored with several option orders.
    // Treat those variants as one question, otherwise a match can show the
    // same question more than once even though the row IDs differ.
    const identity = normalizedGameKey === "trivia"
      ? `trivia:${normalizeTriviaText(localizedPrompt(item.prompt))}`
      : stableJson({ prompt: item.prompt, options: item.options, answerIndex: item.answerIndex })
    if (seenContent.has(identity)) continue
    seenContent.add(identity)
    uniqueItems.push(item)
  }
  const ordered = uniqueItems
    .sort((left, right) => {
      const leftRank = createHash("sha256").update(`${serverNonce}:content:${left.id}`).digest("hex")
      const rightRank = createHash("sha256").update(`${serverNonce}:content:${right.id}`).digest("hex")
      return leftRank.localeCompare(rightRank)
    })
  if (!ordered.length) return []
  // Never cycle back through the pool. A small or duplicated database pool
  // must produce fewer unique questions, never repeat one in a match.
  return ordered.slice(0, boundedCount)
}

export function createAssignmentToken(serverNonce: string, participantId: string, roundId: string, position: number): string {
  return createHash("sha256").update(`${serverNonce}:${roundId}:${participantId}:${position}`).digest("base64url")
}

/** Deterministically shuffles choices while keeping the server answer key private. */
export function randomizeAnswerOptions<T>(options: T[], answerIndex: number, key: string): { options: T[]; answerIndex: number } {
  if (options.length < 2 || !Number.isInteger(answerIndex) || answerIndex < 0 || answerIndex >= options.length) {
    return { options: [...options], answerIndex }
  }
  const order = options.map((_, index) => index)
  for (let index = order.length - 1; index > 0; index -= 1) {
    const hash = createHash("sha256").update(`${key}:option:${index}`).digest("hex")
    const swapIndex = Number.parseInt(hash.slice(0, 8), 16) % (index + 1)
    ;[order[index], order[swapIndex]] = [order[swapIndex], order[index]]
  }
  return { options: order.map((index) => options[index]), answerIndex: order.indexOf(answerIndex) }
}

export function hashMatchEventRequest(input: {
  eventType: string
  clientEventId: string
  sequence: number
  payload?: Record<string, unknown>
  clientOccurredAt?: string
}): string {
  return createHash("sha256").update(stableJson(input)).digest("hex")
}

function stableJson(value: unknown): string {
  if (value === undefined) return "null"
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`
}

export function jsonByteLength(value: unknown): number {
  return Buffer.byteLength(stableJson(value), "utf8")
}
