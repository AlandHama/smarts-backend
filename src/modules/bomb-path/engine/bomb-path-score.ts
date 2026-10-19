export type BombPathMode = "CASUAL" | "RANKED" | "PRACTICE" | "BOT"
export type BombPathRoundStatus = "READY" | "PLAYING" | "SUCCESS" | "BOMB_HIT" | "TIMEOUT" | "INCOMPLETE" | "ABANDONED"

export interface BombPathBotPolicy {
  enabled: boolean
  reactionDelayMs: number
  stepDelayMs: number
  jitterMs: number
  errorRate: number
  skill: number
}

export interface BombPathPolicy {
  enabled: boolean
  killSwitch: boolean
  rolloutPercentage: number
  visibleName: string
  rulesVersion: string
  generationVersion: string
  policyVersion: string
  roundCount: number
  gridSizeEarly: number
  gridSizeLate: number
  bombCountEarly: number
  bombCountLate: number
  memorizeDurationMs: number
  playDurationMs: number
  roundResultDurationMs: number
  matchDurationSeconds: number
  baseRoundScore: number
  speedBonusMax: number
  efficiencyBonusMax: number
  orthogonalOnly: boolean
  casualEnabled: boolean
  rankedEnabled: boolean
  practiceEnabled: boolean
  casualBotEnabled: boolean
  rankedBotFallback: boolean
  bot: BombPathBotPolicy
}

export const DEFAULT_BOMB_PATH_POLICY: BombPathPolicy = {
  enabled: true,
  killSwitch: false,
  rolloutPercentage: 100,
  visibleName: "Bomb Path",
  rulesVersion: "bomb-path.v1",
  generationVersion: "bomb-path-field.v1",
  policyVersion: "bomb-path-policy.v1",
  roundCount: 5,
  gridSizeEarly: 5,
  // Bomb Path uses a square board in v1. Keep the largest board at 7x7 so
  // the mobile grid never exceeds the requested 7x9 visual ceiling.
  gridSizeLate: 7,
  bombCountEarly: 2,
  bombCountLate: 10,
  memorizeDurationMs: 3500,
  playDurationMs: 8000,
  roundResultDurationMs: 900,
  matchDurationSeconds: 60,
  baseRoundScore: 100,
  speedBonusMax: 50,
  efficiencyBonusMax: 25,
  orthogonalOnly: true,
  casualEnabled: true,
  rankedEnabled: false,
  practiceEnabled: true,
  casualBotEnabled: true,
  rankedBotFallback: false,
  bot: { enabled: true, reactionDelayMs: 900, stepDelayMs: 420, jitterMs: 160, errorRate: 0.08, skill: 0.7 },
}

export function mergeBombPathPolicy(value: unknown): BombPathPolicy {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {}
  const bot = source.bot && typeof source.bot === "object" ? source.bot : {}
  const policy: BombPathPolicy = { ...DEFAULT_BOMB_PATH_POLICY, ...source, bot: { ...DEFAULT_BOMB_PATH_POLICY.bot, ...bot } }
  if (!Number.isInteger(policy.roundCount) || policy.roundCount < 3 || policy.roundCount > 7) throw new Error("Bomb Path round count is invalid")
  if (!Number.isInteger(policy.gridSizeEarly) || !Number.isInteger(policy.gridSizeLate) || policy.gridSizeEarly < 3 || policy.gridSizeLate < policy.gridSizeEarly || policy.gridSizeLate > 7) throw new Error("Bomb Path grid sizes are invalid; the mobile board is capped at 7x7")
  if (!Number.isInteger(policy.bombCountEarly) || !Number.isInteger(policy.bombCountLate) || policy.bombCountEarly < 1 || policy.bombCountLate < policy.bombCountEarly) throw new Error("Bomb Path bomb counts are invalid")
  if (policy.rolloutPercentage < 0 || policy.rolloutPercentage > 100) throw new Error("Bomb Path rollout percentage is invalid")
  if (policy.memorizeDurationMs < 500 || policy.playDurationMs < 1000 || policy.roundResultDurationMs < 0) throw new Error("Bomb Path phase durations are invalid")
  if (policy.matchDurationSeconds < 10 || policy.matchDurationSeconds > 300) throw new Error("Bomb Path match duration is invalid")
  if (policy.speedBonusMax < 0 || policy.efficiencyBonusMax < 0 || policy.baseRoundScore < 0) throw new Error("Bomb Path scoring policy is invalid")
  if (policy.generationVersion !== "bomb-path-field.v1") throw new Error("Bomb Path generation version is unsupported")
  const minimumPhaseBudget = Array.from({ length: policy.roundCount }, (_, index) => bombPathRoundSpec(policy, index)).reduce((sum, spec) => sum + spec.memorizeDurationMs + spec.playDurationMs + spec.resultDurationMs, 0)
  if (policy.matchDurationSeconds * 1000 < minimumPhaseBudget) throw new Error("Bomb Path match duration is shorter than its phase budget")
  return policy
}

export interface BombPathRoundSpec {
  roundIndex: number
  gridSize: number
  bombCount: number
  memorizeDurationMs: number
  playDurationMs: number
  resultDurationMs: number
}

export function bombPathRoundSpec(policy: BombPathPolicy, roundIndex: number): BombPathRoundSpec {
  const progress = policy.roundCount <= 1 ? 0 : roundIndex / (policy.roundCount - 1)
  return {
    roundIndex,
    gridSize: Math.round(policy.gridSizeEarly + (policy.gridSizeLate - policy.gridSizeEarly) * progress),
    bombCount: Math.round(policy.bombCountEarly + (policy.bombCountLate - policy.bombCountEarly) * progress),
    memorizeDurationMs: Math.max(1000, Math.round(policy.memorizeDurationMs - progress * Math.min(1500, policy.memorizeDurationMs - 1000))),
    playDurationMs: Math.max(1000, Math.round(policy.playDurationMs - progress * Math.min(1000, policy.playDurationMs - 1000))),
    resultDurationMs: policy.roundResultDurationMs,
  }
}

export function scoreBombPathRound(status: BombPathRoundStatus, elapsedMs: number, pathLength: number, shortestSafePathLength: number, spec: BombPathRoundSpec, policy: BombPathPolicy) {
  if (status !== "SUCCESS") return { base: 0, speedBonus: 0, efficiencyBonus: 0, total: 0 }
  const speedRatio = Math.max(0, Math.min(1, 1 - Math.max(0, elapsedMs) / spec.playDurationMs))
  const efficiencyRatio = pathLength <= 0 ? 0 : Math.max(0, Math.min(1, shortestSafePathLength / pathLength))
  const base = Math.max(0, Math.trunc(policy.baseRoundScore))
  const speedBonus = Math.round(policy.speedBonusMax * speedRatio)
  const efficiencyBonus = Math.round(policy.efficiencyBonusMax * efficiencyRatio)
  return { base, speedBonus, efficiencyBonus, total: base + speedBonus + efficiencyBonus }
}
