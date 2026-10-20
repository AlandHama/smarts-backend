import assert from "node:assert/strict"

import { deriveParticipantRewardEvidence, rewardEligibilityForParticipant } from "./match-reward-integrity"
import { normalizedMatchXp, rewardPolicy } from "./match-reward-policy"

/** Framework-neutral Phase 2 integrity vectors. */
export function runMatchRewardIntegrityVectors() {
  const now = new Date("2026-01-01T00:00:00.000Z")
  const evidence = deriveParticipantRewardEvidence([
    { eventType: "ANSWER", accepted: true, serverReceivedAt: now, payload: { verified: false, verificationMode: "LEGACY_CLIENT_CORRECTNESS" } },
    { eventType: "ANSWER", accepted: true, serverReceivedAt: new Date(now.getTime() + 2000), payload: { verified: true, correct: true, timeTakenMs: 800 } },
    { eventType: "FINISH", accepted: true, serverReceivedAt: new Date(now.getTime() + 2500), payload: { submitted: true } },
  ], false)
  assert.equal(evidence.acceptedActionCount, 2)
  assert.equal(evidence.acceptedScoringActionCount, 1)
  assert.equal(evidence.hasUnverifiedActions, true)
  assert.equal(rewardEligibilityForParticipant({ isPractice: false, isBotOpponent: false, isForfeit: false, hasUnverifiedActions: true, acceptedScoringActionCount: 0 }), "HELD")
  assert.equal(rewardEligibilityForParticipant({ isPractice: false, isBotOpponent: true, isForfeit: false, acceptedScoringActionCount: 1 }), "PARTIAL")

  const policy = rewardPolicy({ settings: null, scoreRewardCap: 500n }, "gem_blitz")
  const xp = normalizedMatchXp(policy, 15000n, "WIN", false, 0)
  assert.equal(xp <= policy.maximumMatchXp, true)
  assert.equal(normalizedMatchXp(policy, 15000n, "WIN", false, 2) < xp, true)
  return true
}
