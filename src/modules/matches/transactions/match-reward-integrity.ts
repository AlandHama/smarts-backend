export type RewardEligibility = "FULL" | "PARTIAL" | "HELD" | "NONE"

export type SettlementEvidenceEvent = {
  eventType: string
  accepted: boolean
  payload?: unknown
  serverReceivedAt: Date
}

export type ParticipantRewardEvidence = {
  acceptedActionCount: number
  acceptedScoringActionCount: number
  hasUnverifiedActions: boolean
  verifiedPlayMilliseconds: number
  firstAcceptedAt: Date | null
  lastAcceptedAt: Date | null
}

const TERMINAL_EVENT_KINDS = new Set([
  "BOMB_PATH_TERMINAL",
  "MATCH_FINISHED",
  "MATCH_SETTLED",
  "FINAL_SCORE",
])

function objectPayload(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {}
}

function isTerminalProjection(payload: unknown): boolean {
  const value = objectPayload(payload)
  return TERMINAL_EVENT_KINDS.has(String(value.eventType ?? "").toUpperCase())
    || String(value.outcome ?? "").toUpperCase() === "MATCH_FINISHED"
}

/**
 * Returns only server-accepted player actions that are meaningful evidence of
 * participation. Terminal score projections are intentionally excluded: a
 * finish endpoint must not manufacture reward eligibility by itself.
 */
export function isAcceptedScoringEvent(event: SettlementEvidenceEvent, boardAuthoritative: boolean): boolean {
  if (!event.accepted || isTerminalProjection(event.payload)) return false
  if (boardAuthoritative) return event.eventType === "SCORE_UPDATE" || event.eventType === "SKIP"
  return event.eventType === "ANSWER" || event.eventType === "SKIP"
}

export function deriveParticipantRewardEvidence(events: SettlementEvidenceEvent[], boardAuthoritative: boolean): ParticipantRewardEvidence {
  const accepted = events.filter((event) => isAcceptedScoringEvent(event, boardAuthoritative))
  const verified = accepted.filter((event) => {
    const payload = objectPayload(event.payload)
    return payload.verified !== false && payload.verificationMode !== "LEGACY_CLIENT_CORRECTNESS"
  })
  const firstAcceptedAt = verified[0]?.serverReceivedAt ?? null
  const lastAcceptedAt = verified.at(-1)?.serverReceivedAt ?? null
  const verifiedPlayMilliseconds = firstAcceptedAt && lastAcceptedAt
    ? Math.max(0, lastAcceptedAt.getTime() - firstAcceptedAt.getTime())
    : 0
  return {
    acceptedActionCount: accepted.length,
    acceptedScoringActionCount: verified.length,
    hasUnverifiedActions: accepted.some((event) => !verified.includes(event)),
    verifiedPlayMilliseconds,
    firstAcceptedAt,
    lastAcceptedAt,
  }
}

export function rewardEligibilityForParticipant(input: {
  isPractice: boolean
  isBotOpponent: boolean
  isForfeit: boolean
  hasUnverifiedActions?: boolean
  acceptedScoringActionCount: number
}): RewardEligibility {
  if (input.isPractice || input.isForfeit) return "NONE"
  if (input.hasUnverifiedActions) return "HELD"
  if (input.acceptedScoringActionCount < 1) return "NONE"
  return input.isBotOpponent ? "PARTIAL" : "FULL"
}
