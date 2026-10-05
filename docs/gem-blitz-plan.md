# Gem Blitz — Match-3 Game Implementation Plan

## Status

Planning only. This document defines the implementation for a new SMARTS game type. No backend, mobile, database, or system-admin files should be changed until implementation is explicitly requested.

## 1. Game identity

### Working name

**Gem Blitz**

The name communicates a quick, competitive match-3 experience while fitting SMARTS’ existing game naming style. The backend game key should be `GEM_BLITZ`; the player-facing display name is `Gem Blitz`.

### Positioning

Gem Blitz uses the instantly understandable interaction of a match-3 game, but turns it into a fast SMARTS skill challenge based on pattern recognition, reaction speed, planning, and decision-making.

It should feel inspired by the genre, not like a mechanical Candy Crush clone:

- short competitive matches instead of long level progression;
- the same deterministic starting opportunity for both players;
- server-authoritative moves, cascades, scores, and settlement;
- rapid input and short animations;
- SMARTS progression, streaks, rankings, missions, achievements, and share cards;
- no paid gameplay advantage in ranked matches.

## 2. Launch scope

### V1 mode

**Gem Blitz Rush**

- two-player head-to-head match;
- 75-second match duration, configurable by system admin;
- both players receive the same initial 7 × 7 board seed;
- players swap adjacent gems to make matches of three or more;
- each player’s board evolves independently after their moves;
- highest verified score wins;
- all remaining cascades resolve before settlement;
- casual matches may use a bot when the queue policy allows it;
- ranked matches should prioritize real players and use the existing SMARTS ranked flow.

### Deliberately excluded from initial launch

- opponent garbage blocks or direct attacks;
- paid boosters that change ranked gameplay;
- a large collection of consumable power-ups;
- persistent Candy Crush-style level maps;
- client-submitted scores or client-authoritative board state.

These can be evaluated after the core game is stable and balanced.

## 3. Core gameplay rules

### Board

- Default board: 7 × 7.
- Default gem colors/types: six visually distinct gem types.
- Board dimensions, gem count, and rules version are admin-configurable but locked for an active match.
- The initial board must not contain an already completed match.
- The initial board must contain at least one legal move, preferably several.
- If a board has no legal moves, the server performs a deterministic reshuffle and emits a reshuffle event.
- The client renders the board from server-provided match metadata and deterministic rules; it must not invent a different board.

### Legal move

A move swaps two orthogonally adjacent cells. The swap is accepted only if it produces at least one match, unless the active rules explicitly allow a configured special-piece interaction.

The client sends a move intent, not a result:

```text
matchId
sequence
fromRow
fromColumn
toRow
toColumn
clientTimestamp
```

The server validates the player, turn window, sequence, adjacency, board state, and legal result before applying the move.

### Matches and cascades

- Three matching gems: clear and score.
- Four matching gems in a row or column: create a Rocket.
- Five matching gems in a straight line: create a Color Bomb.
- T or L shape: create a Bomb.
- Multiple valid special creations must follow a documented deterministic priority rule.
- Cleared gems fall down and new gems are generated from the match’s deterministic RNG stream.
- Newly created matches resolve into cascades.
- Every cascade has a sequence number and contributes to the authoritative score event.
- A move that causes no match is rejected or reverted according to the configured rules.

### Special pieces

V1 has only three special types so players can learn the game quickly:

| Pattern | Special | Effect |
| --- | --- | --- |
| Four in a row/column | Rocket | Clears a complete row or column according to its orientation. |
| Five in a straight line | Color Bomb | When combined with a gem, clears all gems of that color. |
| T or L shape | Bomb | Clears a 3 × 3 area. |

Special combinations should be supported and deterministic:

- Rocket + Rocket: cross-board row and column blast;
- Bomb + Rocket: expanded row/column clear;
- Color Bomb + Rocket: converts matching-color gems into Rockets before resolving;
- Color Bomb + Bomb: converts matching-color gems into Bombs before resolving;
- Color Bomb + Color Bomb: clears the board’s normal gems according to the rules version.

The exact affected cells and scoring order must be defined in shared test vectors so TypeScript and Dart produce the same result.

## 4. Scoring and competitive pacing

### Base scoring

Initial values should be configurable through a versioned Gem Blitz policy:

| Event | Starting value |
| --- | ---: |
| Match of 3 | 100 |
| Match of 4 | 180 |
| Match of 5 | 300 |
| Rocket activation | Configured bonus |
| Bomb activation | Configured bonus |
| Color Bomb activation | Configured bonus |

