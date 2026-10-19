# Perfect Timing — SMARTS Implementation Plan

## Status

Phases 0–3 are implemented in the NestJS backend: policy/registration, the deterministic engine, authoritative match/tap validation, realtime transport, matchmaking, bots, maintenance, and System Admin operations. Phases 4–5 are now implemented in the Flutter client and release controls: the responsive server-clock gameplay surface, press-time tap transport, reconciliation, results/rematch presentation, accessibility/reduced motion feedback, focused tests, rollout percentage, and a new-match kill switch. This document remains the implementation source of truth for **Perfect Timing**.

Perfect Timing must reuse SMARTS' existing `GameDefinition`, `GameConfig`, `Match`, `MatchParticipant`, `MatchEvent`, `MatchSettlement`, matchmaking, authenticated realtime, bot, progression, ranking, notification, analytics, rematch, leaderboard, and System Admin infrastructure. Do not create a second match, ranking, wallet, settlement, notification, or socket-authentication system for this game.

## 1. Product and rules lock

### 1.1 Game identity

| Field | V1 value |
| --- | --- |
| Display name | Perfect Timing |
| Stable game key | `perfect_timing` |
| Rules version | `perfect-timing.v1` |
| Initial modes | `CASUAL`, `RANKED`, `PRACTICE` |
| Players | 2 |
| Standard rounds | 10 |
| Practice rounds | 5 |
| Ranked configuration | 10–15 rounds, policy controlled |
| Target duration | 30–60 seconds |
| Winner | Highest verified total score |
| Tie result | Draw unless an active policy defines a tie-break |

The screenshot shows a five-round presentation (`Round 3/5`). That should be supported as the practice/preview configuration, while ranked should use the longer 10–15-round configuration described by the product brief. The round count must come from the server policy and must never be hardcoded by Flutter.

### 1.2 Core experience

Each round displays:

1. a horizontal timing rail;
2. a moving marker travelling left and right;
3. a small target zone;
4. a large `TAP` control;
5. the current round, remaining time, and current score;
6. player timing results after the round is adjudicated.

The player taps once per round. The closer the marker is to the target center at the authoritative tap time, the higher the score.

Both participants receive the same round schedule, target positions, target sizes, movement parameters, and difficulty sequence. Their input and score are independent, but the opportunity presented to each player is identical.

### 1.3 V1 scoring

The default score policy is:

| Judgement | Timing error | Points |
| --- | ---: | ---: |
| Perfect | `0–40 ms` | 100 |
| Great | `>40–100 ms` | 75 |
| Good | `>100–180 ms` | 40 |
| Miss | `>180 ms`, invalid, late, or absent | 0 |

Timing thresholds are server configuration, not client constants. The client may display the labels and animate immediate feedback, but it must not submit `Perfect`, `Great`, `Good`, or a score as an authoritative value.

The timing error is the absolute distance between the marker position and the target center at the estimated authoritative tap time. A tap inside the visible target is not automatically Perfect; the center and the versioned timing policy determine the judgement.

### 1.4 V1 exclusions

Do not include in the first implementation:

- player-specific round patterns;
- client-authoritative movement, timing, tier, score, winner, or leaderboard data;
- a second match or settlement system;
- paid timing advantages in ranked mode;
- hidden target changes that are not represented in the authoritative round spec;
- unlimited taps per round;
- ranked bots unless explicitly enabled by System Admin policy;
- player-created timing policies;
- a separate local-only score that can be submitted as the match result.

## 2. Difficulty and deterministic round schedule

### 2.1 Difficulty curve

The initial policy should make the first rounds easy to understand and make later rounds harder without becoming visually unreadable.

| Round band | Marker speed | Target width | Allowed modifiers |
| --- | --- | --- | --- |
| Early | slow | large | linear ping-pong, gentle easing |
| Middle | medium | medium | direction changes, varied start phase |
| Late | fast | small | acceleration, target movement, decoy slowdown |

Recommended policy bounds:

```text
roundCount: 5..15
roundDurationMs: 1,800..5,000
interRoundDurationMs: 350..1,200
targetWidthPercent: 4..22
markerSpeedPercentPerSecond: 20..240
perfectWindowMs: 10..80
greatWindowMs: 30..140
goodWindowMs: 80..240
```

