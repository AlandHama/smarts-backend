# Bomb Path — SMARTS Implementation Plan

## Status

Phases 0–3 are implemented in the NestJS backend. Flutter gameplay, the
main-menu surface, the shared result route, and client release safeguards for
Phases 4–5 are implemented in the SMARTS Flutter app. Device/load validation
and production rollout decisions remain operational release work.

## 1. Product and identity lock

### 1.1 Recommended name

**Bomb Path** is the recommended player-facing name. It is short, clear, and
fits SMARTS game names such as Gem Blitz, Tile Rush, Word Dash, Domino Duel,
and Perfect Timing.

~~~text
display name: Bomb Path
stable game key: bomb_path
rules version: bomb-path.v1
initial modes: CASUAL, RANKED, PRACTICE
players: 2
default match: 5 rounds, approximately 30–45 seconds
winner: highest verified total score
tie: DRAW unless a future policy adds a tie-break
~~~

Bomb Path must reuse the existing SMARTS GameDefinition, GameConfig, Match,
MatchParticipant, MatchRound, MatchEvent, MatchSettlement, matchmaking,
authenticated realtime, bot, progression, ranking, notification, analytics,
rematch, share-card, leaderboard, and System Admin infrastructure.

Do not create a second wallet, matchmaking system, ranking system, settlement
system, notification system, or socket-authentication system.

### 1.2 Player promise

> Memorize the bombs. Drag from the flag to the trophy. Reach the trophy
> without touching a bomb.

The player should understand the game within one round:

1. The same field is shown to both players.
2. During MEMORIZE, the flag, trophy, and bombs are visible.
3. During PLAY, bombs disappear.
4. The player holds the flag and drags through orthogonally adjacent cells.
5. Touching a bomb immediately ends that player's round with zero points.
6. Reaching the trophy completes the round and awards speed-based points.

### 1.3 V1 rules

- Five rounds by default.
- One deterministic field per round, shared by both players.
- Flag and trophy are never bombs.
- Movement is orthogonal only: up, down, left, right.
- Diagonal movement and skipped cells are invalid.
- A cell cannot be visited twice, except immediate backtracking to remove the
  last cell from the current path.
- Bomb contact ends that player's current round immediately.
- A successful path ends when it reaches the trophy.
- A player cannot submit after their round is terminal.
- A round advances after both players are terminal or the play deadline expires.
- The server decides path validity, bomb contact, score, and winner.
- Practice does not affect rating, ranked progression, or competitive rewards.

### 1.4 V1 exclusions

Do not include initially:

- diagonal paths;
- player-specific bomb fields;
- live opponent path positions;
- moving bombs or moving goals;
- power-ups, shields, teleports, portals, or extra lives;
- direct attacks against the opponent;
- client-authoritative bomb detection, timing, score, or winner state;
- paid gameplay advantages in ranked mode;
- arbitrary client-selected grids or bomb counts;
- unbounded replay/event payloads;
- a separate result or settlement flow that bypasses SMARTS.

## 2. Reference visual and experience

The supplied screenshot is a four-panel product direction, not a literal
device layout. Preserve its information hierarchy while reusing SMARTS'
responsive components and shared game/result patterns.

### 2.1 Lobby / introduction

Show:

- SMARTS header with back navigation and currency affordance;
- a large BOMB PATH title with a simple bomb-and-path visual;
- Memorize. Plan. Reach the trophy!;
- a short explanation of remembering bomb locations and dragging a safe path;
- compact markers for 1v1, 30–45s, and Ranked;
- one clear Play action.

This is a lobby/preview surface only. It must not duplicate matchmaking or
create a second match lifecycle.

### 2.2 Memorize phase

The reference shows:

- both player avatars and names;
- a five-step round indicator;
- Memorize the field! and a countdown such as 00:03;
- a square grid with the flag, trophy, and bomb icons visible;
- Memorize the start, trophy and bomb locations.