The server calculates the final score from verified events. The mobile client may show an optimistic animation, but settlement uses server values only.

### Multipliers

- Cascade 1: 1.0×
- Cascade 2: 1.2×
- Cascade 3: 1.5×
- Cascade 4: 2.0×
- Higher cascades: configurable cap and multiplier curve.
- A successful move made within a configurable fast-move window, initially 2.5 seconds, contributes to the speed-combo meter.
- Speed combo labels should progress through `FAST`, `FAST x2`, `FAST x3`, and `RUSH`.
- A configured combo threshold activates **FEVER**.
- FEVER may increase score and animation intensity, but must have a visible configured cap and be identical for both players.

Recommended calculation order:

```text
verified match events
  → base piece/match points
  → special-piece bonuses
  → cascade multiplier
  → speed-combo multiplier
  → FEVER modifier
  → per-move and match score caps
  → authoritative score event
```

The policy must reject negative values, impossible multiplier combinations, and unsafe caps. Policy changes apply to new matches only.

### Match phases

The 75-second default match should have a clear climax:

1. **Build — 0 to 15 seconds:** normal speed, create specials and combos.
2. **Competition — 15 to 50 seconds:** show live score pressure and opponent events.
3. **Rush — final 25 seconds:** stronger presentation and an optional configured score modifier.
4. **Final Rush — final 10 seconds:** clear countdown, stronger haptics/audio, no new moves after time expires.
5. **Resolve:** finish accepted cascades, settle the verified result, and show the results screen.

## 5. Deterministic and server-authoritative engine

### Match creation

The backend creates and persists:

```text
matchId
gameMode = GEM_BLITZ
seed
durationSeconds
rulesVersion
boardSize
startedAt
endsAt
player identities
matchmaking mode
```

Both players receive the same initial seed and rules version. Their subsequent board states diverge naturally because their move sequences differ.

### Deterministic random generation

The random stream for initial generation and falling gems must be reproducible from the persisted match seed and player board context. The engine must never use an uncontrolled random source during an active match.

Replay input must be sufficient to reproduce:

```text
seed + rulesVersion + accepted move sequence → exact board progression and score
```

This supports anti-cheat investigation, dispute handling, and regression tests.

### Authoritative event flow

```text
Flutter sends MOVE
        ↓
NestJS validates identity, sequence, timing, and adjacency
        ↓
Gem Blitz engine resolves match, specials, cascades, and RNG
        ↓
Server stores compact authoritative event/state hash
        ↓
WebSocket sends accepted move result to the player
        ↓
Client animates the server result
        ↓
Periodic reconciliation verifies board hash and score
        ↓
Server settles match and updates SMARTS systems
```

The client must never send `score`, `board`, `cascadeResult`, `winner`, or `reward` as trusted input.

### Realtime and recovery

- Use the existing SMARTS realtime/match patterns where possible.
- Authenticate the socket connection with the normal access token.
- Support reconnect during an active match.
- On reconnect, return the authoritative board snapshot, score, sequence, remaining time, and rules version.
- Reject duplicate sequences idempotently and return the prior result where safe.
- Reject stale moves after the match deadline.
- Keep a bounded event history or replay reference for support and anti-cheat review.
- Fall back to HTTP snapshot/reconciliation if the socket is temporarily unavailable.
## 6. Backend implementation plan

Create a focused module aligned with the existing SMARTS modules:

```text
src/modules/gem-blitz/
  gem-blitz.module.ts
  gem-blitz.controller.ts
  gem-blitz.service.ts
  gem-blitz.gateway.ts
  dtos/
  engine/
    board.ts
    rng.ts
    board-generator.ts
    move-validator.ts
    match-detector.ts
    cascade-resolver.ts
    special-piece-engine.ts
    scoring-engine.ts
    board-serializer.ts
  transactions/
    create-gem-blitz-match.ts
    record-gem-blitz-move.ts
    reconcile-gem-blitz-state.ts
    settle-gem-blitz-match.ts
  anti-cheat/
    gem-blitz-validator.ts
```

Names may be adapted to existing repository conventions, but the engine should remain isolated from controllers, persistence, and presentation.

### Persistence requirements

Use the existing match/content/config conventions where they fit. Add only the minimum Gem Blitz-specific data needed to support:

- rules/config versioning;
- active match seed and lifecycle;
- accepted move sequence or compact replay reference;
- authoritative score and board hash;
- settlement result;
- disconnect/reconnect state;
- anti-cheat flags and review metadata;
- analytics dimensions.