The active policy must validate that the score windows are ordered and that the target remains possible to hit. An intentionally impossible round is not permitted in ranked play.

### 2.2 Movement model

The engine should use a deterministic, continuous function rather than a sequence of client-generated animation frames.

For a normal horizontal round:

```text
phase = startPhase + speed * elapsedMs
pingPong = triangleWave(phase)
markerX = lerp(railStartX, railEndX, pingPong)
```

The round spec may select a versioned movement model:

```text
LINEAR_PING_PONG
EASED_PING_PONG
ACCELERATE_AND_REVERSE
TARGET_DRIFT
FAKE_SLOWDOWN
```

All movement functions must be pure and versioned. The server can evaluate `markerPositionAt(serverTime)` without receiving animation frames from a device. Flutter uses the same round spec and server-clock offset to render the motion smoothly, but the rendered position is never trusted for scoring.

### 2.3 Schedule generation

At match creation, the server generates one immutable schedule from a server-owned seed:

```text
matchId
seedCommitment
rulesVersion
policyVersion
roundCount
roundSpecs[]
```

Each `roundSpec` contains only the data needed to render and validate that round:

```text
roundId
roundIndex
movementModel
railStart
railEnd
targetCenter
targetWidth
startPhase
speed
easingVersion
startedAtServerMs
tapDeadlineServerMs
visualModifiers
```

Do not generate the schedule independently on each client. Do not use device randomness. The schedule must be reproducible from the persisted server seed and the rules version for replay and dispute investigation.

Future round specs may be released just before the round begins instead of sending the full schedule at match start. If future rounds are hidden, the server must still expose a commitment/hash so both players can later verify that the schedule was not changed after seeing their taps.

## 3. Authoritative timing and anti-cheat contract

### 3.1 Client input is intent only

Flutter sends a tap intent similar to:

```json
{
  "matchId": "uuid",
  "roundId": "uuid",
  "sequence": 12,
  "clientActionId": "uuid",
  "clientTapMonotonicMs": 18342,
  "clientClockMs": 1770000000123,
  "clientRenderedMarkerX": 0.51
}
```

`clientRenderedMarkerX` is optional telemetry only. It is never used for scoring. The request must not contain `tier`, `score`, `timingErrorMs`, `markerPosition`, or `isPerfect` as trusted fields.

### 3.2 Clock synchronization

At match start and on reconnect, the client performs a small server-time handshake. The server returns a timestamp and the client estimates:

```text
serverClockOffsetMs
roundTripTimeMs
clockConfidence
```

Flutter records the tap on `onTapDown` using a monotonic clock, not a wall clock that can jump when the device sleeps or changes time zones. The server estimates the tap timestamp using the bounded clock offset and transport timing data.

The server must:

- use a monotonic server clock for active match timing;
- cap accepted clock correction to a configured maximum;
- reject a tap when clock confidence is too low and request resynchronization;
- reject taps outside the round's start/deadline window;
- never reward a client for claiming a timestamp earlier than its last accepted event;
- retain receive time, estimated tap time, offset, RTT, and confidence for replay/audit.

Network latency cannot be removed perfectly from a remote tap. The chosen contract should be documented in the match snapshot and applied equally to both players. A future native low-latency transport may improve the estimate without changing the game rules.

### 3.3 Server judgement

The pure engine must calculate:

```text
markerPositionAt(roundSpec, estimatedTapServerMs)
distance = abs(markerPosition - targetCenter)
timingErrorMs = positionDistanceToTimingError(distance, roundSpec)
judgement = classify(timingErrorMs, scorePolicy)
scoreDelta = scorePolicy.points[judgement]
```

The implementation may use either a time-window policy or a position-to-time conversion, but it must be consistent for the complete rules version. The engine must return the same answer for the same round spec and tap timestamp on every machine.

### 3.4 One tap per round

The first valid tap intent for a participant and round consumes that participant's action. Later taps are rejected as duplicates, even if a later tap would score higher.

If no tap is received before the deadline, the server records an automatic `MISS` with `scoreDelta: 0`. A disconnected player must not be able to reconnect and submit a late tap for a closed round.

### 3.5 Idempotency and ordering

Every tap includes `clientActionId` and the participant sequence. The server must:

- process a tap at most once;
- return the original accepted response for a retried action;
- reject stale or future sequences;
- lock the participant/round mutation transactionally;
- broadcast one canonical event sequence;
- preserve the action receipt for replay and support investigation.

