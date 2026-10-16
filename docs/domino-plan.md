# Domino Duel — Backend, Flutter, Realtime, Bot, and System Admin Implementation Plan

## Status

Phases 0–3 implemented in the NestJS backend. Flutter gameplay and System Admin operations remain planned for Phases 4–5. This document remains the source of truth for the rules, privacy contract, and transport payloads.

Domino must reuse SMARTS’ existing GameDefinition, GameConfig, Match, MatchParticipant, MatchEvent, MatchSettlement, matchmaking, bot, authenticated WebSocket, progression, ranking, wallet, notification, analytics, rematch, leaderboard, and admin authorization infrastructure. Do not create a second wallet, ELO, settlement, notification, or socket-authentication system for this game.

## 1. Product and rules lock

### 1.1 Game identity

| Field | V1 value |
| --- | --- |
| Display name | Domino Duel |
| Stable game key | domino |
| Rules version | domino.v1 |
| Initial modes | CASUAL, RANKED, PRACTICE |
| Seats | 4 total |
| Format | Free-for-all; each seat has an individual score and placement |
| Tile set | Double-six, 28 unique tiles |
| Default hand size | 5 tiles per seat |
| Default boneyard | 8 tiles |
| Default target | 100 match points |
| Ranked launch | Disabled until explicitly enabled by policy |

V1 is a four-player free-for-all, not a 2v2 team game. A player sees three opponents, three individual scores, and a final placement from first through fourth. The data model should leave room for a future TEAM_2V2 ruleset without mixing team scoring into V1.

The queue always targets four seats:

~~~
Seat 1: current player
Seat 2: human or bot
Seat 3: human or bot
Seat 4: human or bot
~~~

If fewer than three other real players are found by the configured fallback deadline, every missing seat is filled by a clearly disclosed server bot. A bot must be marked as BOT in server state, analytics, operations, and mobile UI. Never present a bot as an online human.

### 1.2 Why five tiles

Four players receiving seven tiles would consume all 28 tiles and leave no draw pile. V1 therefore deals five tiles to each seat and leaves eight tiles in the boneyard so draw/pass gameplay is meaningful. A future seven-tile variant must use a new rules version and apply only to new matches.

### 1.3 Product scope

Launch the game with:

- casual four-seat matches;
- practice matches with three bots immediately;
- ranked mode behind a feature flag;
- deterministic double-six deck and server-authoritative chain;
- draw, pass, doubles, blocked-round scoring, results, rematch, and replay;
- all-time global/friends leaderboard support through the existing leaderboard system.

Do not include in V1:

- 2v2 team scoring;
- custom tile sets;
- player-created rules;
- paid gameplay advantages in ranked;
- client-authoritative scores or hands;
- bots disguised as real players.

## 2. Core gameplay rules

### 2.1 Canonical tiles

The double-six deck contains exactly one of every unordered pair:

~~~
0|0  0|1  0|2  0|3  0|4  0|5  0|6
1|1  1|2  1|3  1|4  1|5  1|6
2|2  2|3  2|4  2|5  2|6
3|3  3|4  3|5  3|6
4|4  4|5  4|6
5|5  5|6
6|6
~~~

Each tile has a stable tileKey, such as 0-6. 0|6 and 6|0 are the same physical tile; orientation belongs to the played placement, not the tile identity.

~~~
DominoTile {
  tileKey
  valueA
  valueB
  pipTotal = valueA + valueB
}
~~~

### 2.2 Start player

The server determines the opening player:

1. highest double starts, with 6|6 highest;
2. if nobody has a double, the highest pip-total tile starts;
3. ties are resolved by seat order after the deterministic shuffle;
4. the opening tile is played automatically;
5. turns then proceed clockwise.

Store the opening tile, seat, tie-break reason, and initial chain hash in replay state.

### 2.3 Legal play

A tile can be placed on the left or right open end if one of its values matches that end. If both values match, both orientations are legal but expose the same value. Doubles are rendered perpendicular to the chain but still expose their matching value.

The server validates:

- authenticated ownership of the participant;
- active match and round;
- current turn ownership;
- next action sequence;
- tile ownership in the server hand;
- side is LEFT or RIGHT;
- tile matches the selected open end;
- idempotency key has not already been processed;
- server deadline has not passed;
- optional client chain hash is not stale.

