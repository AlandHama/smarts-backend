# Tile Rush — Implementation Plan

## Status

Planning only. This document defines the implementation of Tile Rush. No backend, mobile, database, realtime, or system-admin code should be changed until implementation is explicitly requested.

## 1. Game identity

### Name

**Tile Rush**

The name fits SMARTS’ short, energetic game names and clearly separates the game from Gem Blitz:

- **Gem Blitz:** swap adjacent gems to create matches.
- **Tile Rush:** hold and drag through a connected path of identical tiles.

### Backend identity

- Game key: `tile_rush`
- Admin/game-definition key: `tile_rush`
- Player-facing name: `Tile Rush`
- Rules version: `tile-rush.v1`
- Initial modes: `CASUAL`, `RANKED`
- Initial players: two

Tile Rush must use SMARTS’ existing `GameDefinition`, `GameConfig`, `Match`, `MatchParticipant`, `MatchEvent`, `MatchSettlement`, matchmaking, realtime, bot, progression, analytics, rematch, share-card, and system-admin infrastructure wherever possible.

## 2. Launch scope

### Tile Rush Rush mode

- Two-player head-to-head match.
- 60-second default duration.
- Shared deterministic 7 × 7 starting board.
- Five tile types by default.
- Player holds a tile and drags through orthogonally adjacent tiles of the same type.
- Minimum valid path: three tiles.
- Diagonal movement is never valid in V1.
- Players’ boards diverge after their first different action.
- Highest verified score wins.
- Casual mode may use a human-like bot fallback.
- Ranked mode must not use paid gameplay boosters and should prefer real players.

### Deliberately excluded from V1

- Diagonal paths.
- Client-submitted score or board state.
- Paid gameplay advantages in ranked matches.
- Direct attacks or garbage tiles sent to the opponent.
- Persistent Candy Crush-style level maps.
- Unlimited board sizes or arbitrary tile rules from the client.
- A separate settlement, matchmaking, or reward system duplicated from SMARTS.

## 3. Core rules

### Board

The server creates and owns the match board configuration:

```text
boardSize       7
tileTypes       5
durationSeconds 60
minimumChain    3
connection      ORTHOGONAL
seed            server-generated
rulesVersion    tile-rush.v1
```

The starting board must:

- be generated from a persisted match seed;
- contain no invalid or unknown tile values;
- be identical for both players at match start;
- contain at least one valid path of three or more tiles;
- be deterministically regenerated if the board has no valid path after refill;
- be captured by the active game policy so later admin changes cannot alter an active match.

### Valid path

A client action is valid only when:

1. the match is active and the player belongs to it;
2. the action sequence is the next expected sequence for that participant;
3. the path contains at least `minimumChain` coordinates;
4. every coordinate is inside the board;
5. every coordinate contains the same tile type at the time of the action;
6. every consecutive coordinate is horizontally or vertically adjacent;
7. no tile is repeated, except the final coordinate may close a configured loop;
8. the path is compatible with the participant’s authoritative board state;
9. the release and server receive times are inside the match window;
10. the action has not already been accepted through another idempotency key.

The client sends an action intent, never a score, board, refill, combo, or winner.

```text
matchId
sequence
path: [[row, column], ...]
clientStartedAt
clientReleasedAt
clientActionId
boardHashBefore
```

### Backtracking

Backtracking is part of the core control scheme:

- dragging back onto the immediately previous tile removes the last tile from the path;
- dragging onto any earlier tile is rejected or treated as a configured loop only when it closes a valid loop;
- a normal path cannot select the same coordinate twice;
- releasing a path shorter than the minimum length cancels the action without scoring;
- cancelling a path must not mutate the authoritative board or score.

## 4. Path resolution and board refill

When a valid path is released, the authoritative engine:

1. validates the path against the current participant board;
2. calculates chain length and score;
3. resolves a loop or long-chain special effect;
4. removes the selected tiles and any effect tiles;
5. applies gravity column by column;
6. fills empty cells from the participant’s deterministic refill RNG;
7. checks whether the refill creates an automatic cascade according to policy;
8. resolves cascades deterministically;
9. calculates the final score delta and combo state;
10. stores the resulting board, sequence, hash, and replay event;
11. returns the authoritative animation instructions to the client.

Refill must be fast enough to preserve the game’s scanning rhythm. The target presentation timings are:

- path release/explosion: approximately 120–180 ms;
- gravity: approximately 150–220 ms;
- new tile spawn: approximately 100–150 ms;
- automatic cascades: chained without a long blocking pause.

The animation duration is a mobile presentation concern. The server remains the source of truth and never waits for animation completion.

## 5. Scoring

### Starting score curve

The initial policy should use a long-chain-friendly curve:

| Chain length | Base score |
| ---: | ---: |
| 3 | 100 |
| 4 | 160 |
| 5 | 240 |
| 6 | 340 |
| 7 | 470 |
| 8 | 630 |
| 9 | 820 |
| 10 | 1,050 |
| 11+ | Formula-based continuation |

The implementation should use a configured score formula or a versioned score table, not hardcoded client scoring. Two short chains must be worth materially less than one difficult long chain.

Recommended calculation order:

```text
validated path
  → chain base score
  → long-chain/special bonus
  → speed-combo multiplier
  → configured final-rush modifier
  → score cap
  → authoritative score event
```

### Speed combo

If a player starts another successful chain within the configured combo window, their combo increases:

```text
x1       normal
x2       +5%
x3       +10%
x4       +15%
x5+      +20% maximum bonus
```

The default combo window is 2,000 ms. If the player exceeds the window, the combo resets and the client receives a `COMBO_LOST` event. Combo state belongs independently to each participant.

### Long-chain effects

Long paths earn skill-based effects:

| Chain | Effect |
| ---: | --- |
| 3–4 | Normal clear |
| 5–6 | Blast: clears configured nearby cells |
| 7–9 | Lightning: clears a deterministic row or column |
| 10+ | Prism: clears all tiles of the selected color |

These effects are earned from play and are never purchasable in ranked mode.

### Loop / Color Crush

If loops are enabled and a valid path returns to its starting coordinate, the action creates **Color Crush**:

- the loop must contain the minimum configured number of unique cells;
- the loop must be orthogonally connected at every step;
- the closing edge must be valid according to the server rules;
- every tile in the loop must have the same type;
- all tiles of that type on the participant’s current board are cleared;
- the event includes `COLOR_CRUSH`, cleared count, score delta, and resulting board hash.

Loop handling must be fully deterministic and covered by shared test vectors. A loop must not allow the same tile to be scored repeatedly through malformed paths.

## 6. Match phases and timing

The 60-second match has configurable presentation phases:

1. **Build — 60–30 seconds:** normal visuals, sound, and board speed.
2. **Speed Up — 30–10 seconds:** stronger visual intensity and shorter presentation animations.
3. **Final Rush — final 10 seconds:** countdown, stronger feedback, and an optional equal modifier applied to both players.
4. **Resolve — after the clock:** no new release is accepted after the authoritative deadline, but a path that began before expiry may be accepted only under the configured server rule.
5. **Settlement:** finish the match, calculate the winner, write the standard settlement, then return the result projection.

The server clock is authoritative. The mobile clock is only a display estimate and must reconcile to `serverNow`, `startedAt`, and `endsAt` from the snapshot.

## 7. Multiplayer presentation

### Persistent match HUD

Use the existing SMARTS competitive game visual language and Gem Blitz player projection patterns:

- both player names and profile pictures;
- both live verified scores;
- each player’s current combo;
- circular or bar timer;
- current lead indicator;
- the player’s own 7 × 7 board;
- opponent score and event feed, but not the opponent’s full board;
- responsive board sizing for narrow phones;
- clear `YOU TOOK THE LEAD` and `<player> TOOK THE LEAD` events;
- short chain feedback beside the active pointer;
- haptics, escalating tile tones, explosion sound, and rush audio using existing SMARTS sound settings.

### Event feed

Realtime events should include compact competitive moments:

```text
Sara — 8 Chain!
Sara — COLOR CRUSH!
Aland — Combo ×7
Sara lost her combo
Aland took the lead!
```

Events should be throttled and deduplicated so a fast match never becomes a noisy scrolling log.

## 8. Server authority and optimistic mobile feel

Tile Rush is a fast touch game, so waiting for a network response before every animation would feel poor on high-latency connections. Use the same trust boundary as Gem Blitz:

```text
finger release
  ├─ client predicts only a valid-looking local animation
  └─ server validates and resolves the action
        ├─ ACK: keep the animation and reconcile
        └─ REJECT/hash mismatch: restore the authoritative snapshot
```

The client may optimistically animate:

- the selected path;
- the line between selected cells;
- tile glow and growth;
- the predicted clear;
- gravity and refill;
- score preview.

The client must replace the preview with the server result after acknowledgement. It must never award local score, GLD, XP, ELO, combo state, or match result.

### Reconciliation

Every accepted action response should contain:

```text
accepted
sequence
scoreDelta
totalScore
chainLength
combo
special
clearedCells
refillCells
boardState or compact board delta
boardHash
serverNow
endsAt
event list
```

The server should provide a complete participant snapshot through HTTP after reconnect or hash mismatch. Duplicate actions return the previous authoritative result when the `clientActionId` or sequence is known.

## 9. Backend implementation structure

Create a focused module following the existing Gem Blitz module shape, without duplicating shared match infrastructure:

```text
src/modules/tile-rush/
  tile-rush.module.ts
  tile-rush.controller.ts
  tile-rush.service.ts
  tile-rush.gateway.ts
  tile-rush-admin.controller.ts
  dtos/
    tile-rush-action.dto.ts
    tile-rush-policy.dto.ts
  engine/
    tile-rush-engine.ts
    board-generator.ts
    seeded-random.ts
    board-state.ts
    path-validator.ts
    chain-scorer.ts
    special-resolver.ts
    refill-engine.ts
    board-hash.ts
  transactions/
    start-tile-rush.ts
    record-tile-rush-action.ts
    reconcile-tile-rush-state.ts
    settle-tile-rush.ts
  bots/
    tile-rush-bot.ts
  anti-cheat/
    tile-rush-signals.ts
```

### HTTP endpoints

Use the project’s authenticated API conventions. The final route names may follow the existing Gem Blitz service exactly, but the planned capabilities are:

```text
GET  /tile-rush/matches/:matchId
POST /tile-rush/matches/:matchId/start
POST /tile-rush/matches/:matchId/actions
POST /tile-rush/matches/:matchId/reconcile
POST /tile-rush/matches/:matchId/forfeit
GET  /tile-rush/matches/:matchId/settlement
```

HTTP is the recovery and history path. Normal live actions and opponent events should use the existing authenticated realtime transport.

### Realtime events

Reuse the SMARTS realtime authentication, subscriptions, reconnect, and error handling patterns:

```text
tileRush.subscribe(matchId)
tileRush.snapshot
tileRush.action.accepted
tileRush.action.rejected
tileRush.opponent.event
tileRush.score.updated
tileRush.lead.changed
tileRush.match.finished
tileRush.reconcile.required
tileRush.error
```

Socket actions must remain idempotent and have the same server validation as HTTP actions. The system must not have a weaker validation path through the socket.

## 10. Persistence and settlement

### Reuse existing persistence

The first implementation should store Tile Rush in the existing match models:

- `GameDefinition` for the `tile_rush` game identity;
- `GameConfig` for versioned progression, scoring, ranking, reward, and policy settings;
- `Match` for lifecycle, mode, seed metadata, and active policy snapshot;
- `MatchParticipant` for player/bot identity, result, and final score;
- `MatchEvent` for accepted/rejected actions and replay events;
- `MatchSettlement` for the final standard settlement projection;
- `AnalyticsEvent` for gameplay and funnel telemetry.

Use `Match.metadata` for the compact authoritative Tile Rush state initially, following Gem Blitz. Do not add Tile Rush-specific tables unless measured replay volume, query needs, or retention requirements justify them.

### State that must be persisted

```text
rulesVersion
policyVersion
matchSeed
boardSize
tileTypes
durationSeconds
startedAt
endsAt
participant board state
participant refill RNG state
participant action sequence
participant score
participant combo state
participant best chain
participant longest combo
participant tiles cleared
participant color crush count
last board hash
replay reference or bounded replay events
```

### Settlement

When the timer expires, a player forfeits, or a recovery worker finalizes the match:

1. lock the match transactionally;
2. resolve any eligible final action according to the server deadline rule;
3. stop bot actions;
4. compute each participant’s final verified score and statistics;
5. determine win, loss, or draw;
6. call the shared match settlement transaction;
7. update ELO for ranked matches through the existing ranking flow;
8. award configured XP, GLD, win streak, and progression rewards;
9. emit analytics and audit events;
10. mark the match settled idempotently;
11. publish the final realtime result and expose the same result through HTTP.