The bomb icon must remain readable on small phones. The grid stays square and
centered rather than stretching into a rectangle.

### 2.3 Play phase

Change the banner to Your turn! and hide every bomb. Render the active path
as a connected glowing sequence of cells. The current cell has the strongest
outline; the flag and trophy remain visible.

~~~text
unvisited cell       dark navy tile with a subtle border
current path         blue/cyan fill with connected glow
successful path      green fill and green edge glow
failed path          red fill, impact flash, and bomb feedback
flag                 red flag icon in a highlighted start tile
trophy               gold trophy icon in a highlighted goal tile
bomb (memorize only) black bomb with a red/orange fuse
~~~

The input is a continuous finger gesture: hold on the flag, drag over
neighboring cells, and release at the trophy or elsewhere.

### 2.4 Round and match results

Keep the screenshot's short reactions inside the game:

- safe arrival: trophy pulse, green path completion, score reveal;
- bomb contact: short explosion, red round banner, zero-point reveal;
- timeout/incomplete path: neutral or red timeout banner, zero points;
- final match result: normal SMARTS result screen with both avatars, names,
  final scores, win/loss/draw, rewards, rematch, and exit actions.

Do not make the red or green round panel the final settlement surface.

## 3. Match structure and round contract

### 3.1 Default ladder

All values are policy defaults captured on the match, not Flutter constants.

| Round | Grid | Bombs | Memorize | Play | Difficulty intent |
| ---: | ---: | ---: | ---: | ---: | --- |
| 1 | 5 × 5 | 2 | 3,500 ms | 8,000 ms | obvious route and generous memory |
| 2 | 6 × 6 | 4 | 3,000 ms | 8,000 ms | longer route and more alternatives |
| 3 | 7 × 7 | 6 | 2,750 ms | 8,000 ms | more branching and less empty space |
| 4 | 8 × 8 | 8 | 2,500 ms | 7,500 ms | denser hazards and longer route |
| 5 | 9 × 9 | 10 | 2,000 ms | 7,500 ms | highest observation pressure |

The default result/transition window is 900 ms. Expected match duration is
approximately 30–45 seconds, excluding matchmaking and the final result.

### 3.2 Shared phase, independent player outcome

The authoritative lifecycle is:

~~~text
CREATED → MEMORIZE → PLAY → ROUND_RESULT
                    ↘ next MEMORIZE → ... → COMPLETE
~~~

Each participant has an independent status:

~~~text
READY | PLAYING | SUCCESS | BOMB_HIT | TIMEOUT | ABANDONED
~~~

The field and phase are shared. One player reaching the trophy does not change
the other player's field or reveal the other route. The server closes the
round when both players are terminal or the shared play deadline expires.

If one player finishes early, their grid becomes non-interactive and shows
SAFE PATH FOUND while the other player continues until their result or the
deadline. This avoids making a fast player wait indefinitely.

### 3.3 Match timeout and recovery

The server also stores a match-level deadline, slightly longer than the sum of
all phase deadlines and transition windows. On every snapshot, action,
realtime recovery, and maintenance tick:

1. lock the match;
2. advance expired phase/round state;
3. finalize expired participants and the match when required;
4. settle through the shared SMARTS transaction;
5. return the canonical projection.

No client may keep a match in STARTED by avoiding the final screen.

## 4. Deterministic field generation

### 4.1 Seed and commitment

At match creation, capture:

~~~text
matchId
serverSeed
rulesVersion
policyVersion
generationVersion
roundCount
fieldCommitments[]
~~~

Each round has one immutable field generated from the server seed and round
index. Both players receive the same grid dimensions, flag, trophy, bomb set,
safe-route constraints, and commitment.

The commitment hashes this canonical representation:

~~~text
rulesVersion
generationVersion
roundIndex
gridSize
flagCell
trophyCell
bombCellsSorted
~~~

