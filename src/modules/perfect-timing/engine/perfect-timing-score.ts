export type PerfectTimingJudgement = "PERFECT" | "GREAT" | "GOOD" | "MISS"
export type PerfectTimingMovementModel =
  | "LINEAR_PING_PONG"
  | "EASED_PING_PONG"
  | "ACCELERATE_AND_REVERSE"
  | "TARGET_DRIFT"
  | "FAKE_SLOWDOWN"

export type PerfectTimingMode = "CASUAL" | "RANKED" | "PRACTICE" | "BOT"

export interface PerfectTimingBotPolicy {
  enabled: boolean
  reactionDelayMs: number
  jitterMs: number
  skill: number
}

export interface PerfectTimingPolicy {
  enabled: boolean
  killSwitch: boolean
  rolloutPercentage: number
  visibleName: string
  rulesVersion: string
  policyVersion: string
  standardRounds: number
  practiceRounds: number
  rankedRoundMin: number
  rankedRoundMax: number
  /** Shared match clock. Challenges are consumed independently by each player. */
  matchDurationMs: number
  /** Deterministic challenge bank generated for the match. */
  challengeCount: number
  roundDurationMs: number
  interRoundDurationMs: number
  perfectWindowMs: number
  greatWindowMs: number
  goodWindowMs: number
  targetWidthEarly: number
  targetWidthMiddle: number
  targetWidthLate: number
  casualEnabled: boolean
  rankedEnabled: boolean
  practiceEnabled: boolean
  casualBotEnabled: boolean
  rankedBotFallback: boolean
  clockOffsetLimitMs: number
  maxTapAgeMs: number
  maxTapLeadMs: number
  movementModels: PerfectTimingMovementModel[]
  bot: PerfectTimingBotPolicy
}

export const DEFAULT_PERFECT_TIMING_POLICY: PerfectTimingPolicy = {
  enabled: true,
  killSwitch: false,
  rolloutPercentage: 100,
  visibleName: "Perfect Timing",
  rulesVersion: "perfect-timing.v1",
  policyVersion: "perfect-timing-policy.v1",
  standardRounds: 10,
  practiceRounds: 5,
  rankedRoundMin: 10,
  rankedRoundMax: 15,
  matchDurationMs: 35000,
  challengeCount: 100,
  roundDurationMs: 3000,
  interRoundDurationMs: 650,
  perfectWindowMs: 40,
  greatWindowMs: 100,
  goodWindowMs: 180,
  targetWidthEarly: 0.16,
  targetWidthMiddle: 0.11,
  targetWidthLate: 0.07,
  casualEnabled: true,
  rankedEnabled: false,
  practiceEnabled: true,
  casualBotEnabled: true,
  rankedBotFallback: false,
  clockOffsetLimitMs: 1500,
  maxTapAgeMs: 2500,
  maxTapLeadMs: 150,
  movementModels: ["LINEAR_PING_PONG", "EASED_PING_PONG", "ACCELERATE_AND_REVERSE", "TARGET_DRIFT", "FAKE_SLOWDOWN"],
  bot: { enabled: true, reactionDelayMs: 700, jitterMs: 80, skill: 0.55 },
}

export function mergePerfectTimingPolicy(value: unknown): PerfectTimingPolicy {
  const configured = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {}
  const bot = configured.bot && typeof configured.bot === "object" ? configured.bot : {}
  const movementModels = Array.isArray(configured.movementModels) && configured.movementModels.length
    ? configured.movementModels.filter((item: unknown): item is PerfectTimingMovementModel => ["LINEAR_PING_PONG", "EASED_PING_PONG", "ACCELERATE_AND_REVERSE", "TARGET_DRIFT", "FAKE_SLOWDOWN"].includes(String(item)))
    : DEFAULT_PERFECT_TIMING_POLICY.movementModels
  const merged: PerfectTimingPolicy = {
    ...DEFAULT_PERFECT_TIMING_POLICY,
    ...configured,
    movementModels: movementModels.length ? movementModels : DEFAULT_PERFECT_TIMING_POLICY.movementModels,
    bot: { ...DEFAULT_PERFECT_TIMING_POLICY.bot, ...bot },
  }
  if (!(merged.goodWindowMs > merged.greatWindowMs && merged.greatWindowMs > merged.perfectWindowMs && merged.perfectWindowMs >= 0)) {
    throw new Error("Perfect Timing score windows are invalid")
  }
  if (!Number.isFinite(merged.rolloutPercentage) || merged.rolloutPercentage < 0 || merged.rolloutPercentage > 100) throw new Error("Perfect Timing rollout percentage must be between 0 and 100")
  if (!Number.isFinite(merged.matchDurationMs) || merged.matchDurationMs < 5000 || merged.matchDurationMs > 5 * 60 * 1000) throw new Error("Perfect Timing match duration is invalid")
  if (!Number.isInteger(merged.challengeCount) || merged.challengeCount < 10 || merged.challengeCount > 1000) throw new Error("Perfect Timing challenge count is invalid")
  if (merged.rankedRoundMin < 10 || merged.rankedRoundMax > 15 || merged.rankedRoundMin > merged.rankedRoundMax) throw new Error("Perfect Timing ranked round bounds are invalid")
  return merged
}

export function roundCountForMode(policy: PerfectTimingPolicy, mode: PerfectTimingMode): number {
  if (mode === "PRACTICE") return policy.practiceRounds
  if (mode === "RANKED") return Math.max(policy.rankedRoundMin, Math.min(policy.rankedRoundMax, policy.standardRounds))
  return policy.standardRounds
}

export function classifyPerfectTiming(timingErrorMs: number, policy: PerfectTimingPolicy): PerfectTimingJudgement {
  if (!Number.isFinite(timingErrorMs) || timingErrorMs > policy.goodWindowMs) return "MISS"
  if (timingErrorMs <= policy.perfectWindowMs) return "PERFECT"
  if (timingErrorMs <= policy.greatWindowMs) return "GREAT"
  return "GOOD"
}

export function pointsForPerfectTiming(judgement: PerfectTimingJudgement): number {
  return judgement === "PERFECT" ? 100 : judgement === "GREAT" ? 75 : judgement === "GOOD" ? 40 : 0
}
