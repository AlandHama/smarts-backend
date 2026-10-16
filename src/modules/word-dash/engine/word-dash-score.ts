export type WordDashScoreTable = Record<string, number> & {
  extraLetterAfter8?: number
}

export type WordDashComboBonuses = {
  three: number
  five: number
  eight: number
  max: number
}

export type WordDashPolicy = {
  enabled: boolean
  visibleName: string
  description: string
  rulesVersion: string
  dictionaryVersion: string
  boardSize: number
  durationSeconds: number
  minimumWordLength: number
  allowDiagonal: boolean
  casualEnabled: boolean
  rankedEnabled: boolean
  practiceEnabled: boolean
  casualBotEnabled: boolean
  rankedBotFallback: boolean
  comboWindowMs: number
  maxSubmissionsPerSecond: number
  maxAcceptedWordsPerPlayer: number
  wordScoreCap: number
  matchScoreCap: number
  scoreTable: WordDashScoreTable
  comboBonuses: WordDashComboBonuses
  bot: {
    enabled: boolean
    reactionDelayMs: number
    jitterMs: number
    skill: number
    maxWords: number
    maxWordLength: number
  }
}

export const DEFAULT_WORD_DASH_POLICY: WordDashPolicy = {
  enabled: true,
  visibleName: "Word Dash",
  description: "Find words fast.",
  rulesVersion: "word-dash.v1",
  dictionaryVersion: "english.v3",
  boardSize: 5,
  durationSeconds: 60,
  minimumWordLength: 3,
  allowDiagonal: true,
  casualEnabled: true,
  rankedEnabled: false,
  practiceEnabled: true,
  casualBotEnabled: true,
  rankedBotFallback: false,
  comboWindowMs: 4000,
  maxSubmissionsPerSecond: 12,
  maxAcceptedWordsPerPlayer: 250,
  wordScoreCap: 20000,
  matchScoreCap: 250000,
  scoreTable: { "3": 100, "4": 200, "5": 350, "6": 550, "7": 800, "8": 1100, extraLetterAfter8: 150 },
  comboBonuses: { three: 0.1, five: 0.18, eight: 0.25, max: 0.25 },
  bot: { enabled: true, reactionDelayMs: 1800, jitterMs: 850, skill: 0.35, maxWords: 35, maxWordLength: 7 },
}

export function scoreForWord(length: number, policy: WordDashPolicy): number {
  if (length < policy.minimumWordLength) return 0
  const exact = policy.scoreTable[String(length)]
  if (typeof exact === "number") return Math.min(policy.wordScoreCap, Math.max(0, Math.floor(exact)))
  if (length > 8) {
    const base = Number(policy.scoreTable["8"] ?? 1100)
    const extra = Number(policy.scoreTable.extraLetterAfter8 ?? 150)
    return Math.min(policy.wordScoreCap, Math.max(0, Math.floor(base + extra * (length - 8))))
  }
  return 0
}

export function comboBonus(combo: number, policy: WordDashPolicy): { label: string | null; bonus: number } {
  const configured = combo >= 8 ? policy.comboBonuses.eight : combo >= 5 ? policy.comboBonuses.five : combo >= 3 ? policy.comboBonuses.three : 0
  const bonus = Math.min(policy.comboBonuses.max, Math.max(0, configured))
  const label = combo >= 8 ? "WORD RUSH" : combo >= 5 ? "COMBO ×3" : combo >= 3 ? "COMBO ×2" : null
  return { label, bonus }
}