During MEMORIZE, bomb cells may be returned because the game requires them to
be visible. During PLAY, omit them from the public projection. The commitment
remains available for replay and protected dispute inspection.

This does not claim that a compromised client cannot inspect memory. It does
ensure that the server never trusts the client to decide whether a tile was a
bomb.

### 4.2 Generator constraints

The deterministic generator must:

1. choose grid size and bomb count from the captured round policy;
2. place flag and trophy at valid, separated cells;
3. reserve at least one orthogonal safe route;
4. place bombs only outside that route;
5. add remaining bombs through a seeded random stream;
6. prevent unfair bomb clusters when the policy disallows them;
7. verify shortest safe-route length is within configured bounds;
8. retry deterministically when a constraint fails;
9. persist the canonical field and commitment;
10. reproduce the same field for the same seed and generation version.

The safe route is a generator guarantee, not a route displayed to the player.

### 4.3 Pure engine boundary

Keep the engine independent of NestJS, Prisma, WebSockets, Flutter, and
current time. It should expose functions equivalent to:

~~~text
createRoundField(seed, roundIndex, policy)
fieldCommitment(field, rulesVersion, generationVersion)
validateNextCell(field, playerPath, nextCell)
validateCompletedPath(field, playerPath)
shortestSafePathLength(field)
scoreSuccessfulPath(roundSpec, path, completedAtServerMs, policy)
advancePhase(roundState, nowServerMs, policy)
~~~

## 5. Authoritative input contract

### 5.1 Client intent only

The client may send a cell intent such as:

~~~json
{
  "matchId": "uuid",
  "roundIndex": 2,
  "sequence": 17,
  "clientActionId": "uuid",
  "cell": { "row": 3, "column": 4 },
  "pathLengthBefore": 6,
  "clientMonotonicMs": 18342,
  "clientStartedAt": "ISO-8601",
  "clientReleasedAt": "ISO-8601"
}
~~~

It must never submit or trust isBomb, success, score, speedBonus,
pathIsValid, or winner.

### 5.2 Tile-by-tile validation

The preferred transport is an authoritative step intent for each newly
entered cell:

1. pointer-down must begin on the flag;
2. each new neighboring cell is sent as one step;
3. the server validates it against the persisted player path;
4. a safe step appends the cell and returns the canonical path;
5. a backtrack step removes only the immediately previous cell;
6. a bomb step records BOMB_HIT, closes the player round, and returns zero;
7. reaching the trophy records SUCCESS and calculates the score;
8. pointer-up sends complete if the player is not already terminal;
9. stale, duplicate, or out-of-order actions replay safely or request a
   reconcile.

The Flutter UI may render the path optimistically for touch responsiveness,
but it must reconcile after every accepted step and after reconnect. HTTP step
requests are the recovery path when realtime is unavailable.

### 5.3 Validation rules

For every step, validate:

- authenticated participant and active match;
- current round and PLAY phase;
- participant is still PLAYING;
- exact next sequence and unused client action id;
- coordinate bounds and first-cell flag rule;
- Manhattan adjacency to the current path end;
- no repeated cell except immediate backtracking;
- server phase deadline;
- no action after success, bomb hit, timeout, or abandonment.

Revalidate the complete canonical path at trophy arrival and completion. Client
path length is telemetry only.

### 5.4 Idempotency and locks

Every step and completion intent requires a client action id. The service must
lock the parent match, check the id before mutating state, enforce participant
sequence, persist accepted/rejected events, return the same result for retries,
and never award trophy points twice.

## 6. Scoring

The default score is readable and bounded:

~~~text
successful round base:       100 points
speed bonus:                   0–50 points
path efficiency bonus:         0–25 points
bomb hit:                       0 points
timeout/incomplete:             0 points
~~~

Suggested policy formula:

~~~text
speedRatio = clamp(remainingPlayMs / playDurationMs, 0, 1)
speedBonus = round(speedRatio * speedBonusMax)
efficiencyRatio = clamp(shortestSafePathLength / actualPathLength, 0, 1)
efficiencyBonus = round(efficiencyRatio * efficiencyBonusMax)
scoreDelta = success ? base + speedBonus + efficiencyBonus : 0
~~~

The actual path length excludes undone backtracks. The server records round
outcome, completion time, actual/shortest path lengths, score delta, bonuses,
and protected bomb/field references. Ordinary players see only useful result
statistics, not anti-cheat telemetry or hidden field details.

## 7. Backend domain design

### 7.1 Shared persistence

Start with the existing match models and Match.metadata, following the current
Tile Rush authoritative-state pattern. A five-round Bomb Path match is small
enough for compact metadata plus bounded MatchEvent replay records.

Use:

- GameDefinition for the bomb_path identity;
- versioned GameConfig for policy and progression settings;
- Match for lifecycle, seed, mode, and captured policy metadata;
- MatchParticipant for identity, result, final score, and readiness;
- MatchRound for the five shared round lifecycle records;
- MatchEvent for step intents, terminal outcomes, and replay/audit;
- MatchSettlement for normal SMARTS settlement;
- AnalyticsEvent for gameplay, fairness, and fraud metrics.

Do not add Bomb Path-specific tables in V1 unless replay volume, inspection
queries, or retention requirements prove metadata insufficient.

### 7.2 Captured state shape

The compact authoritative state should be equivalent to:

~~~text
BombPathMatchState {
  rulesVersion
  policyVersion
  generationVersion
  matchSeed
  roundCount
  currentRoundIndex
  phase
  phaseStartedAtServerMs
  phaseDeadlineAtServerMs
  matchDeadlineAtServerMs
  rounds[]
  players{}
  stateHash
}

BombPathRoundState {
  roundIndex
  gridSize
  flagCell
  trophyCell
  bombCells
  fieldCommitment
  phase
  memorizeDeadlineAtServerMs
  playDeadlineAtServerMs
  playerStatuses{}
}

BombPathPlayerState {
  participantId
  sequence
  roundStatus
  path[]
  score
  roundsWon
  bombHits
  successCount
  totalSpeedBonus
  totalEfficiencyBonus
  startedAtServerMs
  completedAtServerMs
  lastActionAtServerMs
}
~~~

The persisted field remains available to the server after the public projection
hides bombs. The state is captured per match so later policy changes cannot
alter an active game.

### 7.3 Service and controller shape

Follow current Tile Rush and Perfect Timing conventions:

~~~text
src/modules/bomb-path/
  bomb-path.module.ts
  bomb-path.controller.ts
  bomb-path.service.ts
  bomb-path-admin.controller.ts
  dtos/bomb-path.dto.ts
  dtos/bomb-path-admin.dto.ts
  engine/bomb-path-engine.ts
  engine/bomb-path-generator.ts
  engine/bomb-path-score.ts
  engine/bomb-path-hash.ts
~~~

Recommended HTTP surface:

~~~text
GET  /bomb-path/matches/:matchId
POST /bomb-path/matches/:matchId/start
POST /bomb-path/matches/:matchId/actions/step
POST /bomb-path/matches/:matchId/actions/complete
POST /bomb-path/matches/:matchId/reconcile
POST /bomb-path/matches/:matchId/forfeit
~~~

The exact route names may follow repository convention, but GET snapshot and
POST reconcile are mandatory for mobile recovery. Step and complete must share
the same validation and idempotency logic over HTTP and realtime.

## 8. Snapshot and realtime projection

### 8.1 Snapshot shape

The public snapshot should include:

~~~json
{
  "matchId": "uuid",
  "gameKey": "bomb_path",
  "status": "STARTED",
  "mode": "CASUAL",
  "round": {
    "current": 2,
    "total": 5,
    "phase": "PLAY",
    "gridSize": 6,
    "flag": { "row": 0, "column": 0 },
    "trophy": { "row": 5, "column": 5 },
    "bombs": [],
    "fieldCommitment": "sha256",
    "phaseDeadlineAt": "ISO-8601",
    "remainingMilliseconds": 6810
  },
  "self": {
    "sequence": 12,
    "roundStatus": "PLAYING",
    "path": [{ "row": 0, "column": 0 }],
    "score": 146
  },
  "participants": [],
  "serverNow": "ISO-8601",
  "serverNowMs": 0,
  "stateHash": "sha256"
}
~~~

Bombs are populated only while the shared phase is MEMORIZE or in protected
admin/replay responses. They are empty during PLAY, even though the server
retains the field.

The participant projection exposes opponent score and terminal status, but not
the opponent's live path. This keeps the game a memory challenge rather than a
race where watching the other player reveals route decisions.

### 8.2 Authenticated realtime events

Use the existing authenticated realtime gateway and match subscription:

~~~text
bomb_path.subscribe
bomb_path.snapshot
bomb_path.phase_changed
bomb_path.step.accepted
bomb_path.step.rejected
bomb_path.round_result
bomb_path.score.updated
bomb_path.match.finished
bomb_path.reconcile.required
bomb_path.error
~~~

Realtime actions must call the same service methods as HTTP. The socket path
must not bypass sequence, phase, deadline, lock, or idempotency validation.

### 8.3 Recovery

On app resume, socket reconnect, stale sequence, or failed action:

1. stop accepting new local path steps;
2. request the canonical snapshot;
3. replace local path and phase with server state;
4. preserve an unsent gesture only when it can be proven to start from the
   returned canonical path;
5. otherwise cancel the gesture and show a short resync message;
6. resume the server-clock-driven countdown.

## 9. Matchmaking, bots, and settlement

### 9.1 Registration

Register bomb_path in the existing game registry and matchmaking policy.
Support normal casual, ranked, and practice entry points and existing bot
fallback rules. Capture the active Bomb Path policy version at match creation.

### 9.2 Bot behavior

Bomb Path bots may read the protected field server-side, but must model
uncertainty:

| Skill | Memorize delay | Path behavior |
| --- | ---: | --- |
| Beginner | 700–1,100 ms | safe route with occasional wrong turns |
| Medium | 450–850 ms | mostly efficient routes and occasional mistakes |
| Hard | 250–600 ms | efficient routes with bounded jitter |

Bots use the same step, bomb, timeout, score, event, and settlement path as
humans. Never write a fabricated score directly into player state.

### 9.3 Completion and settlement

When the fifth round closes, a player forfeits, or the match deadline expires:

1. lock the match and advance expired phase state;
2. stop bot actions;
3. calculate verified final scores and round statistics;
4. write WIN, LOSS, or DRAW to MatchParticipant;
5. call the shared settlement transaction;
6. update rating, XP, GLD, streaks, missions, and notifications through
   existing flows;
7. emit the final realtime projection;
8. make finished-but-unsettled retries safe;
9. expose the same result through HTTP after reconnect.

Practice must not change ranked rating or competitive rewards.

## 10. Flutter implementation

### 10.1 Feature structure

Follow the existing Tile Rush, Word Dash, and Perfect Timing organization:

~~~text
lib/features/bomb_path/
  domain/
    bomb_path_models.dart
    bomb_path_engine.dart        # rendering/path geometry only
  presentation/
    providers/bomb_path_multiplayer_provider.dart
    widgets/bomb_path_grid.dart
    widgets/bomb_path_cell.dart
    widgets/bomb_path_hud.dart
    widgets/bomb_path_round_result.dart
  data/
    bomb_path_repository.dart

lib/infrastructure/railway/railway_bomb_path_service.dart
lib/presentation/screens/game/bomb_path_multiplayer_screen.dart
~~~