The client sends intent only:

~~~
{
  "matchId": "uuid",
  "sequence": 14,
  "clientActionId": "uuid",
  "action": "PLAY_TILE",
  "tileKey": "2-6",
  "side": "RIGHT",
  "clientStartedAt": "2026-10-16T12:00:00.000Z",
  "clientReleasedAt": "2026-10-16T12:00:01.100Z",
  "chainHashBefore": "optional-sha256"
}
~~~

The client never submits a trusted score, winner, hand, open-end value, boneyard identity, or resulting chain.

### 2.4 Draw and pass

When a player has no legal tile:

1. DRAW_TILE draws exactly one tile from the top of the server-owned boneyard;
2. the player may draw again while tiles remain and the policy allows it;
3. a drawn tile remains in the player hand until played;
4. when the boneyard is empty and no legal tile exists, the player must PASS;
5. voluntary pass is rejected while a legal tile exists;
6. every draw and pass increments the sequence and creates an event;
7. the drawn tile is sent only to the player who drew it.

Recommended V1 policy:

~~~
maxDrawsPerTurn: all remaining boneyard tiles
autoPlayDrawnTile: false
passWhenNoPlayableTile: true
~~~

### 2.5 Round completion

A round ends when:

- a player has no tiles remaining;
- all players are blocked and no legal move exists;
- the authoritative round timer expires;
- a forfeit/disconnect policy ends the round.

For a normal win, the first player to empty their hand wins. For a blocked round, the player with the lowest remaining pip total wins; ties resolve by the most recent valid play and then seat order. A policy may instead mark a blocked round as a draw.

### 2.6 Match scoring

Default scoring:

~~~
open-hand winner:
  round points = sum of all opponents' remaining pips

blocked-round winner:
  round points = opponents' remaining pips - winner's remaining pips
  minimum round points = 1

other players:
  round points = 0
~~~

Round points accumulate in each player’s match score. The match ends when a player reaches 100 points, the configured round limit is reached, or the match deadline expires. Highest score wins; equal final scores produce a draw unless a versioned policy defines a tie-break.

Policy bounds:

~~~
targetScore: 25..500
maxRounds: 1..20
roundDurationSeconds: 30..900
matchDurationSeconds: 60..1800
maxRoundPoints: 1..1000
~~~

## 3. Determinism, privacy, and authority

### 3.1 Match seed

At creation, persist:

~~~
matchId
seed
rulesVersion
policyVersion
shuffleAlgorithmVersion
seat assignment
startedAt
endsAt
~~~

Create the canonical 28-tile deck and shuffle it with a server-owned deterministic Fisher–Yates stream. The seed plus accepted action log must reproduce dealt hands, opening tile, draw sequence, chain, scores, and final placements.

### 3.2 Chain hash

After every accepted mutation compute:

~~~
chainHash = SHA-256(
  rulesVersion + roundNumber + sequence + orderedPlayedTileKeys +
  leftOpenValue + rightOpenValue + publicScoreProjection
)
~~~

Return the hash in every snapshot and accepted response. A client hash is only a reconciliation hint.

### 3.3 Hidden information

Responses must be recipient-specific:

- the current player receives exact values and order of their own hand;
- opponents receive only other hand counts;
- everyone receives the public chain, open ends, boneyard count, turn, scores, and seat metadata;
- a drawn tile is sent only to the drawer;
- full hands are revealed only when the result policy permits it;
- support replay hand reveals require role-based authorization and audit logging.

Never send complete match state to Flutter and rely on the client to hide hands.

## 4. Backend module and data design

### 4.1 Suggested module

~~~
src/modules/domino/
├── domino.module.ts
├── domino.controller.ts
├── domino.service.ts
├── domino-admin.controller.ts
├── domino-policy.service.ts
├── domino-replay.service.ts
├── domino-bot.service.ts
├── dto/
├── engine/
│   ├── domino-engine.ts
│   ├── domino-deck.ts
│   ├── domino-shuffle.ts
│   ├── domino-rules.ts
│   ├── domino-scoring.ts
│   ├── domino-bot-strategy.ts
│   └── domino-hash.ts
└── transactions/
~~~