Do not store unbounded board snapshots or raw events indefinitely. Apply retention and archival rules appropriate for competitive disputes.

### API and socket surface

The final endpoint names should follow the existing match API conventions. The contract must cover:

- list/read enabled Gem Blitz modes and policy;
- create or join casual/ranked matchmaking;
- retrieve active match state;
- submit a move intent;
- receive move resolution, opponent score updates, event announcements, timer state, and reconciliation requests;
- reconnect and recover an active match;
- leave/forfeit with the existing match rules;
- fetch results, ranking impact, rewards, and share-card data.

## 7. Mobile Flutter experience

Add a focused feature area that reuses existing SMARTS game, matchmaking, sound, haptics, result, rematch, and share-card infrastructure:

```text
lib/features/gem_blitz/
  domain/
    gem_blitz_board.dart
    gem_blitz_piece.dart
    gem_blitz_move.dart
    gem_blitz_state.dart
    gem_blitz_result.dart
  data/
    gem_blitz_service.dart
    gem_blitz_realtime_service.dart
  presentation/
    providers/gem_blitz_provider.dart
    screens/gem_blitz_lobby_screen.dart
    screens/gem_blitz_matchmaking_screen.dart
    screens/gem_blitz_game_screen.dart
    screens/gem_blitz_results_screen.dart
    widgets/gem_blitz_board.dart
    widgets/gem_blitz_tile.dart
    widgets/gem_blitz_score_bar.dart
    widgets/gem_blitz_combo_overlay.dart
    widgets/gem_blitz_timer.dart
```

The exact location may follow the current Flutter feature organization rather than creating a new top-level folder.

### Main menu entry

Add Gem Blitz as a game card in the existing game selection area. The card should show:

- Gem Blitz name and icon;
- quick description such as `Match fast. Think faster.`;
- Casual, Ranked, and later Co-op availability;
- current Gem Blitz rating/rank where applicable;
- personal insight such as `You beat 68% of players` when enough verified data exists;
- a clear play action without overcrowding the main menu.

### Lobby and matchmaking

Reuse existing SMARTS matchmaking patterns and present:

- Casual and Ranked choices;
- player avatar, name, level, rank, and current win streak where available;
- a visible searching state with cancellation;
- bot-fill policy only for casual mode;
- same-board confirmation before the match starts;
- a short `3, 2, 1, BLITZ` countdown.

### Game screen layout

The board must dominate the screen and remain usable on small devices:

- compact top bar with both player names and verified scores;
- progress bars that show score pressure without revealing the opponent’s entire board;
- timer centered and always readable;
- 7 × 7 board with large touch targets;
- combo, FEVER, and special-event overlays;
- pause/connection state that does not allow cheating or extend the timer;
- short event feed such as `Sara entered FEVER` or `Aland created a Color Bomb`;
- no input that requires precise tiny taps.

### Motion and feedback

Target fast timings, subject to device performance:

- swap: 100–150 ms;
- match pop: 100–150 ms;
- fall: 150–200 ms;
- cascades: begin immediately after the previous resolution;
- allow a small queued input window for skilled players;
- if server reconciliation changes a prediction, animate the correction cleanly instead of snapping.

Use the existing SMARTS music, sound-effects, and haptic systems:

- normal match: light tick/pop;
- special: distinct stronger sound;
- bomb: short impact;
- combo levels: escalating tones;
- FEVER: musical/visual intensity increase;
- victory/defeat: existing result feedback language.

All audio and haptic feedback must respect device settings and SMARTS mute/volume controls.

### Results

Create a Gem Blitz results state that fits the current SMARTS results design and includes:

- winner/defeat/draw state;
- both verified scores and score difference;
- highest combo, specials created, successful moves, accuracy/efficiency where meaningful;
- `You beat X% of players` when the backend has a valid comparison;
- rating/ELO, XP, GLD, streak, mission, and achievement outcomes;
- whether an opponent’s win streak ended;
- rematch action when both players are eligible and the other player remains available;
- share-card action using the existing share-card/deep-link approach;
- compact gift controls if gifts already appear in SMARTS results, without letting them dominate the result.

## 8. SMARTS system integration

Gem Blitz must use the existing platform systems instead of introducing parallel economies.

### Matchmaking and ranking

- Add `GEM_BLITZ` as a supported game mode in the existing matchmaking and match records.
- Casual mode may widen the search range and fill with a human-like bot after policy-defined limits.
- Ranked mode uses the existing ELO/rank season rules with a Gem Blitz game-mode rating or explicitly configured shared rating policy.
- Store game mode on every match, result, leaderboard row, and analytics event.
- Preserve rematch eligibility and same-game-type behavior.