The provider owns lobby, searching, ready, playing, finished, and error state,
subscriptions, HTTP fallback, sequences, action ids, clock offset, and
reconciliation. Widgets render projections and never decide scores or outcomes.

### 10.2 Responsive grid

Use a square LayoutBuilder grid:

- no horizontal overflow or active-match scrolling;
- cell size derived from the smaller available dimension;
- stable cell keys based on round, row, and column;
- gaps and corner radius scale with grid size;
- icons remain readable from 5 × 5 through 9 × 9;
- safe-area padding is outside the grid;
- the grid remains centered on small phones and tablets;
- the player HUD compresses before the grid is made too small.

Paint the path between cell centers with a lightweight custom painter or stable
overlay. Do not rebuild the whole screen for every pointer move if a focused
path layer can update independently.

### 10.3 Drag input

Implement a pointer layer over the grid:

1. pointer-down maps to a cell and accepts only the flag;
2. pointer-move maps through the grid's local bounds;
3. repeated entry into the same cell is ignored;
4. entry into the previous cell backtracks one step;
5. a new adjacent cell adds a pending local step and sends one intent;
6. pointer-up sends complete unless the server already returned a terminal result;
7. success, bomb hit, timeout, or resync disables the gesture;
8. a second finger cannot create a second path or sequence.

The client may show an optimistic path, but a server rejection replaces it with
the canonical path. Haptics distinguish safe step, backtrack, trophy arrival,
bomb rejection, and round result.

### 10.4 Screen states

~~~text
Lobby       explanation and Practice/Casual/Ranked entry
Searching   existing SMARTS matchmaking state
Ready       player header and readiness state
Memorize    visible bombs, phase countdown, round indicator
Play        hidden bombs, drag path, play countdown, score HUD
RoundResult success/bomb/timeout reaction and next-round transition
Finished    redirect to shared SMARTS result surface
Error       retry, reconcile, or leave actions
~~~

The active screen includes both avatars and names, round progress, phase label,
countdown, current scores, local round outcome, and an exit/forfeit affordance.

### 10.5 Animation, sound, and accessibility

Required feedback:

- phase transition from MEMORIZE to PLAY;
- bomb fade-out without revealing extra locations;
- connected path glow and current-cell pulse;
- trophy arrival burst and score count-up;
- bomb explosion and red round feedback;
- round progress update;
- final result navigation without a stale round screen.

Respect reduced motion by reducing glow, particles, scale, and camera effects
without changing timing or touch behavior. Every cell needs a useful semantic
label such as unvisited cell, current safe path, starting flag, or trophy goal.
Hidden bombs must not be announced during PLAY.

Reuse SMARTS sound, haptic, mute, and audio settings for phase start,
countdown, safe steps, backtracking, trophy success, bomb impact, and results.

## 11. System Admin and policy

Add Bomb Path to the existing System Admin configuration/versioning flow.

Recommended policy fields:

~~~text
enabled
killSwitch
rolloutPercentage
visibleName
rulesVersion
generationVersion
roundCount: 3..7
gridSizeEarly: 5..7
gridSizeLate: 5..9
bombCountEarly: 1..5
bombCountLate: 4..20
memorizeDurationMs: 1200..6000
playDurationMs: 4000..15000
roundResultDurationMs: 300..2000
matchDurationSeconds
speedBonusMax
efficiencyBonusMax
baseRoundScore
orthogonalOnly
casualEnabled
rankedEnabled
practiceEnabled
casualBotEnabled
rankedBotFallback
bot
~~~

Reject policies with impossible fields, no safe route, invalid phase minimums,
a match duration shorter than the configured phases, missing commitments,
unsupported generation versions, negative scores, or unbounded scores.

Changing policy affects new matches only. Active matches retain policy, rules,
generation version, fields, and deadlines.

