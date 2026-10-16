# Word Dash — Backend and Flutter Implementation Plan

## Status

Planning only. This document defines the implementation for **Word Dash**. Do not change backend, Prisma, System Admin, or Flutter files until implementation is explicitly requested.

Word Dash is a fast, competitive word-finding game for SMARTS. It follows the same authoritative-game architecture already used by Gem Blitz and Tile Rush, while keeping the board static so both players have exactly the same opportunities.

## 1. Game identity

### Product name

**Word Dash**

### Stable backend identity

```text
game key:       word_dash
display name:   Word Dash
rules version:  word-dash.v1
dictionary:     english.v1
initial modes:  CASUAL, RANKED, PRACTICE
players:        2
duration:       60 seconds
board:          5 × 5
```

The game must be registered as a normal SMARTS `GameDefinition` and must reuse the existing game configuration, matchmaking, `Match`, `MatchParticipant`, `MatchEvent`, settlement, progression, notification, realtime, and admin authorization infrastructure wherever possible.

Do not create a second wallet, ELO, matchmaking, settlement, or notification system specifically for Word Dash.

## 2. Core gameplay

Both players receive the same immutable 5 × 5 letter board. They have 60 seconds to find as many valid English words as possible by connecting adjacent letters.

Example board:

```text
S  M  A  R  T
E  N  T  L  G
P  A  Y  O  H
C  D  I  V  E
R  U  S  H  K
```

A valid selection can use horizontal, vertical, or diagonal adjacency:

```text
P → L → A → Y
```

The board never removes or changes letters after a word is found. A player’s found-word set and score are independent, but the opportunity space remains identical for both players.

### V1 rules

| Rule | Value |
| --- | --- |
| Players | 2 participants |
| Duration | 60 seconds by default |
| Board | 5 × 5 letters |
| Minimum word | 3 letters |
| Movement | 8-direction adjacency |
| Repeated tile in one word | Never allowed |
| Board changes | None during the match |
| Dictionary | Server-controlled English dictionary |
| Duplicate word | Does not score twice for one player |
| Winner | Highest verified score |
| Tie | Draw, unless the active policy defines a tie-breaker |
| Ranked | Supported when enabled by policy |
| Practice | Supported and excluded from progression/economy |

### Normalization

The server reconstructs the word from the board and the submitted tile indexes. The client does not submit a trusted word or score.

The server should:

- convert board letters and dictionary entries to uppercase ASCII for V1;
- accept only tile indexes in `0..24`;
- reject paths shorter than the configured minimum;
- reject paths longer than the board cell count;
- reject repeated indexes;
- reject non-adjacent consecutive indexes;
- reject words containing characters outside `A-Z` after reconstruction;
- perform dictionary lookup using the immutable active dictionary version;
- keep the reconstructed word in server storage for replay and results, but never broadcast it to the opponent during the match.

V1 is English-only. Arabic and Kurdish should be separate future rule packs because they require different board-generation, normalization, morphology, and dictionary rules.

## 3. Scoring and combo policy

### Base score

The default score table is:

| Word length | Base score |
| ---: | ---: |
| 3 | 100 |
| 4 | 200 |
| 5 | 350 |
| 6 | 550 |
| 7 | 800 |
| 8 | 1,100 |
| 9+ | 1,100 + 150 for every letter above 8 |

Examples:

```text
8 letters  = 1,100
9 letters  = 1,250
10 letters = 1,400
```

The table must live in the active versioned Word Dash policy. The Flutter client may display an estimate for immediate feedback, but only the server can calculate and persist `scoreDelta` and `totalScore`.

### Speed combo

The combo is based only on accepted, unique words. The server compares the accepted-word timestamps and resets the combo when the configured accepted-word window expires.

Recommended V1 defaults:

```text
comboWindowMs: 4,000
three accepted words in the window: COMBO ×2 label, +10% actual score bonus
five accepted words in the window:  COMBO ×3 label, +18% actual score bonus
eight accepted words in the window: WORD RUSH label, +25% actual score bonus
maximum actual combo bonus:          +25%
```

The `×2` and `×3` labels are momentum labels, not literal score multiplication. This preserves the requested excitement without making the result overwhelmingly dependent on a single hot streak.

Recommended score calculation:

```text
validated word length
  → base score
  → combo bonus, capped by policy
  → per-word score cap
  → match score cap
  → authoritative score event
```

Invalid, duplicate, or late submissions do not score. A duplicate must not advance the combo. A rejected submission should not reveal whether the attempted word exists in the dictionary beyond the generic reason exposed to that player.

### Fairness limits

The policy must define:

- maximum score per word;
- maximum score per match;
- maximum submission rate per participant;
- maximum accepted words per participant;
- maximum result/replay payload size;
- whether combo starts after the first accepted word or after the first configured threshold.