## 4. Match state machine

The authoritative lifecycle is:

```text
CREATED
  → READY
  → ROUND_STARTING
  → ROUND_ACTIVE
  → ROUND_ADJUDICATING
  → ROUND_RESULT
  → ROUND_STARTING     (next round)
  → MATCH_COMPLETING
  → COMPLETED
```

Exceptional transitions:

```text
any active state → PAUSED_FOR_RECONNECT
any active state → FORFEITED
any active state → EXPIRED
```

Rules:

- `ROUND_STARTING` publishes the round spec, server start time, and deadline.
- `ROUND_ACTIVE` accepts at most one tap per participant.
- `ROUND_ADJUDICATING` waits only until both actions arrive or the deadline expires.
- `ROUND_RESULT` publishes both judgements, score deltas, totals, and the next-round countdown.
- the match completes only after every participant has a canonical result for the final round;
- settlement and progression run through existing SMARTS match transactions.

The client may animate transitions optimistically, but it must reconcile to the server state after every accepted event and after every reconnect.

## 5. Backend domain design

### 5.1 Shared infrastructure

Register Perfect Timing as a normal game definition and reuse:

- `GameDefinition` and versioned `GameConfig`;
- generic `Match` and `MatchParticipant` records;
- generic match creation/start/forfeit/complete transactions;
- existing matchmaking ticket and policy logic;
- authenticated realtime gateway and sequence handling;
- existing bot gameplay service;
- ranking, settlement, progression, rewards, analytics, and rematch flows;
- System Admin game enablement, configuration, and kill switches.

Only the timing-specific round state and engine should be new. Do not copy the generic match lifecycle into a Perfect Timing module.

### 5.2 Timing-specific domain objects

Use a versioned, server-owned representation equivalent to:

```text
PerfectTimingMatchState {
  matchId
  rulesVersion
  policyVersion
  roundCount
  currentRoundIndex
  state
  scheduleCommitment
  serverClockEpoch
  participants[]
  rounds[]
  publicScoreProjection
  sequence
  stateHash
}

PerfectTimingRoundState {
  roundId
  roundIndex
  status
  startedAtServerMs
  tapDeadlineServerMs
  participantActions[]
  resultPublishedAtServerMs
}

PerfectTimingParticipantRoundAction {
  participantId
  clientActionId
  sequence
  receivedAtServerMs
  estimatedTapAtServerMs
  clockOffsetMs
  roundTripTimeMs
  clockConfidence
  timingErrorMs
  judgement
  scoreDelta
}
```

Use the existing event/audit pattern where possible. If a new persisted table or JSON state is required, add it through a versioned Prisma migration and preserve enough information to replay every judgement without trusting a client payload.

### 5.3 Pure engine boundary

Keep the timing engine independent of NestJS, Prisma, WebSockets, and Flutter. It should expose functions equivalent to:

```text
createSchedule(seed, policy, rulesVersion)
markerPositionAt(roundSpec, serverTimeMs)
evaluateTap(roundSpec, tapTimestampServerMs, scorePolicy)
resolveMissingTap(roundState, deadlineServerMs)
computeMatchResult(roundResults, tiePolicy)
```

The engine must not read the database, use current time directly, or emit notifications. The application layer supplies timestamps and persists the returned decisions.

## 6. HTTP API and recovery contract

Prefer the existing generic match endpoints and add the smallest timing-specific endpoints needed for initialization and tap submission.

Recommended contract:

```text
GET  /matches/:matchId
POST /matches/:matchId/start
POST /matches/:matchId/perfect-timing/taps
GET  /matches/:matchId/perfect-timing/state
POST /matches/:matchId/forfeit
POST /matches/:matchId/reconnect
```

The exact route names should follow the current controller conventions. `GET state` is mandatory as a mobile recovery path; it must return the canonical current round, sequence, public scores, the requesting participant's private action state, the server clock estimate, and any already-published results.

### 6.1 Tap response

An accepted tap response should include:

```text
accepted
clientActionId
matchId
roundId
participantId
estimatedTapAtServerMs
timingErrorMs
judgement
scoreDelta
totalScore
canonicalSequence
stateHash
```

If the round result is not yet publishable because the opponent has not tapped, the response must clearly say `ROUND_AWAITING_OPPONENT`. It must not leak the opponent's unsubmitted action.

