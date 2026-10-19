import { createHash } from "node:crypto"
import {
  classifyPerfectTiming,
  PerfectTimingJudgement,
  PerfectTimingMode,
  PerfectTimingMovementModel,
  PerfectTimingPolicy,
  pointsForPerfectTiming,
} from "./perfect-timing-score"

export interface PerfectTimingRoundSpec {
  roundIndex: number
  durationMs: number
  movementModel: PerfectTimingMovementModel
  railStart: number
  railEnd: number
  targetCenter: number
  targetWidth: number
  startPhase: number
  speedCycles: number
  easingVersion: string
}

export interface PerfectTimingEvaluation {
  markerPosition: number
  timingErrorMs: number
  judgement: PerfectTimingJudgement
  scoreDelta: number
}

function randomUnit(seed: string, index: number): number {
  const digest = createHash("sha256").update(`${seed}:${index}`).digest("hex").slice(0, 8)
  return Number.parseInt(digest, 16) / 0xffffffff
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

function cycleElapsedMs(serverTimeMs: number, startedAtServerMs: number, durationMs: number): number {
  const elapsed = serverTimeMs - startedAtServerMs
  return ((elapsed % durationMs) + durationMs) % durationMs
}

function triangleWave(value: number): number {
  const phase = ((value % 1) + 1) % 1
  return phase <= 0.5 ? phase * 2 : 2 - phase * 2
}

function ease(model: PerfectTimingMovementModel, value: number): number {
  if (model === "EASED_PING_PONG") return value * value * (3 - 2 * value)
  if (model === "ACCELERATE_AND_REVERSE") return value < 0.5 ? 2 * value * value : 1 - Math.pow(-2 * value + 2, 2) / 2
  if (model === "FAKE_SLOWDOWN") return value < 0.45 ? value * 0.72 : 0.324 + (value - 0.45) * 1.23
  return value
}

export function createPerfectTimingSchedule(seed: string, policy: PerfectTimingPolicy, mode: PerfectTimingMode): PerfectTimingRoundSpec[] {
  // The schedule is a deterministic challenge bank. Players consume it at
  // their own pace until the shared match clock expires.
  const count = policy.challengeCount
  return Array.from({ length: count }, (_, roundIndex) => {
    const progress = count <= 1 ? 0 : roundIndex / (count - 1)
    const targetWidth = progress < 0.34 ? policy.targetWidthEarly : progress < 0.67 ? policy.targetWidthMiddle : policy.targetWidthLate
    const model = policy.movementModels[Math.floor(randomUnit(seed, roundIndex * 5 + 1) * policy.movementModels.length) % policy.movementModels.length]
    return {
      roundIndex,
      durationMs: policy.roundDurationMs,
      movementModel: model,
      railStart: 0.05,
      railEnd: 0.95,
      targetCenter: 0.18 + randomUnit(seed, roundIndex * 5 + 2) * 0.64,
      targetWidth,
      startPhase: randomUnit(seed, roundIndex * 5 + 3),
      speedCycles: 0.65 + progress * 0.7 + randomUnit(seed, roundIndex * 5 + 4) * 0.2,
      easingVersion: "perfect-timing-ease.v1",
    }
  })
}

export function markerPositionAt(round: PerfectTimingRoundSpec, serverTimeMs: number, roundStartedAtServerMs: number): number {
  const elapsed = cycleElapsedMs(serverTimeMs, roundStartedAtServerMs, round.durationMs)
  const progress = elapsed / round.durationMs
  const wave = ease(round.movementModel, triangleWave(round.startPhase + progress * round.speedCycles))
  return round.railStart + (round.railEnd - round.railStart) * clamp(wave, 0, 1)
}

export function targetCenterAt(round: PerfectTimingRoundSpec, serverTimeMs: number, roundStartedAtServerMs: number): number {
  if (round.movementModel !== "TARGET_DRIFT") return round.targetCenter
  const elapsed = cycleElapsedMs(serverTimeMs, roundStartedAtServerMs, round.durationMs)
  const drift = Math.sin((elapsed / round.durationMs) * Math.PI * 2 + round.startPhase * Math.PI * 2) * 0.12
  return clamp(round.targetCenter + drift, round.railStart + round.targetWidth / 2, round.railEnd - round.targetWidth / 2)
}

function nearestTargetCrossingMs(round: PerfectTimingRoundSpec, tapOffsetMs: number): number {
  const stepMs = 5
  let previousTime = 0
  let previousPosition = markerPositionAt(round, previousTime, 0)
  const crossings: number[] = []
  for (let time = stepMs; time <= round.durationMs; time += stepMs) {
    const position = markerPositionAt(round, time, 0)
    const before = previousPosition - targetCenterAt(round, previousTime, 0)
    const after = position - targetCenterAt(round, time, 0)
    if (before === 0) crossings.push(previousTime)
    if (before * after < 0 || after === 0) {
      const denominator = Math.abs(before) + Math.abs(after)
      const interpolation = denominator === 0 ? 0 : Math.abs(before) / denominator
      crossings.push(previousTime + interpolation * stepMs)
    }
    previousTime = time
    previousPosition = position
  }
  if (crossings.length) return crossings.reduce((best, current) => Math.abs(current - tapOffsetMs) < Math.abs(best - tapOffsetMs) ? current : best)
  return 0
}

export function evaluatePerfectTimingTap(round: PerfectTimingRoundSpec, tapAtServerMs: number, roundStartedAtServerMs: number, policy: PerfectTimingPolicy): PerfectTimingEvaluation {
  const tapOffsetMs = cycleElapsedMs(tapAtServerMs, roundStartedAtServerMs, round.durationMs)
  const nearest = nearestTargetCrossingMs(round, tapOffsetMs)
  const timingErrorMs = Math.round(Math.abs(tapOffsetMs - nearest))
  const judgement = classifyPerfectTiming(timingErrorMs, policy)
  return { markerPosition: markerPositionAt(round, tapAtServerMs, roundStartedAtServerMs), timingErrorMs, judgement, scoreDelta: pointsForPerfectTiming(judgement) }
}

export function perfectTimingScheduleCommitment(schedule: PerfectTimingRoundSpec[], rulesVersion: string, policyVersion: string): string {
  return createHash("sha256").update(JSON.stringify({ rulesVersion, policyVersion, schedule })).digest("hex")
}

export function perfectTimingStateHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}