The pure engine must not import NestJS, Prisma, HTTP, WebSocket, wallet, or notification code. It receives immutable state plus action and returns an accepted/rejected transition, public projection, private projection, replay event, and score delta.

### 4.2 Game definition and policy

Register:

~~~
gameKey: domino
displayName: Domino Duel
rulesVersion: domino.v1
~~~

Versioned config should include:

~~~
seatCount: 4
handSize: 5
boneyardSize: 8
targetScore: 100
maxRounds: 10
roundDurationSeconds: 300
matchDurationSeconds: 900
botFillEnabled: true
botFallbackDelaySeconds: 20
botDifficulty: NORMAL
rankedEnabled: false
scoringVersion: domino-score.v1
~~~

Policy is copied into a match at creation. Later edits apply only to new matches.

### 4.3 Prisma state

Reuse Match, MatchParticipant, MatchEvent, and MatchSettlement. Add a linked DominoMatchState only for fields generic match state cannot safely represent:

- match ID;
- rules/policy versions;
- protected seed reference;
- round number;
- current seat;
- next sequence;
- left/right open values;
- chain hash;
- boneyard count;
- target and deadline fields;
- last action time.

Represent each tile exactly once using a normalized DominoTileState or a protected equivalent:

- matchId, tileKey, valueA, valueB;
- zone: HAND, BONEYARD, CHAIN, or DISCARDED;
- owner participant and hand position when in a hand;
- chain position, side, orientation, and played-by participant when on chain;
- timestamps and integrity fields.

Required constraints:

- exactly 28 tiles per match;
- a tile can exist in only one zone;
- hand positions and chain positions are unique;
- all chain connections are valid;
- only a transaction can move a tile between zones.

Use MatchParticipant for seat, player/bot type, score, placement, result, action counts, and connection state. Do not create fake User rows for bots.

Store compact MatchEvent records for MATCH_CREATED, SEATS_FILLED, ROUND_STARTED, PLAY_TILE, DRAW_TILE, PASS, TURN_TIMEOUT, ROUND_COMPLETED, MATCH_COMPLETED, FORFEIT, and reconnect events. Never put private hands in public event payloads.

## 5. HTTP API

Follow existing controller conventions and provide equivalents to:

~~~
GET  /games/domino/config
POST /matches/:matchId/domino/start
GET  /matches/:matchId/domino/snapshot
POST /matches/:matchId/domino/actions/play
POST /matches/:matchId/domino/actions/draw
POST /matches/:matchId/domino/actions/pass
POST /matches/:matchId/domino/heartbeat
POST /matches/:matchId/domino/reconcile
POST /matches/:matchId/domino/forfeit
GET  /matches/:matchId/domino/results
~~~

Every mutable action requires clientActionId. The transaction must lock the match and Domino state, return the original response for a duplicate action ID, validate sequence and ownership, apply the pure engine transition, persist state/event/projection atomically, and publish realtime only after commit.

Rejected actions use stable codes without leaking hidden information:

~~~
MATCH_NOT_FOUND
NOT_YOUR_TURN
ACTION_ALREADY_PROCESSED
INVALID_SEQUENCE
TILE_NOT_IN_HAND
INVALID_SIDE
TILE_DOES_NOT_MATCH
DRAW_NOT_AVAILABLE
PASS_NOT_ALLOWED
MATCH_EXPIRED
ROUND_FINISHED
STALE_CHAIN
~~~

## 6. Matchmaking and bot fill

### 6.1 Queue rules

Register domino in the existing matchmaking game registry. Queue entries retain game, mode, player, ticket, rating/level/country snapshots, client version, heartbeat, expiry, and optional party context.

The server assembles up to four real participants:

~~~
1 real + 3 bots after fallback
2 real + 2 bots after fallback
3 real + 1 bot after fallback
4 real → start immediately
~~~

Practice starts immediately with one human and three practice bots. Casual bot fallback is policy-controlled. Ranked bot fallback is disabled by default and requires an explicit audited policy change.

### 6.2 Lobby snapshot

Before start, Flutter receives four seat cards, human/bot identity, readiness, fallback countdown, mode, entry fee, rules version, and cancel/leave state. The match enters STARTED only after all four seats and initial state are committed in one server transaction.

## 7. Bot implementation

Extend the existing bot gameplay worker; bots must use the same engine and transaction path as humans.

V1 profiles:

| Profile | Behavior |
| --- | --- |
| EASY | Chooses a legal move with limited pip and flexibility awareness. |
| NORMAL | Reduces high pip totals and prefers tiles that preserve future options. |
| HARD | Scores both open ends, doubles, pip reduction, mobility, and public pressure. |

Bots may inspect only their own hand and public state, never human opponents’ hidden hands. Decisions must be reproducible from match seed, seat, policy, and action count. Bot actions have bounded simulated thinking delays, are recovered after worker restart, and never award bot ELO, GLD, XP, missions, achievements, streaks, or leaderboard records.

Add metrics for bot fill, decision latency, action rejection, worker recovery, and human/bot win rates.

## 8. Realtime protocol

Use the existing authenticated /ws gateway and match subscription.

Client events:

~~~
subscribe_match
domino.play_tile
domino.draw_tile
domino.pass
domino.heartbeat
domino.reconcile
unsubscribe_match
~~~

Server events:

~~~
domino.snapshot
domino.seats_updated
domino.round_started
domino.play_tile.accepted
domino.play_tile.rejected
domino.draw_tile.accepted
domino.pass.accepted
domino.turn_changed
domino.player_disconnected
domino.player_reconnected
domino.round_completed
domino.match_completed
domino.error
~~~

Realtime is an acceleration path. HTTP snapshot/reconcile must recover every state. Use monotonic sequence/event IDs, recipient-specific projections, and post-commit publication. Reject actions before subscription and authorize subscription from MatchParticipant ownership.

## 9. Flutter mobile plan

Suggested structure:

~~~
lib/features/domino/
├── domain/domino_models.dart
├── domain/domino_engine.dart
├── domain/domino_projection.dart
├── presentation/providers/domino_multiplayer_provider.dart
├── presentation/widgets/domino_tile.dart
├── presentation/widgets/domino_chain.dart
├── presentation/widgets/domino_hand.dart
├── presentation/widgets/domino_seat_card.dart
└── infrastructure/railway/railway_domino_service.dart
~~~

The Dart engine may preview legal moves for responsive highlighting, but the server snapshot wins after every action. The provider owns HTTP/WebSocket lifecycle, private/public snapshot state, action sequence, idempotency, pending actions, reconciliation, server-derived timers, reconnect, result navigation, and practice isolation.

### 9.1 Game menu and launch

Add a Domino Duel card and mode dialog consistent with existing SMARTS designs. Include Casual, Ranked, Practice, and a highlighted all-time Leaderboard button. Show the ranked feature flag state and exact entry policy before ranked confirmation.

### 9.2 Match screen

Use the supplied concept as direction while matching current SMARTS UI:

- purple/navy background with a subtle green or indigo table surface;
- four compact seat cards around the table;
- current player highlighted with animated accent border;
- avatar/name, score, hand count, connection, and BOT badge;
- central horizontal chain with visible left/right placement targets;
- doubles rendered perpendicular;
- bottom hand tray with large readable pip tiles;
- legal tiles glow, illegal tiles dim;
- selected tile lifts with scale/shadow;
- Draw and Pass controls with server-driven enabled state;
- boneyard card with count and draw animation;
- turn timer and final-warning state;
- responsive chain pan/zoom or compact layout for long chains;
- no outer page scrolling or drag interference while playing.

Support both tap-to-select then tap-side and drag-to-side. Drag location is not trusted; only tileKey, side, sequence, and action ID are submitted.

### 9.3 Feedback

Use existing sound/haptic/reduced-motion services for legal play, rejection, draw, pass, double, bot fill, round win, match win/draw/loss, and final countdown. Practice must display PRACTICE and no-reward messaging.

## 10. Results, ranking, settlement, and notifications

### 10.1 Results

Results must show four placements, not a two-player opponent layout:

~~~
1  You       108 points   Winner
2  Sara       86 points
3  Omar       71 points
4  BOT         42 points
~~~

Include round scores, tiles played/drawn/passed, blocked-round details, bot badges, ELO/GLD/XP changes when applicable, practice isolation notice, rematch/back actions, share-card support, and win/draw/loss sound.

### 10.2 Settlement

Use the generic settlement pipeline:

1. lock match and verify all four participant states;
2. finalize pending bot turns;
3. resolve the last round and result once;
4. create one idempotent settlement;
5. update casual/ranked statistics;
6. apply real-player ELO and wallet policy only for eligible ranked matches;
7. apply XP, missions, achievements, and streaks only when eligible;
8. write analytics/replay retention metadata;
9. notify players with player-facing text;
10. publish the final projection and support safe retries.

No client callback can award GLD, ELO, progression, or rewards.

Use notifications such as Your turn in Domino Duel, Round won, You finished 1st in Domino Duel, Your Domino match was a draw, and Your Domino match is complete. Do not put hidden hands or boneyard identities in push notifications.

## 11. System Admin and operations

### 11.1 Policy editor

Add Domino to the existing versioned policy editor with:

- enabled/disabled;
- casual/ranked/practice flags;
- seat count locked to four in V1;
- hand size, boneyard, target score, round limit, and timers;
- bot fill, fallback delay, difficulty, and ranked bot policy;
- draw/pass and blocked-round rules;
- scoring and ranking versions;
- GLD entry/settlement policy;
- progression multipliers;
- action rate and replay retention bounds;
- kill switch and mandatory change reason.

Provide draft, validation, diff, publish, rollback, actor/timestamp/reason audit, and new-matches-only behavior. Never mutate active-match policy.

### 11.2 Operations and analytics

Provide active-match views for seat composition, human/bot counts, turn, timer, chain length, boneyard count, scores, last event, connection state, settlement state, replay access, and safe retry/finalize actions. Admin repairs must be elevated, audited, and represented by an explicit event.

Record server-owned events:

~~~
domino_queue_entered
domino_match_created
domino_bot_filled
domino_round_started
domino_tile_played
domino_tile_drawn
domino_passed
domino_round_completed
domino_match_completed
domino_forfeited
domino_reconnected
domino_action_rejected
domino_settlement_retried
~~~

Measure queue wait, real-seat count, bot-fill rate, bot win rate, match/round duration, draw/pass rate, rejection rate, blocked-round rate, placement distribution, ELO movement, settlement latency, chain mismatches, and reconnect recovery. Do not put hidden hands or unnecessary personal data in ordinary analytics.

## 12. Security and abuse prevention

Implement authenticated ownership checks, server-owned seats/hands, row locks, sequence/idempotency, deadline enforcement, action-rate limits, deterministic replay, chain-hash reconciliation, hidden-hand filtering, bot disclosure, ranked bot guard, duplicate settlement protection, disconnect/forfeit policy, suspicious-action telemetry, and audited policy/admin changes.

Suggested initial limits:

~~~
maxActionsPerSecond: 8
maxDrawActionsPerTurn: 8
maxChainTiles: 28
maxRounds: 20
maxMatchDurationSeconds: 1800
maxReplayEvents: 2000
~~~

Invalid input must be rejected while preserving the previous valid state. Never repair a client by accepting an impossible tile movement.

## 13. Shared fixtures and tests

Create fixtures usable by TypeScript and Dart for:

- canonical 28-tile deck;
- deterministic shuffle and four-seat deal;
- opening double, no-double opening, and tie-break;
- left/right placement, rotation, doubles, and illegal sides;
- wrong turn, stale sequence, duplicate action;
- draw playable tile, draw until empty, pass, and invalid pass;
- empty-hand win, blocked-round win, blocked tie, target-score completion, timeout;
- one, two, and three bot fills;
- practice with three bots;
- hidden-hand projections for all recipients;
- reconnect and snapshot recovery;
- chain-hash reproduction;
- settlement idempotency;
- ranked human-only ELO update;
- practice result with no economy/progression mutation.

Backend tests must cover engine rules, DTOs, authorization, transactions, locks, concurrent actions, bot recovery, realtime projections, matchmaking, settlement, migration, policy validation, rollback, and replay. Flutter tests must cover rendering, orientation, legal highlighting, tap/drag, draw/pass, seat updates, bot labels, reconnect, long-chain layout, reduced motion, and four-player results.

## 14. Implementation phases

### Phase 0 — Product, rules, and content lock

- confirm four-seat free-for-all;
- confirm five-tile/eight-boneyard defaults;
- finalize target score, round limit, timers, and blocked scoring;
- confirm ranked feature-flag behavior;
- finalize bot disclosure, difficulty, tile artwork, table theme, sounds, and haptics;
- finalize domino.v1 and domino-score.v1 identifiers;
- define all policy bounds, fixtures, result limits, and retention rules.