Suggested defaults:

```text
maxSubmissionsPerSecond: 12
maxAcceptedWordsPerPlayer: 250
wordScoreCap: 20,000
matchScoreCap: 250,000
```

These are server safeguards, not client behavior assumptions.

## 4. Board generation and dictionary

### Dictionary delivery

The complete dictionary must remain server-side. Do not ship the full dictionary in the Flutter application because that makes answer discovery and reverse engineering easier.

Use a versioned, licensed English word list bundled with the NestJS service or loaded as an immutable read-only asset at boot:

```text
assets/word-dash/dictionaries/english.v1.txt
```

The implementation must document the dictionary source and license before shipping. The loader should:

- normalize each entry once at startup;
- remove words below the minimum length;
- remove proper nouns, offensive entries, abbreviations, and unsupported characters according to a documented filter;
- deduplicate entries;
- build a `Set` for exact lookup;
- build a prefix trie or equivalent index for board validation and generation;
- expose a dictionary SHA-256/version identifier;
- fail startup in production if the configured dictionary version is missing or its checksum is wrong.

The dictionary must be held in application memory, not copied into every match row or every match event. This avoids unnecessary PostgreSQL/WAL growth.

### Board generator

Create a deterministic board generator using:

```text
seed + rulesVersion + dictionaryVersion → exact 25-letter board
```

The generator should use a frequency-weighted English letter distribution, then validate candidate boards using the server dictionary. It must guarantee:

- exactly 25 uppercase letters;
- at least the configured minimum number of valid words;
- at least one valid word of length 6 or longer where possible;
- no board that is obviously empty or dominated by rare letters;
- at least one valid 3-letter word;
- the same board for both players;
- reproducible output for replay and support investigation.

If a candidate fails quality checks, advance the deterministic RNG and generate another candidate. Do not use an uncontrolled random source.

The board generator should precompute the board’s valid-word set once when the match is created or started. It may keep that set in the in-process runtime cache, but the active match record only needs the board, seed, dictionary version, and hash. On a process restart, the server regenerates the set from the immutable dictionary version and board.

### Board hash

Persist and return:

```text
boardHash = SHA-256(rulesVersion + dictionaryVersion + normalizedBoardLetters)
```

The client may send `boardHashBefore` as a reconciliation hint. The server must never trust it instead of its own board record.

## 5. Server-authoritative submission contract

The client submits only a tile path intent:

```json
{
  "matchId": "uuid",
  "sequence": 12,
  "tileIndexes": [10, 11, 6, 7],
  "clientSubmissionId": "uuid",
  "clientStartedAt": "2026-10-16T12:00:00.000Z",
  "clientReleasedAt": "2026-10-16T12:00:01.120Z",
  "boardHashBefore": "optional-sha256"
}
```

The server reconstructs the word from `tileIndexes` and performs all of these checks inside a transaction holding the active match lock:

1. authenticated user owns the participant;
2. match belongs to `word_dash`;
3. match status is active;
4. server time is before the authoritative deadline;
5. sequence is the next expected participant sequence;
6. `clientSubmissionId` has not already been processed;
7. submission rate is within policy;
8. every tile index is inside `0..24`;
9. every consecutive tile is adjacent in one of eight directions;
10. no tile index is repeated;
11. path length is within policy;
12. server-reconstructed word is in the active dictionary;
13. the normalized word has not already been accepted by this participant;
14. score and combo are calculated from server state;
15. the participant state, submission, match event, and live projection are updated atomically.

The client must never send or be trusted for:

```text
score
scoreDelta
totalScore
combo
winner
valid
dictionary result
board letters
board state
GLD reward
ELO change
```

## 6. Backend architecture

Create a dedicated module aligned with Gem Blitz and Tile Rush:

```text
src/modules/word-dash/
  word-dash.module.ts
  word-dash.controller.ts
  word-dash.service.ts
  word-dash-admin.controller.ts
  dtos/
    word-dash.dto.ts
    word-dash-admin.dto.ts
  engine/
    word-dash-engine.ts
    word-dash-board-generator.ts
    word-dash-dictionary.ts
    word-dash-score.ts
    word-dash-hash.ts
  transactions/
    create-word-dash-state.ts
    submit-word-dash-word.ts
    finish-word-dash-match.ts
    settle-word-dash-match.ts
  workers/
    word-dash-finalization.worker.ts
  analytics/
    word-dash-analytics.service.ts
```

Reuse existing services instead of duplicating them:

- `PrismaService` and transaction helpers;
- `MatchesModule` and `SettleMatchTransaction`;
- existing matchmaking and bot fallback;
- `FraudService` for rate, replay, and score-velocity observations;
- existing progression, ELO, missions, streaks, wallet, and leaderboard services;
- existing notification and outbox infrastructure;
- existing realtime gateway and authenticated socket state;
- existing system-admin guard and admin audit helper.