Admin operations should expose active/searching/finished/review/settled counts,
bomb-hit/success/timeout/path-rejection rates, average round time and path
length, score and bonus distributions, reconnects, stale sequences, duplicate
actions, settlement retries, replay/hash inspection, version history, rollback,
audit reason, and kill switch.

## 12. Fairness, fraud, and privacy

Record signals without automatically banning from one signal:

- impossible step frequency or movement speed;
- repeated bomb-free routes that contradict the hidden field;
- stale sequence and duplicate-action frequency;
- client clock anomalies and late submissions;
- repeated exact path timing across matches;
- abnormal reconnects or action bursts;
- field commitment/hash mismatches;
- bot-like route selection and timing regularity.

The server must not broadcast the opponent's path or hidden bomb cells during
PLAY. Replay/admin data may contain the complete field and route, but must be
access-controlled and excluded from ordinary player payloads.

## 13. Events and analytics

Recommended events:

~~~text
bomb_path_lobby_opened
bomb_path_queue_entered
bomb_path_match_created
bomb_path_match_started
bomb_path_memorize_started
bomb_path_play_started
bomb_path_step_accepted
bomb_path_step_rejected
bomb_path_backtracked
bomb_path_bomb_hit
bomb_path_round_completed
bomb_path_round_timed_out
bomb_path_match_completed
bomb_path_forfeited
bomb_path_reconnected
bomb_path_action_rejected
bomb_path_settlement_retried
~~~

Include mode, policy version, round index, grid size, bomb count, outcome,
score, path length, speed bonus, efficiency bonus, connection state, and
device class. Do not expose complete bomb maps in ordinary analytics.

## 14. Testing strategy

### 14.1 Pure engine

- same seed and policy produce the same fields;
- different seeds produce different fields;
- flag and trophy are never bombs;
- every field has at least one safe route;
- commitments are stable and change when field data changes;
- out-of-bounds, diagonal, skipped, repeated, and stale cells are rejected;
- immediate backtracking removes exactly one cell;
- bomb contact produces BOMB_HIT and zero score;
- trophy arrival produces SUCCESS and configured scoring;
- bonuses stay within caps;
- phase advancement is deterministic at exact deadlines;
- replaying actions reproduces the same state hash.

### 14.2 Backend integration

- both players see the same field commitment and memorize field;
- bombs disappear from PLAY projection;
- one player's bomb hit does not alter the opponent's field or score;
- early success does not block the other beyond the play deadline;
- duplicate step and completion requests are idempotent;
- stale sequences require reconciliation;
- HTTP and realtime use identical validation;
- timeout records missing player outcomes;
- fifth-round completion finalizes the generic match;
- worker recovery finalizes abandoned matches;
- settlement retry is safe;
- bots use the normal action path;
- practice does not alter ranking or rewards.

### 14.3 Flutter and device

- 5 × 5 and 9 × 9 grids fit narrow phones without overflow;
- MEMORIZE displays bombs and PLAY hides them;
- pointer-down must begin on the flag;
- movement selects only orthogonal neighbors;
- backtracking removes the previous cell;
- pointer-up sends one completion request;
- safe-step, bomb-hit, success, timeout, and resync states render;
- rapid movement does not duplicate steps;
- reconnect replaces optimistic path with canonical state;
- countdown follows the server clock after latency;
- reduced-motion and accessibility labels work;
- avatars, scores, and round progress render for human and bot opponents;
- final navigation reaches shared results after timeout, bomb hit, forfeit, and
  normal completion;
- rematch, share, rewards, and exit actions reuse existing behavior.

Test a narrow low-end Android phone, current iPhone with a notch, tablet,
high-refresh device, high latency, intermittent connectivity, app
background/resume, process death, large text, and reduced motion.

## 15. Phased implementation

### Phase 0 — Product, policy, and contract lock

- approve the Bomb Path name, bomb_path key, and bomb-path.v1 rules version;
- approve the five-round ladder, field constraints, phase durations, scoring,
  tie policy, and player status contract;
