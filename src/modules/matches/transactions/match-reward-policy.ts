import { Prisma } from "@prisma/client"

export type RewardPolicy = {
  scoreNormalizationFactor: number
  maximumMatchXp: bigint
  minimumCompletionXp: bigint
  participationXp: bigint
  winnerXpBonus: bigint
  loserXpBonus: bigint
  drawXpBonus: bigint
  timeoutXp: bigint
  botXpMultiplier: number
  dailyGameXpCap: bigint
  dailyAccountXpCap: bigint
  dailyGldCap: bigint
  sameOpponentDiminishingFactor: number
  scoreRewardCap: bigint
}

const EXPECTED_SCORE: Record<string, number> = {
  // Legacy ten-question games award roughly 100–200 points per answer. Their
  // old fallback was 100, which made almost every completed match hit the XP
  // ceiling and made those games dramatically faster for leveling.
  trivia: 1500,
  math: 1500,
  flick_master: 1500,
  high_low: 1500,
  stacking: 1500,
  similarities: 1500,
  follow_the_lead: 1500,
  memorize_cards: 1500,
  bird_watching: 1500,
  gem_blitz: 15000,
  tile_rush: 15000,
  word_dash: 2000,
  domino: 100,
  perfect_timing: 1000,
  bomb_path: 1000,
}

const DEFAULT_MATCH_XP = {
  maximum: 240n,
  minimumCompletion: 25n,
  participation: 25n,
  winner: 35n,
  loser: 15n,
  draw: 25n,
  timeout: 8n,
}

function numberSetting(settings: Record<string, unknown>, key: string, fallback: number): number {
  const value = Number(settings[key])
  return Number.isFinite(value) && value >= 0 ? value : fallback
}

function bigintSetting(settings: Record<string, unknown>, key: string, fallback: bigint): bigint {
  const value = settings[key]
  try {
    const parsed = typeof value === "bigint" ? value : BigInt(String(value))
    return parsed >= 0n ? parsed : fallback
  } catch {
    return fallback
  }
}

export function rewardPolicy(config: { settings: Prisma.JsonValue | null; scoreRewardCap: bigint }, gameKey: string): RewardPolicy {
  const root = config.settings && typeof config.settings === "object" && !Array.isArray(config.settings)
    ? config.settings as Record<string, unknown>
    : {}
  const configured = root.rewardIntegrity && typeof root.rewardIntegrity === "object" && !Array.isArray(root.rewardIntegrity)
    ? root.rewardIntegrity as Record<string, unknown>
    : {}
  const expectedScore = numberSetting(configured, "expectedScore", EXPECTED_SCORE[gameKey] ?? 100)
  return {
    scoreNormalizationFactor: numberSetting(configured, "scoreNormalizationFactor", 1 / Math.max(1, expectedScore)),
    maximumMatchXp: bigintSetting(configured, "maximumMatchXp", DEFAULT_MATCH_XP.maximum),
    minimumCompletionXp: bigintSetting(configured, "minimumCompletionXp", DEFAULT_MATCH_XP.minimumCompletion),
    participationXp: bigintSetting(configured, "participationXp", DEFAULT_MATCH_XP.participation),
    winnerXpBonus: bigintSetting(configured, "winnerXpBonus", DEFAULT_MATCH_XP.winner),
    loserXpBonus: bigintSetting(configured, "loserXpBonus", DEFAULT_MATCH_XP.loser),
    drawXpBonus: bigintSetting(configured, "drawXpBonus", DEFAULT_MATCH_XP.draw),
    timeoutXp: bigintSetting(configured, "timeoutXp", DEFAULT_MATCH_XP.timeout),
    botXpMultiplier: Math.min(1, numberSetting(configured, "botXpMultiplier", 0.25)),
    dailyGameXpCap: bigintSetting(configured, "dailyGameXpCap", 1000n),
    dailyAccountXpCap: bigintSetting(configured, "dailyAccountXpCap", 3000n),
    dailyGldCap: bigintSetting(configured, "dailyGldCap", 5000n),
    sameOpponentDiminishingFactor: Math.min(1, Math.max(0.1, numberSetting(configured, "sameOpponentDiminishingFactor", 0.5))),
    scoreRewardCap: config.scoreRewardCap,
  }
}

export function normalizedMatchXp(policy: RewardPolicy, score: bigint, result: string, botMatch: boolean, repeatedOpponent: number): bigint {
  const boundedScore = Math.max(0, Number(score))
  const performance = Math.min(1, boundedScore * policy.scoreNormalizationFactor)
  let xp = BigInt(Math.round(Number(policy.maximumMatchXp) * performance))
  if (xp > 0n && xp < policy.minimumCompletionXp) xp = policy.minimumCompletionXp
  xp += result === "WIN" ? policy.winnerXpBonus : result === "DRAW" ? policy.drawXpBonus : result === "TIMEOUT" ? policy.timeoutXp : policy.loserXpBonus
  if (botMatch) xp = BigInt(Math.floor(Number(xp) * policy.botXpMultiplier))
  if (repeatedOpponent > 0) xp = BigInt(Math.floor(Number(xp) * Math.pow(policy.sameOpponentDiminishingFactor, repeatedOpponent)))
  return xp > policy.maximumMatchXp ? policy.maximumMatchXp : xp
}