Register the module in:

```text
src/app.module.ts
src/modules/realtime/realtime.module.ts
src/modules/realtime/realtime.gateway.ts
```

## 7. Database design

The existing `Match` and `MatchParticipant` records remain the generic source of truth for lifecycle and final results. Add Word Dash-specific records so a busy match does not repeatedly rewrite a large JSON blob in `Match.metadata`.

### `WordDashMatch`

Suggested Prisma model:

```text
id                 UUID primary key
matchId            UUID unique, relation to Match
seed               VARCHAR(64)
boardLetters       CHAR(25)
boardHash          CHAR(64)
rulesVersion       VARCHAR(64)
dictionaryVersion  VARCHAR(64)
durationSeconds    INT
startedAt          TIMESTAMP nullable
endsAt             TIMESTAMP nullable
endedAt            TIMESTAMP nullable
createdAt          TIMESTAMP
updatedAt          TIMESTAMP
```

`boardLetters` should be compact and immutable. Do not store the full dictionary or all board words on every match by default.

### `WordDashParticipantState`

One row per `MatchParticipant`:

```text
id                    UUID primary key
matchParticipantId    UUID unique
score                 INT default 0
combo                 INT default 0
bestCombo             INT default 0
acceptedWordCount     INT default 0
longestWordLength     INT default 0
lastAcceptedAt        TIMESTAMP nullable
nextSequence          INT default 1
lastSubmissionAt      TIMESTAMP nullable
createdAt             TIMESTAMP
updatedAt             TIMESTAMP
```

Do not store the found-word list as an ever-growing JSON array. It creates repeated row rewrites and unnecessary WAL. Use the normalized found-word table below.

### `WordDashFoundWord`

```text
id                    UUID primary key
matchParticipantId    UUID
word                  VARCHAR(25)
firstSequence         INT
scoreDelta            INT
path                  JSON
acceptedAt            TIMESTAMP
```

Constraints and indexes:

```text
UNIQUE(matchParticipantId, word)
INDEX(matchParticipantId, acceptedAt)
INDEX(matchParticipantId, word)
```

### `WordDashSubmission`

Store accepted and rejected submissions compactly for idempotency, fraud review, and support replay:

```text
id                    UUID primary key
matchId               UUID
matchParticipantId    UUID
sequence              INT
clientSubmissionId    VARCHAR(128)
tileIndexes           JSON
reconstructedWord     VARCHAR(25) nullable
accepted              BOOLEAN
rejectionReason       VARCHAR(160) nullable
scoreDelta            INT default 0
comboAfter            INT default 0
serverReceivedAt      TIMESTAMP
clientReleasedAt      TIMESTAMP nullable
```

Constraints and indexes:

```text
UNIQUE(matchId, matchParticipantId, clientSubmissionId)
UNIQUE(matchId, matchParticipantId, sequence)
INDEX(matchId, matchParticipantId, serverReceivedAt)
```

Do not add a unique constraint on `word` to this table because rejected duplicate attempts need to remain idempotently inspectable. Uniqueness belongs in `WordDashFoundWord`.

### Prisma relations and migration

Add relations from `Match`, `MatchParticipant`, and the new models. Use `onDelete: Cascade` for Word Dash child rows when a match is deleted by an approved retention job. Add the migration only after reviewing the generated SQL and index sizes.

The migration must not rewrite existing match events or existing game data.

## 8. Public backend API

Follow the existing Tile Rush controller shape.

### Snapshot

```http
GET /word-dash/matches/:matchId
```

Response projection:

```json
{
  "matchId": "uuid",
  "gameKey": "word_dash",
  "status": "STARTED",
  "mode": "CASUAL",
  "board": ["S", "M", "A", "R", "T", "..."],
  "boardSize": 5,
  "minimumWordLength": 3,
  "durationSeconds": 60,
  "startedAt": "...",
  "endsAt": "...",
  "serverNow": "...",
  "boardHash": "sha256",
  "selfParticipantId": "uuid",
  "self": {
    "score": 2850,
    "combo": 4,
    "bestCombo": 6,
    "acceptedWordCount": 12,
    "longestWordLength": 7,
    "nextSequence": 13
  },
  "opponent": {
    "displayName": "Sara",
    "avatarUrl": "...",
    "score": 3120,
    "combo": 4,
    "acceptedWordCount": 14
  },
  "recentEvents": [
    { "participantId": "uuid", "type": "WORD_LENGTH", "length": 6 },
    { "participantId": "uuid", "type": "COMBO", "combo": 4 }
  ]
}
```

The snapshot must never include the opponent’s found words while the match is active.

### Start

```http
POST /word-dash/matches/:matchId/start
```