The worker must retry finished-but-unsettled Tile Rush matches and must not leave them permanently in `STARTED`, `FINISHED`, or `REVIEW` because a client disconnected.

## 11. Bots

Tile Rush bots must choose and resolve actual paths rather than receive fabricated scores.

The bot engine should scan available paths and rank them by approximate quality:

- chain length;
- loop opportunity;
- special threshold reached;
- combo preservation;
- safe reaction timing;
- board position and future opportunities.

Skill profiles:

| Skill | Reaction | Typical behavior |
| --- | --- | --- |
| Beginner | 1.5–2.5 seconds | Mostly 3–4 tile paths, misses loops, pauses, occasional mistakes |
| Medium | 0.8–1.5 seconds | Usually 4–7 tiles, occasional specials, imperfect combo maintenance |
| Hard | 0.4–1.0 seconds | Strong paths, some loops, better combo maintenance, still imperfect |

All bot timings require jitter and human-like variation. Bots must obey the same action engine, timer, score caps, and settlement rules as players. Ranked bot fallback should remain disabled unless explicitly enabled by the system-admin policy.

## 12. Anti-cheat and fraud signals

Record signals without automatically banning on one signal:

- invalid path frequency;
- repeated stale sequence submissions;
- impossible path speed;
- impossible action frequency;
- repeated perfect long chains;
- impossible score velocity;
- repeated board-hash mismatches;
- modified client timestamps;
- abnormal reconnect and duplicate-action patterns;
- bot-like or automation-like timing regularity.

Signals should flow into the existing fraud/risk and player audit systems. Ranked matches with suspicious results may be marked `REVIEW` using the existing settlement review pattern.

## 13. Mobile implementation

Create a Tile Rush feature that follows existing Gem Blitz and Flame conventions:

```text
lib/features/tile_rush/
  domain/
    tile_rush_tile.dart
    tile_rush_board.dart
    tile_rush_path.dart
    tile_rush_snapshot.dart
    tile_rush_event.dart
  presentation/
    providers/
      tile_rush_provider.dart
    flame/
      tile_rush_flame_game.dart
    widgets/
      tile_rush_board.dart
      tile_rush_tile.dart
      tile_path_painter.dart
      tile_explosion.dart
      combo_overlay.dart
      opponent_score.dart
      tile_rush_event_feed.dart
  data/
    railway_tile_rush_service.dart

lib/presentation/screens/game/
  tile_rush_multiplayer_screen.dart
```

### Rendering and touch interaction

Use Flame for the board’s high-frequency rendering and animation, while Flutter remains responsible for navigation, HUD, dialogs, accessibility, and results:

- one stable tile component per board cell;
- pointer-down starts a path only on a valid tile;
- pointer move selects only the tile under the pointer;
- hit testing accounts for gaps and device scale;
- path segments animate as lines between tile centers;
- selected tiles grow and glow without rebuilding the entire board;
- immediate backtracking removes only the last selected tile;
- pointer-up submits the path once;
- invalid or cancelled paths animate back cleanly;
- optimistic board changes reconcile against the authoritative response;
- animation work is bounded so a fast player cannot queue unbounded effects.

The board must remain responsive on narrow phones, tablets, and accessibility text scales. The player’s board should be visually dominant; the opponent is represented by the persistent score HUD and event feed.

### Audio and haptics

Reuse SMARTS’ sound and settings infrastructure:

- light haptic on each newly selected tile;
- increasing pitch for path length;
- distinct release and clear sounds;
- special sounds for Blast, Lightning, Prism, and Color Crush;
- speed-up and final-rush music transitions;
- respect global sound, music, haptic, and mute settings;
- never play a loop or effect after the match has already settled.

## 14. Results screen

Reuse the shared `GameResultsScreen` and existing result-card/share/rematch patterns, adding a Tile Rush-specific statistics section:

```text
VICTORY

You          Opponent
18,420       17,830

Best chain       12       9
Longest combo    14      11
Tiles cleared   148     139
Color Crushes     2       1
Average chain   5.8     5.2

TOP 7% TODAY
You beat 93% of Tile Rush players

[REMATCH] [SHARE] [BACK TO MENU]
```

The result screen must support:

- server-verified scores and statistics;
- win/loss/draw state;
- ELO, XP, GLD, and streak changes;
- “streak ended by you” when applicable;
- percentile insight;
- gift flow where already supported;
- shared SMARTS share cards and referral/deep links;
- rematch for eligible casual matches;
- safe back navigation after a disconnected or already-settled match.