### Phase 1 — Backend foundation and pure engine

- register Domino game definition/config;
- add Prisma state, tile ownership, replay metadata, and migration;
- implement canonical deck and deterministic shuffle;
- implement opening selection, chain placement, orientation, doubles, draw, pass, blocked detection, scoring, and chain hash;
- add DTO validation and module registration;
- seed casual/practice config;
- add pure-engine tests from shared fixtures.

### Phase 2 — Authoritative HTTP gameplay

- implement four-seat initialization and snapshot;
- implement recipient-specific public/private projections;
- implement start, snapshot, play, draw, pass, heartbeat, reconcile, forfeit, and results endpoints;
- add row locking, sequence, and idempotency;
- persist hand, boneyard, chain, score, event, and result atomically;
- implement round/match finalization and generic settlement/progression/notifications;
- isolate practice and add integration/concurrency tests.

### Phase 3 — Matchmaking, bots, and realtime

- register Domino in matchmaking;
- implement four-seat assembly and one-to-three bot fallback;
- add bot identities, strategy profiles, worker recovery, and action pacing;
- add WebSocket subscription/actions/snapshots;
- add hidden-hand recipient filtering;
- implement reconnect, heartbeat, timeout, and stale-match recovery;
- add bot/fraud analytics and realtime tests.

### Phase 4 — Flutter mobile gameplay

- add Railway HTTP/WebSocket transport;
- add provider, domain projections, action IDs, recovery, and reconciliation;
- add main-menu card, mode selector, and leaderboard entry;
- build four seats, table, chain, boneyard, hand tray, timer, draw/pass, and legal target UI;
- add tap and drag interactions without outer page scrolling;
- add animations, haptics, sound, reduced motion, practice labels, and bot badges;
- extend four-player results, rematch, and share-card flows;
- test small/large screens, reconnect, long chains, and hidden information.

### Phase 5 — System Admin and operations

- add Domino policy endpoints and audit records;
- add editor, validation, diff, publish, rollback, and kill switch;
- add active match, seat, chain, bot, replay, and settlement views;
- add safe settlement retry/finalize operations;
- add queue, bot, action, completion, mismatch, and settlement analytics;
- add retention/storage metrics, permissions, and incident runbook.

### Phase 6 — Economy, ranking, and rollout

- launch practice and casual first;
- validate bot difficulty, queue behavior, scoring, replay, and settlement;
- enable ranked only after ELO/GLD simulation and policy approval;
- test small ranked limits with real four-player matches;
- monitor bot fill, action rejection, chain mismatch, timeout, reconnect, and settlement metrics;
- gradually expand the audience;
- retain a kill switch that blocks new Domino matches without breaking active settlement.

## 15. Acceptance criteria

Domino is production-ready only when:

- every active match has exactly four server-owned seats;
- missing seats are disclosed bots according to mode policy;
- no player can see another player’s hand before reveal;
- no client can submit score, winner, tile ownership, open ends, or boneyard identity;
- every accepted action is deterministic, sequenced, idempotent, and replayable;
- draw/pass, doubles, blocked rounds, timeouts, and forfeits resolve correctly;
- concurrent/stale actions cannot corrupt the chain;
- reconnect returns an authoritative recipient-specific snapshot;
- bots use the same action engine and do not affect human economy incorrectly;
- practice cannot affect progression, ELO, rewards, missions, or leaderboards;
- casual and ranked settlement are idempotent;
- four-player results show placements and scores correctly;
- mobile gameplay does not scroll or lose tile drags;
- System Admin can configure, disable, roll back, inspect, and safely operate Domino;
- backend, mobile, realtime, bot, settlement, and admin tests pass;
- runbooks exist for stale matches, bot-worker failure, settlement retry, policy rollback, and emergency disablement.

## 16. Implementation status

Phases 0–5 are implemented across the NestJS backend, Railway realtime transport, Flutter client, and System Admin console. The production rollout remains intentionally operational: apply the Prisma migration, seed/verify the `domino` game definition and active config, verify the admin permission, then enable ranked play only after the casual/practice acceptance checks and economy simulation have passed.