Use the same readiness and recovery behavior as Tile Rush and Gem Blitz. Starting must be idempotent.

### Submit a word

```http
POST /word-dash/matches/:matchId/submissions
```

DTO validation:

```text
sequence:           integer 1..1,000,000
tileIndexes:        array 3..25, each integer 0..24
clientSubmissionId: UUID or max-length idempotency string
clientStartedAt:    optional ISO date
clientReleasedAt:   optional ISO date
boardHashBefore:    optional SHA-256 string
```

Accepted response:

```json
{
  "accepted": true,
  "sequence": 12,
  "word": "PLAYER",
  "length": 6,
  "scoreDelta": 550,
  "totalScore": 2850,
  "combo": 4,
  "comboLabel": "COMBO ×2",
  "boardHash": "sha256",
  "serverReceivedAt": "..."
}
```

The `word` can be returned to the submitting player because they already selected it. It must not be included in the opponent broadcast.

Rejected response:

```json
{
  "accepted": false,
  "sequence": 12,
  "reason": "INVALID_PATH",
  "message": "That path is not valid.",
  "boardHash": "sha256"
}
```

Use stable reason codes such as `MATCH_NOT_ACTIVE`, `SEQUENCE_OUT_OF_DATE`, `INVALID_INDEX`, `NON_ADJACENT_PATH`, `REPEATED_TILE`, `WORD_TOO_SHORT`, `NOT_IN_DICTIONARY`, `DUPLICATE_WORD`, `RATE_LIMITED`, and `BOARD_HASH_MISMATCH`.

Do not expose `NOT_IN_DICTIONARY` in a way that turns the API into a dictionary oracle. A generic invalid-word response is preferable for rapid probing; detailed reasons may be retained for admin logs.

### Reconcile and forfeit

```http
POST /word-dash/matches/:matchId/reconcile
POST /word-dash/matches/:matchId/forfeit
```

Both endpoints must be authenticated, idempotent, and use the same lifecycle/settlement behavior as the other authoritative games.

## 9. Matchmaking and generic match integration

### Game registration

Create or seed a `GameDefinition`:

```text
key:    word_dash
name:   Word Dash
active: policy.enabled
```

Create an active `GameConfig` with:

```text
mainProgressionKey:   word_dash_xp
eloProgressionKey:    word_dash_elo
rewardCurrencyCode:   GLD
maxMatchDurationSeconds: 60
maxQuestions:         0
rankingEnabled:       policy.rankedEnabled
settings.wordDashPolicy: versioned policy
```

The default `maxQuestions` must not be used to represent words. Word Dash uses its dedicated state and submission counters.

### Existing matchmaking changes

Update the generic paths that currently special-case `gem_blitz` and `tile_rush` so `word_dash` is treated as a board-authoritative game:

- `create-match-transaction.ts` must not require `GameContentItem` assignments for Word Dash;
- `enqueue-player-transaction.ts` must allow Word Dash without active question content;
- `claim-matchmaking-pair-transaction.ts` must create the same game definition/config for both players and snapshot the selected policy version;
- ranked mode must reject the queue when `policy.rankedEnabled` is false;
- casual mode may use bot fallback only when `policy.casualBotEnabled` is true;
- minimum player level must use the existing `GameConfig.minimumPlayerLevel` check;
- active queue and match status must remain recoverable after mobile disconnects;
- a policy change must affect new matches only, never an active match.

Use the current SMARTS ticket idempotency and heartbeat behavior. Do not introduce a separate Word Dash queue.

### Match creation metadata

At creation, persist only compact immutable identifiers in `Match.metadata` if needed:

```json
{
  "authoritativeGame": "word_dash",
  "policyVersion": 7,
  "rulesVersion": "word-dash.v1",
  "dictionaryVersion": "english.v1"
}
```

The board and participant rows belong in the dedicated Word Dash tables.

## 10. Bot fallback

Casual bot fallback should be server-side and should never reveal its exact word list during the match.

The bot service should:

- use the same board and dictionary as the human;
- enumerate valid board words once;
- choose words using a deterministic seeded strategy;
- use configurable reaction delay and jitter;
- avoid submitting impossible bursts;
- model skill with maximum word length, acceptance rate, and combo behavior;
- write bot submissions through the same authoritative service path;
- never receive progression, GLD, ELO, missions, achievements, or leaderboard credit.

Suggested policy:

```json
{
  "enabled": true,
  "reactionDelayMs": 1800,
  "jitterMs": 850,
  "skill": 0.35,
  "maxWords": 35,
  "maxWordLength": 7
}
```

The bot must not be allowed in ranked mode unless a future policy explicitly enables it. The mobile UI must clearly identify a bot before a casual match starts when that information is part of the existing SMARTS match disclosure policy.

## 11. Realtime protocol and privacy