## 15. Progression, missions, achievements, and retention

Reuse the existing systems instead of creating Tile Rush-specific reward plumbing.

### Missions

- Clear 100 tiles in Tile Rush.
- Create three chains of eight or more.
- Trigger one Color Crush.
- Maintain a combo through five chains.
- Win one Tile Rush casual match.
- Win one Tile Rush ranked match.

### Achievements

- **On Fire:** reach Combo ×10.
- **Rainbow Hunter:** trigger 100 Color Crushes.
- **Lightning Hands:** clear 150 tiles in one match.
- **Tile Master:** win 100 Tile Rush matches.
- **Photo Finish:** win by fewer than 100 points.
- **Path Finder:** create a 10+ tile chain.

All mission and achievement completion events must be idempotent and use the existing popup/read-state behavior so old dialogs do not repeatedly appear on app startup.

## 16. System-admin configuration

Add a Tile Rush page following the existing Gem Blitz administration page, with configuration, operations, policy history, rollback, and audit support.

### Policy fields

```text
enabled
visibleName
description
boardSize                 7
tileTypes                 5
durationSeconds           60
minimumChain              3
rulesVersion              tile-rush.v1
connectionMode            ORTHOGONAL

comboWindowMs             2000
maxComboBonus             0.20
finalRushSeconds          10
finalRushMultiplier       1.10

special5Threshold         5
special7Threshold         7
prismThreshold            10
loopsEnabled              true
loopMinimumLength         configurable

casualEnabled             true
rankedEnabled             true
rankedBotFallback         false
scoreCap                  configurable
maxActionsPerSecond       configurable

bot.enabled
bot.reactionDelayMs
bot.jitterMs
bot.skill
bot.maxActions
bot.errorRate

scoring.chainTable or scoring.formula
scoring.specialBonuses
scoring.cascadeMultipliers
scoring.refillCascadeLimit
```

### Policy safety

Admin validation must reject:

- board sizes outside the supported engine range;
- fewer than three tile types;
- minimum chains below three;
- negative or unsafe score multipliers;
- final-rush modifiers that differ by player;
- unlimited score caps or bot action rates;
- ranked settings that enable paid gameplay advantages;
- loop settings that can score the same tile repeatedly.

Every save creates an immutable version, deactivates the previous active version, records the actor and reason, and keeps rollback available. Active matches continue using their captured policy version.

### Operations dashboard

Show:

- active, searching, finished, review, cancelled, and settled matches;
- current bot participants and bot skill distribution;
- accepted and rejected path actions;
- action rejection reasons;
- average chain length and best-chain distribution;
- Color Crush and special-effect counts;
- board-hash mismatch count;
- unfinished or unsettled matches;
- settlement retry failures;
- recent matches with mode, policy version, scores, winner, and settlement status;
- links to the match event/replay audit view.

Admin actions:

- retry settlement;
- flag a match for review;
- inspect replay/state hashes;
- view the captured policy;
- rollback to a previous policy version;
- disable a mode safely for new matches without affecting active matches.

## 17. Analytics and reporting

Emit server-owned analytics events compatible with the existing analytics/reporting page:

```text
TILE_RUSH_MENU_VIEWED
TILE_RUSH_QUEUE_JOINED
TILE_RUSH_MATCH_FOUND
TILE_RUSH_MATCH_STARTED
TILE_RUSH_PATH_ACCEPTED
TILE_RUSH_PATH_REJECTED
TILE_RUSH_SPECIAL_CREATED
TILE_RUSH_COLOR_CRUSH
TILE_RUSH_COMBO_REACHED
TILE_RUSH_LEAD_CHANGED
TILE_RUSH_MATCH_FINISHED
TILE_RUSH_MATCH_SETTLED
TILE_RUSH_REMATCH_REQUESTED
TILE_RUSH_REMATCH_ACCEPTED
```

Useful report dimensions:

- casual/ranked;
- policy version;
- board size and tile count;
- human/bot opponent;
- chain-length buckets;
- combo buckets;
- average action latency;
- average score and score difference;
- win rate by skill/ELO range;
- Color Crush frequency;
- abandoned and unsettled match rate;
- client/server reconciliation rate;
- median and p95 action processing time;
- retention and rematch conversion.

## 18. Testing strategy

### Engine tests