### Progression and rewards

Verified Gem Blitz matches may contribute to:

- account XP;
- missions and achievements;
- daily activity streak qualification;
- win streaks;
- leaderboards;
- season progression;
- configured GLD rewards where allowed by economy policy.

Ranked gameplay must not be monetized through score multipliers, paid starting specials, or other competitive advantages.

### Achievements and missions

Seed content should be admin-manageable and include examples such as:

- **Gem Hunter:** create 100 Color Bombs;
- **Unstoppable:** reach a 10× combo;
- **Lightning Hands:** make 20 successful moves in 30 seconds;
- **Rush Master:** win 100 Gem Blitz matches;
- **Heartbreaker:** win by fewer than 100 points.

These should use the existing mission/achievement event pipeline rather than a new reward framework.

### Bots

Bots must not be omnipotent. Casual bots should model human play:

- realistic move interval and reaction delay;
- configurable skill tiers;
- imperfect move selection;
- occasional missed opportunities and invalid attempts handled client-side without scoring;
- bounded combo and special-piece behavior;
- score and answer volume consistent with human match duration;
- deterministic replay seed for support and testing.

Bot policies must be configurable and must not be used to manipulate ranked results.

## 9. System administration

Add a dedicated **Gem Blitz** page in system admin, separate from generic game configuration where practical. It should use the current admin visual language and avoid continuously refreshing data.

### Policy controls

Administrators should be able to configure, validate, version, activate, and roll back:

- enabled/disabled state;
- visible name, icon/theme, and description;
- board size and gem types;
- casual/ranked availability;
- match duration;
- rush/final-rush thresholds;
- base match scores;
- cascade, speed-combo, and FEVER curves;
- special-piece bonuses and combination behavior;
- score caps and safety limits;
- bot availability, delay, and skill tiers;
- matchmaking widening and timeout rules;
- ranked entry/reward policy;
- XP/GLD reward limits;
- reconnect and forfeit rules;
- animation/audio feature flags if remote control is required.

Every save should create an immutable policy version with editor, timestamp, validation result, and audit entry. Active matches continue using their original rules version.

### Operations views

The admin page should expose:

- active matches and their lifecycle state;
- queue size and average matchmaking time;
- completion, abandonment, disconnect, and reconnect rates;
- score distribution and win-rate balance;
- average moves, cascades, combos, specials, and match duration;
- bot-fill rate and bot-versus-human outcomes;
- suspicious move-rate, sequence, timing, and replay flags;
- recent settlements and failed settlements;
- replay/debug link or event summary for authorized staff;
- maintenance switch with a player-facing message.

Do not expose private player content beyond the permissions required for operations and moderation.
## 10. Analytics and reporting

Track versioned events with `gameMode = GEM_BLITZ`, match ID, policy version, player ID where permitted, platform, and UTC timestamp. Suggested events:

- game card viewed;
- mode selected;
- matchmaking entered/cancelled/found;
- match started;
- move accepted/rejected;
- match/cascade/special/combo/FEVER event;
- reconnect/resync/forfeit;
- match settled;
- result viewed;
- rematch requested/accepted/declined/expired;
- share card generated/shared;
- cosmetic viewed/equipped/purchased.

Reports should support date filters and comparisons for:

- DAU/WAU participation;
- first-play conversion;
- match completion and retention;
- average match length and moves per match;
- average score, score gap, and comeback rate;
- combo and special-piece usage;
- skill/rank distribution;
- matchmaking wait time;
- human/bot mix;
- crashes, socket failures, resyncs, and rejected moves;
- reward emission and economy impact;
- suspicious activity.

## 11. Visual and audio direction

Use SMARTS’ existing dark purple, violet, gold, and cyan visual language, with Gem Blitz-specific gem colors that remain distinguishable for color-blind players.

The board should feel rich without reducing clarity:

- glossy but readable pieces;
- subtle board depth and glow;
- restrained particles on normal matches;
- stronger light trails for specials;
- controlled screen shake only for large events;
- visible but not obstructive score and timer overlays;
- consistent rounded cards, gradients, typography, and bottom navigation.

Cosmetics may include piece skins, board themes, trails, explosion effects, victory effects, and match frames. Cosmetic items must not modify score, timer, board generation, or starting pieces.

## 12. Security and fairness requirements

