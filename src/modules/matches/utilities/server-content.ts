import { createHash } from "node:crypto"

export const MAX_SERVER_CONTENT_PER_MATCH = 100

type ContentIdentity = {
  id: string
  contentType?: unknown
  prompt?: unknown
  options?: unknown
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
  const playableItems = gameKey === "math" ? items.filter(isMathServerContent) : items
  return [...playableItems]
    .sort((left, right) => {
      const leftRank = createHash("sha256").update(`${serverNonce}:content:${left.id}`).digest("hex")
      const rightRank = createHash("sha256").update(`${serverNonce}:content:${right.id}`).digest("hex")
      return leftRank.localeCompare(rightRank)
    })
    .slice(0, boundedCount)
}

export function createAssignmentToken(serverNonce: string, participantId: string, roundId: string, position: number): string {
  return createHash("sha256").update(`${serverNonce}:${roundId}:${participantId}:${position}`).digest("base64url")
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