Extend the current authenticated realtime gateway instead of introducing another socket server.

### Client to server

```text
word_dash.subscribe
word_dash.submit
word_dash.heartbeat
```

`word_dash.submit` carries the same intent as the HTTP submission endpoint. The service must use the same idempotency key so a socket retry followed by HTTP recovery cannot score twice.

### Server to submitting player

```text
word_dash.snapshot
word_dash.submission.accepted
word_dash.submission.rejected
word_dash.match.finished
word_dash.error
```

The submitting player may receive:

- reconstructed word;
- accepted/rejected reason;
- score delta;
- total score;
- combo state;
- updated self statistics;
- board hash;
- authoritative remaining time.

### Server to opponent

The opponent receives a sanitized event only:

```json
{
  "type": "WORD_LENGTH",
  "participantId": "uuid",
  "length": 6,
  "scoreDelta": 550,
  "combo": 4
}
```

Allowed live event text:

```text
Sara found a 6-letter word! ⚡
Sara COMBO ×4 🔥
Sara started WORD RUSH!
```

Never broadcast the actual word, tile path, or answer candidates until the match has finished for both players.

The gateway must use recipient-specific projection functions. Do not broadcast one full service snapshot to every socket if it contains the submitting player’s word.

### Reconnect

On reconnect, return:

- server clock and deadline;
- immutable board;
- both scores and public combo state;
- self statistics and next sequence;
- sanitized recent events;
- current match status;
- final result when already finished.

The client must reconcile before accepting another drag submission.

## 12. Match finalization and settlement

When the authoritative deadline is reached:

1. reject new submissions after the server deadline;
2. mark the match `FINISHED` exactly once;
3. calculate each participant’s final verified score;
4. calculate result (`WIN`, `LOSS`, `DRAW`, or `FORFEIT`);
5. calculate words found, longest word, max combo, and score summary;
6. calculate the post-match word differences;
7. persist compact analytics and final state;
8. call the existing `SettleMatchTransaction` idempotently;
9. apply normal casual/ranked progression, rewards, ELO, missions, streaks, and leaderboard writes according to policy;
10. suppress all progression, ELO, rewards, missions, streaks, and leaderboard writes for `PRACTICE`;
11. publish a final notification/result event;
12. retry unfinished settlement through the existing worker path without reopening gameplay.

Update generic settlement special cases so Word Dash accepted submissions are treated like verified board-game score events, not like trivia `ANSWER` events.

The client’s final score is display-only. `MatchParticipant.finalScore` and the settlement payload are server-owned.

### End-of-match word comparison

After the match is finished, it is safe to reveal word differences:

```text
Words only you found:
PLAYER, SMART, DASH

Words you missed:
GAMER, THINK
```

Use a deterministic, useful result limit:

- show up to 10 words in each section in the mobile result screen;
- sort missed words by descending score, then length, then alphabetically;
- include `totalMissedCount` when the list is capped;
- never reveal the opponent’s full word set during the active match;
- for a practice match, show personal found/missed words only and do not expose competitive rewards.

## 13. Practice mode

Word Dash must use the existing SMARTS practice mode behavior.

Practice creation:

```http
POST /matches
{
  "gameKey": "word_dash",
  "mode": "PRACTICE",
  "metadata": { "source": "PRACTICE" }
}
```

Practice requirements:

- use the same server-authoritative board and path validation;
- optionally fill the opponent projection with a bot or use a solo board according to the active policy;
- display a clear `PRACTICE` label before gameplay starts;
- calculate local/session score and timing for learning;
- do not update GLD, ELO, XP, player game progression, missions, achievements, streaks, or leaderboards;
- show practice result statistics and best personal practice score only if the existing local-stat policy supports it;
- do not count practice events in competitive analytics or rank distributions.

The backend must identify practice from the persisted `Match.mode`, not from client metadata.

## 14. System Admin configuration

Word Dash needs the same versioned policy workflow used by Tile Rush and Gem Blitz.

### Policy shape

Recommended default policy:

```json
{
  "enabled": true,
  "visibleName": "Word Dash",
  "description": "Find words fast.",
  "rulesVersion": "word-dash.v1",
  "dictionaryVersion": "english.v1",
  "boardSize": 5,
  "durationSeconds": 60,
  "minimumWordLength": 3,
  "allowDiagonal": true,
  "casualEnabled": true,
  "rankedEnabled": true,
  "practiceEnabled": true,
  "casualBotEnabled": true,
  "rankedBotFallback": false,
  "comboWindowMs": 4000,
  "maxSubmissionsPerSecond": 12,
  "maxAcceptedWordsPerPlayer": 250,
  "wordScoreCap": 20000,
  "matchScoreCap": 250000,
  "scoreTable": {
    "3": 100,
    "4": 200,
    "5": 350,
    "6": 550,
    "7": 800,
    "8": 1100,
    "extraLetterAfter8": 150
  },
  "comboBonuses": {
    "three": 0.10,
    "five": 0.18,
    "eight": 0.25,
    "max": 0.25
  },
  "bot": {
    "enabled": true,
    "reactionDelayMs": 1800,
    "jitterMs": 850,
    "skill": 0.35,
    "maxWords": 35,
    "maxWordLength": 7
  }
}
```