- same seed produces the same starting board;
- no diagonal path is accepted;
- minimum chain validation;
- invalid coordinates are rejected;
- repeated tiles are rejected except valid loop closure;
- backtracking removes only the previous tile;
- long-chain score curve;
- combo window and cap;
- Blast, Lightning, Prism, and Color Crush behavior;
- deterministic gravity and refill;
- no-move recovery;
- final-action deadline behavior;
- score and board hash replay from seed plus actions.

### Backend tests

- authenticated participant authorization;
- sequence and idempotency behavior;
- HTTP/socket parity;
- concurrent action locking;
- reconnect snapshot recovery;
- bot actions use the same engine;
- timer expiration and worker finalization;
- settlement retry and review behavior;
- ranked entry fee, rewards, ELO, and refunds through shared transactions;
- policy capture, validation, audit, and rollback.

### Flutter tests

- path hit testing on multiple device sizes;
- pointer-down, drag, backtrack, and release behavior;
- no duplicate action submission;
- optimistic animation reconciliation;
- board reset after a rejected action;
- timer and final-rush presentation;
- reconnect and stale snapshot handling;
- result navigation after timeout;
- sound, haptic, mute, and accessibility settings;
- bot and human scoreboard rendering;
- rematch and share actions.

### Device acceptance

- low-end Android device;
- narrow phone layout;
- high refresh-rate device;
- intermittent network;
- high latency;
- app background/resume during a match;
- process death and match recovery;
- ranked match with no paid gameplay advantage;
- match ending while a finger is still down.

## 19. Phased implementation

### Phase 1 — Offline engine and mobile feel

- Define Tile Rush domain models and shared test vectors.
- Implement deterministic 7 × 7 board generation, path validation, backtracking, scoring, combo state, special effects, loops, gravity, and refill.
- Build the Flame/Flutter board with stable tile components, path painter, glow, haptics, audio, explosions, and fast transitions.
- Add a local preview/debug screen without claiming server results.
- Add unit tests for the complete engine.

### Phase 2 — Authoritative backend and multiplayer

- Register the `tile_rush` game definition and initial versioned configuration.
- Implement HTTP snapshot/start/action/reconcile/forfeit endpoints.
- Implement authenticated realtime subscription and action acknowledgements.
- Persist match state, event sequences, hashes, and bounded replay data using existing match models.
- Add timer finalization, reconnect recovery, idempotency, and shared settlement.
- Add human-like bot path selection for casual fallback.

### Phase 3 — Mobile multiplayer, progression, and results

- Connect the mobile provider to matchmaking, HTTP recovery, and realtime actions.
- Add optimistic action prediction and authoritative reconciliation.
- Add opponent score, combo, lead events, final-rush state, and reconnect UI.
- Reuse the shared game results, percentile, ELO, XP, GLD, win streak, rematch, and share-card flows.
- Add Tile Rush missions, achievements, and analytics events.
- Validate result navigation on normal finish, timeout, forfeit, disconnect, and worker recovery.

### Phase 4 — System admin, balancing, and production hardening

- Add the Tile Rush policy/admin page with validation, version history, rollback, audit, operations, and settlement recovery.
- Add analytics/reporting cards, charts, date filters, and Tile Rush dimensions.
- Add fraud signal review and replay/hash inspection.
- Balance bot skill, scoring, loops, specials, duration, and combo bonuses using production data.
- Load-test concurrent actions, socket reconnects, match expiry, and settlement retries.
- Run device acceptance testing and release readiness review.

## 20. Definition of done

Tile Rush is ready for release when:

- two players receive the same deterministic starting board;
- dragging only selects valid orthogonal same-type paths;
- backtracking feels immediate and correct;
- long chains, combos, specials, and loops are fun but server-authoritative;
- mobile animation remains responsive without waiting for network round trips;
- the opponent’s score and competitive events update live;
- bots choose real paths and behave imperfectly;
- timeout always finalizes and settles the match;
- casual and ranked modes use existing SMARTS policies and rewards;
- results include Tile Rush-specific statistics, percentile, rematch, and sharing;
- missions, achievements, streaks, progression, and analytics are integrated;
- system admins can configure, audit, inspect, rollback, and reconcile Tile Rush;
- no new duplicate matchmaking, wallet, ranking, reward, or analytics infrastructure exists;
- all engine, API, realtime, settlement, device, and recovery tests pass.