Rejected responses must use stable error codes such as:

```text
MATCH_NOT_ACTIVE
ROUND_NOT_ACTIVE
ROUND_ALREADY_RESOLVED
DUPLICATE_ACTION
STALE_SEQUENCE
TAP_TOO_EARLY
TAP_TOO_LATE
CLOCK_RESYNC_REQUIRED
PARTICIPANT_NOT_FOUND
```

## 7. Realtime contract

Use the existing authenticated WebSocket gateway. Every event needs a match sequence, server timestamp, and rules/policy version.

Recommended events:

```text
perfect_timing.match_snapshot
perfect_timing.clock_sync
perfect_timing.round_starting
perfect_timing.round_started
perfect_timing.tap_received
perfect_timing.round_result
perfect_timing.next_round
perfect_timing.match_completed
perfect_timing.opponent_disconnected
perfect_timing.reconnect_required
perfect_timing.state_changed
```

Privacy rules:

- `tap_received` may show that a participant has acted, but must not reveal the exact timing before the round result unless product policy explicitly allows it;
- `round_result` may reveal both timing labels and scores after the round closes;
- a participant's raw clock offset, RTT, and anti-cheat telemetry are private;
- the full schedule is public only when the active policy permits it;
- the client must ignore duplicate events and request state when a sequence gap is detected.

When a socket disconnects, the mobile client should reconnect, resubscribe, run clock sync, fetch state, and resume the current round if the server says it is still active. The server remains authoritative if the local animation has drifted.

## 8. Matchmaking, modes, and bots

### 8.1 Matchmaking

Register `perfect_timing` in the existing matchmaking policy with two seats. Matchmaking should consider mode, region/latency policy, skill/rating where available, and the existing queue timeout rules.

Suggested launch policy:

| Mode | Opponent policy | Rewards | Rounds |
| --- | --- | --- | --- |
| Practice | immediate server bot | none | 5 |
| Casual | human first, bot fallback | normal casual rewards | 10 |
| Ranked | human preferred/required | ranked settlement | 10–15 by policy |

Ranked bot fallback must be disabled by default. If operations later enable it, the match and UI must explicitly identify the opponent as a bot and the rating policy must define whether the result affects rating.

### 8.2 Bot timing

Bots run on the server and submit the same validated action shape as a participant. Their timing error is sampled from a configured distribution:

```text
EASY:   mostly GOOD, occasional MISS
MEDIUM: GOOD/GREAT mix, occasional PERFECT
HARD:   mostly GREAT/PERFECT with bounded variance
```

The bot must use the same round spec, deadlines, and engine as a human. Never let a bot call a private “set score” path.

## 9. Flutter implementation plan

### 9.1 Feature structure

Add a dedicated feature following the existing SMARTS game organization, for example:

```text
lib/features/perfect_timing/
  data/
  domain/
  presentation/
    screens/
    widgets/
    providers/
```

The feature should depend on shared match/realtime/auth/progression services rather than creating game-specific copies.

### 9.2 Screen layout from the supplied reference

The first mobile screen should reproduce the supplied Perfect Timing reference with responsive sizing and safe-area support:

- dark navy-to-purple background;
- thin neon magenta outer frame/glow;
- top pink circular round indicator;
- `PERFECT TIMING` title and `Tap at the right moment!` subtitle;
- compact round progress pill and countdown timer pill;
- centered instruction text;
- rounded timing rail with a high-contrast green target zone;
- white marker with a visible shadow/highlight;
- large purple gradient `TAP` button with pressed/disabled states;
- compact player row with avatars, names, and the latest timing values;
- bottom explanatory copy and result feedback;
- no horizontal page overflow and no scrolling during an active round.

The layout must work on small phones, large phones, notched devices, landscape fallback, dynamic text sizes, and reduced-motion settings. The rail and target should remain visually distinguishable for color-impaired players through shape, outline, label, and contrast—not color alone.

### 9.3 Animation architecture

Use one server-clock-driven animation timeline per active round:

```text
serverNow = localMonotonicNow + serverClockOffset
elapsed = serverNow - round.startedAtServerMs
renderedMarker = markerPositionAt(roundSpec, serverNow)
```

Flutter may interpolate frames at 60/120 Hz for visual smoothness. It must not accumulate local frame deltas as the source of truth, because dropped frames and backgrounding would move the visual marker away from the authoritative timeline.