V1 should keep `boardSize`, `minimumWordLength`, and `allowDiagonal` constrained to safe supported values. The admin must not be able to create a board configuration the Flutter client cannot render.

### Admin endpoints

Add a dedicated controller following the existing admin pattern:

```http
GET   /system-admin/api/word-dash/policy
PATCH /system-admin/api/word-dash/policy
POST  /system-admin/api/word-dash/policy/rollback/:version
GET   /system-admin/api/word-dash/operations
GET   /system-admin/api/word-dash/matches/:matchId/replay
POST  /system-admin/api/word-dash/operations/:matchId/retry-settlement
```

Every policy update must:

- validate all fields and score bounds;
- create a new `GameConfig` version;
- deactivate the previous active config;
- update the game definition’s display name/active state;
- preserve all prior settings not owned by Word Dash;
- write an admin audit event with actor, reason, version, and policy;
- affect new matches only.

The System Admin UI should expose:

- enable/disable game;
- casual/ranked/practice toggles;
- duration and minimum word length;
- diagonal movement toggle;
- dictionary version/checksum;
- base score table;
- combo thresholds and actual bonuses;
- score/rate caps;
- bot fallback and bot skill;
- active policy version and rollback;
- active/searching/finished/review/settled match counts;
- rejected submission and duplicate rates;
- average words per player, average score, longest word, and settlement rate;
- match replay/review and retry settlement.

Never expose the NOW or full dictionary file through a public endpoint.

## 15. Flutter mobile implementation

Create a dedicated feature rather than embedding Word Dash logic inside Tile Rush or Trivia.

Suggested files:

```text
lib/features/word_dash/
  domain/
    word_dash_engine.dart
    word_dash_models.dart
  presentation/
    providers/word_dash_multiplayer_provider.dart
    widgets/word_dash_board.dart
    widgets/word_dash_hud.dart
    widgets/word_dash_word_feed.dart
  data/
    word_dash_repository.dart

lib/infrastructure/railway/railway_word_dash_service.dart
lib/presentation/screens/game/word_dash_multiplayer_screen.dart
```

### `RailwayWordDashService`

Mirror the existing `RailwayTileRushService` transport shape:

```dart
Future<Object?> createPracticeMatch({required String idempotencyKey});
Future<Object?> snapshot(String matchId);
Future<Object?> start(String matchId);
Future<Object?> submit(
  String matchId, {
  required int sequence,
  required List<int> tileIndexes,
  required String clientSubmissionId,
  required String boardHashBefore,
});
Future<Object?> reconcile(String matchId);
Future<Object?> forfeit(String matchId);
```

Use the existing authenticated API client, request idempotency context, error normalization, and access-token refresh behavior.

### Domain engine

The client engine is responsible for interaction, not authority. It should:

- render the 5 × 5 board;
- convert pointer locations to tile indexes;
- determine adjacency for immediate gesture feedback;
- prevent repeated tile selection in the current path;
- support backtracking by dragging onto the immediately previous tile;
- display the current reconstructed local word;
- draw the selection line and tile states;
- clear the path after release;
- reconcile to the server snapshot after acceptance/rejection;
- never validate the word as authoritative;
- never calculate the final score as authoritative.

The local engine may show an optimistic word preview, but it must replace it with the server response immediately after release.

### Provider responsibilities

`WordDashMultiplayerProvider` should follow the lifecycle of `TileRushMultiplayerProvider`:

```text
idle
searching
ready
playing
finished
error
```

It must manage:

- casual, ranked, and practice entry;
- queue ticket and match recovery;
- authenticated realtime connection;
- match subscription;
- HTTP fallback and reconciliation;
- server clock offset and deadline timer;
- participant sequence;
- submission idempotency;
- optimistic board path state;
- opponent score/event projection;
- reconnect after background/resume;
- result navigation exactly once;
- practice-mode state.

If a submission receives `SEQUENCE_OUT_OF_DATE` or `BOARD_HASH_MISMATCH`, the provider must stop accepting another release until a fresh snapshot has been applied.

## 16. Flutter gameplay screen

The screen should fit the current SMARTS game language shown in Gem Blitz and Tile Rush:

### Header

- back/leave action;
- player avatar and display name;
- opponent avatar and display name;
- both verified scores;
- small lead indicator;
- circular 60-second timer;
- visible `CASUAL`, `RANKED`, or `PRACTICE` badge.

