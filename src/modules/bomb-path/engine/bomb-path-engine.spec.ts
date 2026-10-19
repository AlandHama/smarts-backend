import assert from "node:assert/strict"
import { DEFAULT_BOMB_PATH_POLICY, bombPathRoundSpec, scoreBombPathRound } from "./bomb-path-score"
import { advanceBombPathPhase, generateBombPathField, validateBombPathStep, validateCompletedBombPath } from "./bomb-path-engine"

/** Framework-neutral deterministic vectors. */
export function runBombPathEngineVectors() {
  const spec = bombPathRoundSpec(DEFAULT_BOMB_PATH_POLICY, 0)
  const first = generateBombPathField("fixture-seed", spec)
  assert.deepEqual(generateBombPathField("fixture-seed", spec), first)
  const lateField = generateBombPathField("route-fixture", bombPathRoundSpec(DEFAULT_BOMB_PATH_POLICY, 4))
  const route = new Set(lateField.safePath.map((point) => point.row + ":" + point.column))
  assert.equal(lateField.bombs.every((point) => !route.has(point.row + ":" + point.column)), true)
  const started = validateBombPathStep(first, [], first.flag)
  assert.equal(started.outcome, "SAFE")
  assert.equal(validateBombPathStep(first, started.path, first.flag).outcome, "INVALID")
  assert.equal(validateCompletedBombPath(first, first.safePath).accepted, true)
  assert.equal(advanceBombPathPhase({ phase: "MEMORIZE", currentRoundIndex: 0, roundCount: 5, memorizeEndsAt: 10, playEndsAt: 20, resultEndsAt: null }, 10).state.phase, "PLAY")
  assert.equal(scoreBombPathRound("BOMB_HIT", 1, 2, first.shortestSafePathLength, spec, DEFAULT_BOMB_PATH_POLICY).total, 0)
  const score = scoreBombPathRound("SUCCESS", 0, first.shortestSafePathLength, first.shortestSafePathLength, spec, DEFAULT_BOMB_PATH_POLICY)
  assert.equal(score.total, DEFAULT_BOMB_PATH_POLICY.baseRoundScore + DEFAULT_BOMB_PATH_POLICY.speedBonusMax + DEFAULT_BOMB_PATH_POLICY.efficiencyBonusMax)
  return true
}