Required transitions:

- match entry and round intro;
- marker movement and direction reversal;
- target movement/size changes;
- tap press scale and haptic feedback;
- Perfect/Great/Good/Miss feedback;
- score count-up;
- round result to next-round transition;
- final result reveal;
- reconnect/resync without duplicating a round or resetting the score.

When reduced motion is enabled, keep the marker readable and the timing function unchanged while reducing glows, scale effects, and decorative particle motion.

### 9.4 Input behavior

The `TAP` button and the timing rail should accept the same action. Record on the earliest reliable press event (`onTapDown` or equivalent), disable the control immediately, and show a short pending state while the server receipt arrives.

The UI must:

- allow only one action per round;
- prevent double taps from creating two requests;
- preserve the local action id across retries;
- distinguish “submitted, waiting for opponent” from “round result received”;
- re-enable only when the server opens the next round;
- provide a clear disabled state during reconnect or adjudication.

Do not calculate the final score in the widget. The provider accepts server receipts and updates the screen from canonical state.

## 10. Results, progression, and presentation

At match completion, return the normal SMARTS result projection plus Perfect Timing details:

```text
winner
finalScores
roundCount
perfectCountByParticipant
greatCountByParticipant
goodCountByParticipant
missCountByParticipant
averageTimingErrorByParticipant
bestRoundByParticipant
rulesVersion
policyVersion
replayReference
```

Use the existing completion, settlement, progression, rating, rematch, notification, and leaderboard paths. Practice must not affect ranked rating or rewards.

The result screen should include:

- final score comparison;
- round-by-round timing summary;
- Perfect/Great/Good/Miss breakdown;
- best round highlight;
- rematch and exit actions;
- the normal SMARTS result/reward state;
- a clear draw state when totals are equal.

Do not display raw anti-cheat telemetry or clock offsets to ordinary players.

## 11. System Admin and operations

Expose the game through existing System Admin controls:

- enable/disable per mode;
- configure round count and duration bounds;
- configure movement model distribution;
- configure target width and speed curve;
- configure Perfect/Great/Good windows and points;
- configure ranked bot fallback;
- configure queue timeout and reconnect grace period;
- configure feature rollout percentage;
- kill switch new matches without corrupting active matches;
- inspect a match timeline and replay its authoritative judgements.

An active match must retain the policy and rules version captured at creation. Changing the admin configuration must affect only new matches.

Recommended metrics:

```text
perfect_timing.match_started
perfect_timing.match_completed
perfect_timing.round_started
perfect_timing.tap_accepted
perfect_timing.tap_rejected
perfect_timing.judgement_distribution
perfect_timing.average_timing_error
perfect_timing.clock_resync_rate
perfect_timing.reconnect_rate
perfect_timing.forfeit_rate
perfect_timing.client_server_position_drift
perfect_timing.bot_fallback_rate
perfect_timing.p95_tap_resolution_ms
```

Alert on unusual Perfect rates, repeated timestamp anomalies, high rejection rates, schedule-hash mismatches, settlement failures, or a sudden increase in client/server drift.

## 12. Security and fairness checklist

- The server owns the schedule, movement function, deadlines, judgement, score, winner, and final result.
- The client sends intent and timing evidence only.
- Never accept a client-submitted tier, score, timing error, marker position, or winner.
- Bind every tap to an authenticated participant, match, round, sequence, and idempotency key.
- Reject duplicate, late, early, future, stale, and out-of-order actions.
- Enforce one tap per participant per round transactionally.
- Use monotonic clocks and bounded clock synchronization.
- Store enough timing metadata to investigate disputes without exposing it in normal UI.
- Keep the same schedule and policy for both participants.
- Version the rules, movement functions, score thresholds, and schedule generator.
- Rate-limit tap endpoints and record suspicious invalid-action patterns through the existing fraud service.
- Do not allow a disconnected client to submit an action after a round has been resolved.
- Ensure a bot uses the same action and validation path as a human.

## 13. Testing strategy

### 13.1 Pure engine tests

Cover:

- deterministic schedule generation for a fixed seed;
- exact marker positions at known timestamps;
- direction reversals and movement-model boundaries;
- target movement and target-width bounds;
- Perfect/Great/Good/Miss boundary values;
- taps exactly on a threshold from both sides;
- early, late, absent, and duplicate taps;
- score totals and tie policies;
- replaying a complete match from the seed and accepted events;
- rules-version compatibility and invalid policy rejection.

Use property tests for continuity, bounded marker positions, valid target positions, and identical outputs across repeated runs.

### 13.2 Backend integration tests

Cover:

- match creation in casual, ranked, and practice modes;
- schedule commitment and participant privacy;
- concurrent taps for the same participant/round;
- idempotent retries after a timeout;
- both players tapping before and after the deadline;
- automatic misses;
- reconnect and state recovery;
- socket sequence gaps and duplicate events;
- bot timing through the normal action path;
- settlement, progression, rating, rematch, and practice exclusions;
- System Admin policy changes affecting only new matches.

### 13.3 Flutter tests

Cover:

- responsive reference layout on the smallest supported phone;
- safe-area/notch handling;
- no active-round scrolling or overflow;
- marker synchronization after a clock correction;
- tap captured once at press time;
- disabled/pending/retry states;
- duplicate realtime event handling;
- reconnect without replaying a completed round;
- result animations and reduced-motion behavior;
- accessibility labels, contrast, text scaling, haptics, and mute behavior;
- 60 Hz and 120 Hz rendering without changing the submitted timestamp.

Add golden tests for the initial round, active target, Perfect feedback, Miss feedback, opponent-waiting state, and final result state using fixed policy data.

### 13.4 Fairness and load tests

Simulate:

- different RTTs and jitter for both players;
- clock drift and sleep/resume;
- packet duplication, reordering, and loss;
- concurrent tap requests at a deadline;
- high match concurrency and reconnect storms;
- abnormal Perfect rates and replay divergence.

The result must remain determined by the server's captured schedule and accepted event log, not by frame rate, screen refresh rate, or local animation timing.

## 14. Implementation phases

### Phase 0 — Product and policy lock

- confirm ranked round count and practice five-round configuration;
- approve score windows, target widths, movement models, and tie policy;
- approve the timing/clock contract and privacy rules;
- add the game definition/configuration seed data plan;
- define rollout and ranked-bot policy.

### Phase 1 — Pure timing engine

- implement versioned schedule generation;
- implement movement functions and marker evaluation;
- implement judgement and scoring;
- implement deterministic replay fixtures;
- add boundary and property tests.

### Phase 2 — Authoritative match integration

- add the timing state/projection to the shared match lifecycle;
- add persistence/event records only where shared match events are insufficient;
- add clock synchronization and tap intent validation;
- add idempotency, transactional locking, deadlines, and recovery;
- add HTTP integration tests.

### Phase 3 — Realtime, matchmaking, and bots

- add authenticated round events and sequence recovery;
- register the two-player matchmaking policy;
- add practice bots through the normal action path;
- add reconnect and timeout behavior;
- add metrics, fraud observations, and replay inspection.

### Phase 4 — Flutter gameplay

- build the responsive reference UI;
- build the server-clock-driven rail animation;
- wire tap-down input, pending state, and realtime reconciliation;
- add results, rematch, haptics, audio, accessibility, and reduced motion;
- add widget/golden/device tests.

### Phase 5 — Operations and release

- add System Admin configuration and kill switch;
- enable practice first, then casual, then ranked behind rollout flags;
- verify settlement, progression, rating, notification, and leaderboard behavior;
- run latency/fairness/load testing;
- monitor Perfect distribution, drift, reconnects, and rejects before widening rollout.

## 15. Definition of done

Perfect Timing is ready for release only when:

- both players receive the same server-generated schedule;
- the server independently computes every judgement and score;
- Flutter never submits a trusted result;
- the bar animation follows the server timeline and remains smooth after reconnect;
- every round accepts at most one tap per participant;
- missing/late taps become canonical misses;
- duplicate and out-of-order requests are safe and idempotent;
- the mobile screen matches the supplied reference without overflow or active-game scrolling;
- practice, casual, ranked, bot, draw, forfeit, reconnect, settlement, and rematch paths are tested;
- replay can reproduce the final result from the persisted seed and event log;
- System Admin can configure and disable the game safely;
- ranked rollout is protected by a feature flag and monitoring;
- no duplicate SMARTS match, ranking, wallet, settlement, or notification subsystem was introduced.