- define field commitments and protected/public projections;
- define casual, ranked, practice, and bot rollout policy;
- define match timer, phase clock, reconnect grace, and maintenance contract;
- add the game-definition/configuration seed-data plan;
- approve the supplied screenshot states as the visual reference.

### Phase 1 — Pure deterministic engine

- implement seeded field generation and safe-route guarantees;
- implement commitments and canonical serialization;
- implement orthogonal step validation and backtracking;
- implement bomb, trophy, timeout, and incomplete outcomes;
- implement speed/efficiency scoring and bounds;
- implement deterministic phase advancement;
- add TypeScript vectors, boundary/property tests, and replay fixtures;
- document equivalent Flutter geometry helpers without moving authority to client.

### Phase 2 — Authoritative match integration

- register game definition and versioned policy/config;
- initialize match state and captured policy metadata;
- add snapshot/start/step/complete/reconcile/forfeit HTTP routes;
- add transactional locking, idempotency, sequences, deadlines, and recovery;
- persist bounded step/outcome events and state hashes;
- add generic participant results and shared settlement;
- add integration tests for independent outcomes and timeout.

### Phase 3 — Realtime, matchmaking, bots, and operations

- add authenticated realtime subscription and action events;
- wire the existing two-player matchmaking policy;
- implement practice/casual bots through the normal step path;
- add reconnect and sequence recovery;
- add maintenance finalization and settlement retries;
- add admin policy versioning, rollout percentage, kill switch, replay
  inspection, audit logging, and metrics;
- add fraud observations and fairness/replay inspection.

### Phase 4 — Flutter gameplay

- add models, repository, provider, screen, HUD, and responsive grid;
- implement server-clock-driven MEMORIZE and PLAY phases;
- implement hold-and-drag input with optimistic visuals and reconciliation;
- add safe-step, backtrack, trophy, bomb, timeout, and round feedback;
- add avatars, scores, round indicator, haptics, sound, accessibility, and
  reduced motion;
- route final completion to the shared SMARTS result surface;
- add widget, golden, integration, and narrow-device tests;
- add the Bomb Path game card to the existing main menu treatment.

### Phase 5 — Release and balancing

- enable practice, then casual, then ranked behind rollout controls;
- verify field fairness, route availability, bomb-hit distribution, scores,
  settlement, progression, notifications, rematch, and leaderboard behavior;
- load-test step bursts, socket reconnects, worker expiry, and settlement retry;
- test small phones, iPhones, tablets, high latency, and resumed apps;
- tune memory/play durations, bomb density, route efficiency, bots, and scores;
- monitor success rate, bomb hits, timeouts, path length, rejects, reconnects,
  score distribution, and fairness before widening rollout;
- keep the kill switch available for new matches without corrupting active ones.

## 16. Definition of done

Bomb Path is ready when:

- both players receive the same deterministic field in every round;
- every field has at least one valid safe route;
- bombs are visible only during MEMORIZE in ordinary player projection;
- the server validates every path step and never trusts client score claims;
- touching a bomb produces a canonical zero-score round result;
- reaching the trophy scores through the versioned server policy;
- one player's pace or failure cannot change the other player's field;
- timeout and worker recovery always finalize and settle the match;
- duplicate, stale, out-of-order, HTTP, and realtime requests are safe;
- drag input feels smooth on narrow phones and reconciles after reconnect;
- reduced motion, haptics, audio, accessibility, avatars, and scores work;
- final results use normal SMARTS result/progression/rematch flow;
- practice, casual, ranked, bot, draw, forfeit, reconnect, and settlement paths
  are tested;
- System Admin can configure, audit, roll back, inspect, roll out, and disable
  new Bomb Path matches safely;
- no duplicate SMARTS match, wallet, ranking, settlement, notification, or
  realtime-authentication subsystem was introduced.
