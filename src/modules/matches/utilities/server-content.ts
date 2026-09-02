import { createHash } from "node:crypto"

export const MAX_SERVER_CONTENT_PER_MATCH = 100

type ContentIdentity = { id: string }

/**
 * Selects content using a server-only match nonce. The database query remains
 * bounded and the same question set is used for every human participant in a
 * match, while the assignment token remains participant-specific.
 */
export function selectServerContent<T extends ContentIdentity>(items: T[], count: number, serverNonce: string): T[] {
  const boundedCount = Math.min(Math.max(Math.trunc(count), 1), MAX_SERVER_CONTENT_PER_MATCH)
  return [...items]
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