- The server is authoritative for every accepted move, board transition, score, result, rank, and reward.
- Validate socket ownership and match membership for every message.
- Enforce monotonic move sequence numbers and server-side timing.
- Reject impossible coordinates, impossible cascade claims, duplicate moves, and post-deadline moves.
- Rate-limit move submissions without punishing normal rapid play.
- Compare client telemetry with server event timing only as a signal, never as the source of truth.
- Persist board hashes and policy versions for reconciliation.
- Keep enough replay data to investigate disputes while applying retention limits.
- Do not reveal future RNG values or the opponent’s full board.
- Make settlement idempotent so reconnects cannot duplicate XP, GLD, or ranking rewards.

## 13. Shared test vectors

Before multiplayer integration, define canonical fixtures consumed by both backend and Flutter implementations. Each fixture should include:

```text
seed
rulesVersion
initialBoard
move sequence
expected matched cells
expected created specials
expected cascade count
expected score delta
expected board state/hash
```

Cover at least:

- ordinary three-match;
- four-match Rocket creation;
- five-match Color Bomb creation;
- T/L Bomb creation;
- each special combination;
- multi-cascade resolution;
- no-valid-move reshuffle;
- invalid swap;
- duplicate and out-of-order move;
- deadline and reconnect recovery;
- score cap and FEVER transitions.

## 14. Implementation phases

### Phase 1 — Offline engine and mobile feel

- Implement the isolated deterministic 7 × 7 engine in testable form.
- Implement swaps, match detection, gravity, deterministic falling gems, cascades, specials, scoring, and reshuffles.
- Build a local Flutter Gem Blitz board with responsive touch/swipe input.
- Add fast animations, sound, haptics, combo UI, timer, and FEVER presentation.
- Add shared test vectors and run them against both implementations.
- No multiplayer settlement or ranked rewards yet.

### Phase 2 — Authoritative multiplayer

- Add backend match creation, seed/rules persistence, move validation, server engine execution, socket events, snapshots, and reconciliation.
- Add casual and ranked matchmaking integration.
- Add active-match recovery, timeout, forfeit, and idempotent settlement.
- Add server-side anti-cheat signals and replay references.
- Add mobile matchmaking, live opponent score, reconnect UI, and results.

### Phase 3 — SMARTS progression and administration

- Connect XP, missions, achievements, daily streaks, win streaks, leaderboards, rematch, notifications, and share cards.
- Add Gem Blitz policy/configuration page in system admin.
- Add bot-fill policies and human-like bot profiles for casual mode.
- Add operations dashboards, analytics events, settlement monitoring, and audit logs.
- Add admin validation, activation, rollback, and active-match policy isolation.

### Phase 4 — Polish and controlled expansion

- Tune scoring and matchmaking from real analytics.
- Add cosmetics and themed board presentation.
- Add daily Gem Blitz challenge with a global seed and one ranked attempt if desired.
- Consider co-op mode using the existing cooperative infrastructure.
- Evaluate Battle Mode/garbage blocks only as a separately balanced mode.
- Improve accessibility, device performance, animation quality, and share-card templates.

## 15. Acceptance criteria

Gem Blitz is ready for controlled release when:

- two players receive the same valid starting board and rules version;
- every accepted move is validated and resolved by the server;
- both implementations pass all shared deterministic fixtures;
- scores and results cannot be supplied by the client;
- reconnect restores the exact authoritative state;
- the timer and final cascades settle consistently;
- casual bots behave like bounded human players rather than playing every possible move;
- ranked rewards, ELO, XP, streaks, and missions settle exactly once;
- admin policy changes are versioned and do not alter active matches;
- mobile UI remains readable and responsive on supported screen sizes;
- accessibility, sound, haptic, mute, and reduced-motion settings are respected;
- analytics can explain participation, fairness, performance, economy, and abuse;
- no paid cosmetic or reward item provides a ranked gameplay advantage.

## 16. Product principles

1. **Fast decisions over long waiting.** Every animation and interaction should preserve momentum.
2. **Skill over spending.** Competitive outcomes must not be purchasable.
3. **Same opportunity, different execution.** Deterministic starting conditions make the match feel fair.
4. **Readable before spectacular.** Effects should reinforce the board, not hide it.
5. **Server truth.** Scores, results, rankings, and rewards are never trusted from Flutter.
6. **Reuse SMARTS systems.** Progression, streaks, achievements, matchmaking, notifications, results, and sharing should remain unified.
7. **Measure before expanding.** New modes and attack mechanics should follow evidence from real player behavior.