### Board

- centered 5 × 5 board that fits safely on small phones;
- large high-contrast rounded letter tiles;
- subtle different tile colors for readability, not different gameplay values;
- selected path shown with a bright connecting line;
- selected letters glow in sequence;
- last submitted word shown briefly above or below the board;
- invalid path shakes and clears without showing dictionary answers;
- no tile is removed after a word is found;
- maintain 60 FPS during drag and line drawing;
- support touch, stylus, and accessibility semantics for each tile.

### Lower HUD

- current word preview;
- `SUBMIT` affordance only as an optional fallback; release-to-submit is the primary interaction;
- accepted word feed showing the player’s own recent words and points;
- opponent event feed showing only word length/combo events;
- combo badge and `WORD RUSH` celebration;
- haptics/audio through the existing SMARTS settings and mute state.

Do not reveal opponent words in the live screen. The end-of-match result is the first place where word differences can appear.

### Accessibility and input safety

- minimum tile hit target 44 logical pixels;
- use semantic labels such as “row 2 column 4, letter L”;
- provide a non-drag tap sequence fallback for users who cannot drag;
- ignore pointer events when the match is paused, finished, disconnected, or submission is pending;
- avoid triggering duplicate submissions from both pointer-up and a submit button;
- handle safe-area insets and keyboard/navigation gestures.

## 17. Results screen

Extend the existing `GameResultsScreen` with a Word Dash projection instead of creating a separate duplicate result framework.

The result should include:

```text
VICTORY / DEFEAT / DRAW

ALAND                         SARA
4,850                         4,320

Words: 18                     Words: 16
Longest: 7                    Longest: 6
Best combo: 8                 Best combo: 6

Words only you found:
PLAYER · SMART · DASH

Words you missed:
GAMER · THINK

XP / GLD / ELO result when eligible

[ REMATCH ]       [ SHARE ]
```

For practice:

- replace competitive result language with `PRACTICE COMPLETE`;
- show score, speed, longest word, and personal practice feedback;
- do not show GLD, ELO, XP, or competitive leaderboard changes;
- keep rematch/retry behavior consistent with existing practice games.

## 18. Notifications, analytics, and fraud signals

Use player-facing notification language, not generic server messages:

```text
Your Word Dash match is ready.
You won Word Dash and scored 4,850 points.
Your Word Dash match ended in a draw.
Your Word Dash result is being reviewed.
```

Suggested server-owned analytics events:

```text
WORD_DASH_MATCH_CREATED
WORD_DASH_MATCH_STARTED
WORD_DASH_SUBMISSION_ACCEPTED
WORD_DASH_SUBMISSION_REJECTED
WORD_DASH_COMBO_REACHED
WORD_DASH_WORD_RUSH_STARTED
WORD_DASH_MATCH_FINISHED
WORD_DASH_MATCH_SETTLED
WORD_DASH_BOARD_HASH_MISMATCH
WORD_DASH_RATE_LIMITED
```

Keep event properties compact. Do not persist the full board or full path in every analytics event.

Useful aggregate properties:

```text
wordLength
scoreDelta
combo
acceptedWordCount
longestWordLength
rejectionReason
mode
rulesVersion
dictionaryVersion
```

Send suspicious observations to the existing fraud service:

- impossible submission rate;
- repeated board hash mismatch;
- sequence gaps or replay attempts;
- score velocity above the configured cap;
- repeated invalid paths designed to probe dictionary behavior;
- impossible client timestamps;
- submissions after deadline;
- abnormal accepted-word length distribution.

Do not automatically ban solely from one signal. Preserve evidence and use the existing review policy.

## 19. Data retention and PostgreSQL safety

Word Dash can generate more submissions than Trivia, so storage must be designed conservatively.

- Keep `WordDashSubmission` payloads compact.
- Do not repeat the full board in each submission.
- Do not copy the full dictionary into `Match.metadata`, analytics, or events.
- Do not rewrite an ever-growing JSON found-word list on every submission.
- Retain accepted/rejected submission rows only for the configured replay/fraud window.
- Keep one compact final summary after the retention window expires.
- Add indexes only for real query paths.
- Avoid unbounded `recentEvents` arrays in `Match.metadata`.
- Batch or prune admin analytics queries by date and game key.
- Ensure the retention worker includes Word Dash submissions and found words after a finalized-match retention period.
- Monitor WAL, table size, index size, dead tuples, and autovacuum behavior after launch.

The implementation should include a storage estimate before production rollout:

```text
expected matches/day
× average submissions/player
× average row + index bytes
× retention days
```

This is especially important because the SMARTS database has previously experienced excessive table/index/WAL growth.

## 20. Test plan

### Backend unit tests

Test the pure engine and generator:

- deterministic board generation for the same seed/rules/dictionary;
- board quality constraints;
- horizontal, vertical, and diagonal adjacency;
- rejection of non-adjacent paths;
- rejection of repeated indexes;
- minimum and maximum path length;
- path-to-word reconstruction;
- dictionary membership;
- duplicate handling;
- score table and 8+ formula;
- combo threshold and cap behavior;
- deadline behavior;
- match score cap;
- dictionary version/checksum failure;
- missed-word ordering;
- practice scoring with no progression side effects.

### Backend integration tests

- two users receive the same board;
- concurrent submissions serialize correctly under a row lock;
- duplicate client submission is idempotent;
- duplicate word cannot score twice;
- sequence retry returns the original result;
- socket and HTTP submission with the same idempotency key score once;
- opponent projection never contains the actual live word;
- final result reveals word differences only after finish;
- bot submissions use the same validation path;
- policy changes do not alter active matches;
- settlement retries do not pay twice;
- `PRACTICE` does not update GLD/ELO/XP/mission/streak/leaderboard systems.

### Flutter tests

- index-to-row/column conversion;
- 8-direction gesture adjacency;
- no repeated tile in a path;
- backtracking behavior;
- board rendering for exactly 25 letters;
- timer based on server clock offset;
- submission sequence and idempotency;
- reconnect and snapshot reconciliation;
- sanitized opponent events;
- practice badge and result behavior;
- result navigation only once;
- accessibility semantics and minimum hit targets.

### Contract and load tests

- OpenAPI request/response contract tests;
- invalid payload fuzzing;
- rapid submission/rate-limit tests;
- 2-player concurrent match simulation;
- hundreds of simultaneous matches with realistic word submission rates;
- WAL/table/index growth measurement;
- settlement worker retry under provider/database failures.

## 21. Implementation phases

### Phase 0 — Product and content lock

- confirm English dictionary source/license;
- define `english.v1` normalization/filter rules;
- finalize score/combo defaults;
- define policy bounds and result limits;
- create shared JSON fixtures for sample boards and paths;
- confirm whether ranked mode launches immediately or behind a feature flag.

### Phase 1 — Backend foundation

- add Prisma models and migration;
- add dictionary loader and checksum validation;
- implement deterministic board generator;
- implement pure Word Dash engine and score policy;
- seed `word_dash` game definition/config;
- add DTO validation and module registration.

### Phase 2 — Authoritative HTTP gameplay

- implement match initialization and snapshot;
- implement start, submit, reconcile, and forfeit endpoints;
- implement path validation, word lookup, duplicate protection, score, combo, and state persistence;
- add row locking/idempotency;
- add finalization and generic settlement integration;
- add casual bot path.

### Phase 3 — Matchmaking and realtime

- update generic matchmaking board-game special cases;
- add socket subscribe/submit/snapshot events;
- add recipient-specific sanitized opponent events;
- add reconnect, heartbeat, timeout, and worker recovery;
- add fraud observations and compact analytics.

### Phase 4 — Flutter mobile gameplay

- add Railway transport;
- add domain interaction engine;
- add provider and match recovery;
- build the 5 × 5 drag board and HUD;
- add mode selection, practice flow, casual/ranked queue integration;
- add sound/haptic/reduced-motion behavior;
- extend results screen.

### Phase 5 — System Admin and operations

- add versioned policy endpoints and audit records;
- add Word Dash policy editor and rollback;
- add operations, analytics, replay, and settlement retry views;
- add dictionary version/checksum health status;
- add retention/storage metrics.

### Phase 6 — Verification and controlled rollout

- run unit, integration, contract, mobile, realtime, and load tests;
- launch disabled behind the existing game configuration;
- enable practice first;
- enable casual with bot fallback;
- run controlled real-player matches;
- enable ranked only after score distribution, exploit signals, and storage usage are acceptable;
- monitor PostgreSQL WAL/table/index growth and settlement health;
- publish the game only after rollback has been tested.

## 22. Definition of done

Word Dash is ready for production only when:

- both players receive the same server-created board;
- the client sends tile paths, never trusted words or scores;
- adjacency, repeats, dictionary, deadline, duplicate, sequence, and rate limits are server-authoritative;
- the board remains unchanged after every accepted word;
- the score curve and combo cap match the active policy;
- live opponent updates never reveal the opponent’s words;
- result comparison reveals missed/unique words only after the match ends;
- casual, ranked, and practice behavior is explicit and tested;
- settlement is idempotent and practice has no progression/economy side effects;
- reconnect and HTTP fallback work;
- System Admin can configure, version, audit, rollback, and observe the game;
- the English dictionary is licensed, checksummed, and server-only;
- PostgreSQL storage/WAL retention is bounded and measured;
- backend and Flutter tests pass;
- the game can be disabled or rolled back without a deployment.
