# SMARTS LootLocker/Firebase-to-Railway NestJS Greenfield Plan

**Status:** Greenfield implementation blueprint only; starting with zero users and zero legacy game data  
**Target:** `nestjs-railway-starter`  
**Client:** SMARTS Flutter mobile application  
**Database:** PostgreSQL through Prisma  
**Architecture reference:** Nexa Backend module and transaction conventions  
**Important:** This document intentionally does not implement the phases. It is the contract and sequencing plan to implement them safely one phase at a time. The target database starts empty: there is no user import, legacy balance import, inventory import, leaderboard import, shadow comparison, or production cutover from an existing player population. The old LootLocker/Firebase behavior is used only as a design reference so the new implementation preserves required gameplay behavior safely.

## 1. Objective and non-negotiable decisions

LootLocker must be removed from the runtime architecture. The Railway NestJS service becomes the only authority for SMARTS identity, profiles, progression, virtual currency, rewards, leaderboards, inventory, purchases, social state, matchmaking, game content, game statistics, and game-result rewards. This is a new installation, so all users, profiles, wallets, progression rows, stats, friendships, and game history are created natively by Railway from the first registration onward.

Firebase must also be removed as a game-backend authority. This migration replaces the SMARTS Firebase Realtime Database/Firestore matchmaking queues, match documents, friend-match documents, question/game data, public-storage game statistics, `rewards` collection, Firebase Remote Config reward policy, and the Firebase Cloud Function used by the purchase flow. Firebase Cloud Messaging may be retained temporarily as a delivery adapter only; it must never remain the source of truth for state, rewards, or authorization. If the final requirement is zero Firebase runtime dependency, remove that adapter too.

The Flutter application remains a presentation and input client. It may display values and submit a user action, but it must never be trusted to choose or directly write:

- user status, roles, or administrator flags;
- XP, level, progression tier, or progression rewards;
- ELO/rating, win/loss totals, or leaderboard scores;
- wallet balances, currency grants, purchase prices, or inventory ownership;
- match winners, opponent scores, reward amounts, or reward eligibility;
- ad-reward amounts or anti-abuse decisions.

The backend must calculate those values from a trusted command and persist the complete result atomically.

The design uses:

1. UUID primary keys for all new application entities and user-facing identifiers.
2. A separate `User` authentication identity and `PlayerProfile` game profile.
3. PostgreSQL transactions for every multi-record command.
4. Append-only ledgers for money-like balances, XP, ELO, score awards, purchases, and administrative corrections.
5. Idempotency keys on every client-retryable write.
6. Outbox events for work that must happen after commit.
7. Nexa-style domain modules containing `dtos`, `entities`/Prisma models, `enums`, `services`, `controllers`, `utilities`, and a `transactions` directory.

The starter currently has a Prisma version of the transaction seam in `src/common/helpers/prisma-transaction.ts`:

- `run(input)` opens a Prisma transaction.
- `runWithinTransaction(input, transaction)` composes a child transaction inside an existing transaction.
- A transaction class owns one business operation and receives `Prisma.TransactionClient`.

Continue this pattern. Do not introduce raw `prisma.$transaction` calls in controllers or scattered service methods. A service may use a short read-only query, but a state-changing use case must have a named transaction class.

## 2. What was found in SMARTS

The replacement design is based on the actual Flutter implementation, not only on generic LootLocker concepts.

### 2.1 Existing mobile layers

SMARTS follows a useful separation that should be preserved at the client boundary:

```text
presentation providers/screens
        -> core use cases
        -> core repository interfaces
        -> infrastructure implementations
```

The implementations currently call LootLocker directly under `smarts/lib/infrastructure/lootlocker/`. The replacement should keep the repository interfaces where practical and replace the infrastructure implementations with a Railway HTTP client. The mobile code must stop importing or configuring LootLocker before launch.

Important inspected files include:

- `smarts/AUTH_README.md`
- `smarts/lib/infrastructure/lootlocker/lootlocker_auth_service.dart`
- `smarts/lib/infrastructure/lootlocker/lootlocker_progression_service.dart`
- `smarts/lib/infrastructure/lootlocker/lootlocker_leaderboard_service.dart`
- `smarts/lib/infrastructure/lootlocker/lootlocker_wallet_service.dart`
- `smarts/lib/infrastructure/lootlocker/lootlocker_inventory_service.dart`
- `smarts/lib/infrastructure/lootlocker/lootlocker_catalog_service.dart`
- `smarts/lib/infrastructure/lootlocker/lootlocker_purchase_service.dart`
- `smarts/lib/infrastructure/lootlocker/lootlocker_storage_service.dart`
- `smarts/lib/infrastructure/lootlocker/lootlocker_metadata_service.dart`
- `smarts/lib/infrastructure/lootlocker/lootlocker_friends_service.dart`
- `smarts/lib/infrastructure/lootlocker/lootlocker_file_service.dart`
- `smarts/lib/infrastructure/lootlocker/lootlocker_feedback_service.dart`
- `smarts/lib/features/game/presentation/providers/*_game_provider.dart`
- `smarts/lib/features/leaderboards/presentation/providers/leaderboard_provider.dart`
- `smarts/lib/features/progression/presentation/providers/progression_provider.dart`
- `smarts/lib/features/wallet/presentation/providers/wallet_provider.dart`
- `smarts/lib/features/rewards/presentation/providers/rewards_provider.dart`

### 2.2 Authentication and player profile currently used

The old authentication flow is:

1. White-label email/password sign-up or sign-in.
2. LootLocker game-session creation.
3. A LootLocker `session_token` stored in Flutter secure storage.
4. The token sent as `x-session-token` on all game API requests.
5. Optional Google sign-in through the Google token exchange and LootLocker Google session endpoint.
6. Player name/profile data loaded separately.

The replacement flow is already partially represented in the starter:

```text
POST /auth/register -> access token + refresh token + User + PlayerProfile + PlayerStats
POST /auth/login    -> access token + refresh token + Session
POST /auth/refresh  -> rotate refresh token and Session
GET  /auth/me       -> current identity
GET  /players/me    -> current profile and authoritative statistics
```

The existing starter models `User`, `Session`, `PlayerProfile`, and `PlayerStats` with UUID keys. Keep those models as the foundation, then add the game-domain models below.

### 2.3 Progression and leveling behavior currently used

SMARTS uses at least two configured progressions:

- a main level progression, default configuration key `main`;
- an ELO/rank progression, default configuration key `elo`.

LootLocker exposes progression values as `progression_key`, `progression_name`, `step`, `points`, `previous_threshold`, `next_threshold`, and `last_level_up`. Tier definitions contain `step`, `points_threshold`, and reward arrays.

The client currently:

- loads player progression by key;
- loads all tiers with cursor pagination;
- adds/subtracts progression points;
- stores a previous level/tier in local preferences to detect a level-up dialog;
- initializes new players with progression points during sign-up in the old flow;
- uses game score multiplied by `score_multiplier_for_xp` for XP in several games;
- uses a bounded ELO change for multiplayer and a score-derived ELO amount for solo/bot games.

The backend replacement must calculate the new tier from thresholds, detect every crossed tier, grant each tier reward once, and return a `progressionDelta` that lets Flutter display the same level-up experience without trusting local level calculations.

### 2.4 Wallet and currency behavior currently used

The old implementation uses a LootLocker wallet for a player holder, looks up currency definitions by code, lists balances, and credits balances. The configured currencies include a normal game currency and a gold currency; the Flutter config uses `currency_code` and `gold_currency_code` and the current game code commonly refers to MCN and GLD.

Observed behavior includes:

- player wallet lookup by holder;
- currency lookup by code;
- balance listing;
- crediting a starting balance on account initialization;
- crediting game rewards;
- crediting ad rewards;
- spending through catalog purchase operations.

Every balance-changing operation must become a ledger-backed backend command. A direct `balance = balance + amount` endpoint is insufficient because retries, duplicate mobile callbacks, concurrent claims, refunds, and audit requirements need durable transaction records.

### 2.5 Leaderboards currently used

The client loads four configured boards:

| Dimension | Period |
| --- | --- |
| player | weekly |
| player | monthly |
| country | weekly |
| country | monthly |

The old service supports listing scores, leaderboard details, incrementing a member score, submitting a score, looking up selected members, and reading a member's score/rank. The provider uses player IDs as member IDs for player boards and country codes as member IDs for country boards.

The current game-result code increments player leaderboards and, when countries differ and a winner country exists, submits/increments the winner country score. The exact reward/score policy must be made a named backend policy rather than reconstructed from a client request.

### 2.6 Rewards, inventory, catalog, purchases, storage, and metadata

The rewards screen currently combines several LootLocker concepts:

1. catalog listings;
2. catalog prices by currency;
3. asset details;
4. player inventory;
5. purchases;
6. metadata operations;
7. file/profile URL storage.

The client currently uses catalog and asset IDs, parses catalog `entries` and `assets_details`, chooses a configured currency price, lists inventory, and purchases a catalog listing. These should become first-class Railway domain models. Do not expose a generic arbitrary database update endpoint as a replacement for LootLocker metadata or storage.

### 2.7 Other current integrations

The SMARTS app also contains:

- Firebase/Realtime Database matchmaking queues and match state;
- friend requests and friend relationships;
- online/presence information;
- public player storage used for `last_seen`, `profile_url`, and country-related lookups;
- player files/profile assets;
- feedback categories and feedback submission;
- Google sign-in token exchange;
- ad-based reward flows;
- Firebase Realtime Database queues and Firestore `matches`, `friend_matches`, `questions`, and `rewards` collections;
- Firebase Remote Config keys for game rewards, ranking-match multipliers, ad eCPM, region multipliers, maintenance, and app version;
- the `notifyAdminPurchaseHttp` Firebase Cloud Function dependency.

These are not LootLocker data, so they need their own replacement and verification work. They are nevertheless in scope: the target architecture is NestJS plus PostgreSQL, with Firebase removed from all authoritative game and reward paths.

### 2.8 Firebase responsibilities to replace

The SMARTS source contains two matchmaking implementations: a Firestore repository and the registered Realtime Database repository. Both have the same architectural problem: the mobile client writes identity, level/ELO snapshots, challenge payloads, expiry, and player state, while matching and filtering happen partly on the client. The replacement must choose one canonical Railway implementation and must not preserve either Firebase variant.

| Current Firebase surface | Observed SMARTS behavior | Required Railway replacement |
| --- | --- | --- |
| RTDB `matchmaking_queue` | Client creates timestamp IDs, writes player data, refreshes a short TTL, and uses `onDisconnect` cleanup | PostgreSQL `MatchmakingTicket`, server timestamps, heartbeat/lease, expiry worker, and authenticated queue commands |
| Firestore `matchmaking_queue` | Alternate queue with approximately 30-second expiry and client-side filtering | Same canonical relational queue; no dual queue or Firebase fallback |
| Firestore `matches` and `friend_matches` | Client-visible match documents, status changes, countdown, nested player states, and ranking-series fields | `Match`, `MatchParticipant`, `MatchRound`, append-only `MatchEvent`, and NestJS WebSocket/SSE/HTTP reads |
| Client `playerStates` writes | Flutter sends score, correct answers, current question, and finish state directly | Server-accepted gameplay events and `SettleMatchTransaction`; clients never write final score or opponent state |
| Firestore `questions` plus local game repositories | Mobile loads active questions, shuffles, validates answers, and calculates points locally | `GameDefinition`, `GameContentItem`, server-issued assignments/nonces, server scoring, and protected answer data |
| Public storage game-stat keys | `GameStatsProvider` reads and updates totals such as games played, wins, accuracy, score, and answer time | `PlayerGameStats` projection rebuilt from settled match/game events; no arbitrary client storage writes |
| Firestore `rewards` | Purchase flow writes pending/redeemed reward documents after LootLocker purchase and infers the newest inventory item | Railway `Purchase`, `PurchaseLine`, `InventoryItem`, `RewardGrant`, and `Redemption` rows in one idempotent flow |
| `notifyAdminPurchaseHttp` Cloud Function | Client sends a purchase notification with a LootLocker bearer token; errors are swallowed | Transactional `OutboxEvent` plus a NestJS notification worker/provider adapter after commit |
| Firebase Remote Config `game_config` | Client reads reward multipliers, leaderboard keys, ranking settings, ad settings, maintenance, version, and currency keys | Versioned Railway `GameConfig`/`RewardPolicyVersion` records and environment secrets; clients receive safe display config only |
| Firebase ad reward settings | Client reads regional multiplier/eCPM and credits GLD through the old wallet service | Backend-verified `AdRewardClaim`, server policy snapshot, caps, unique provider event, and wallet ledger credit |
| Firebase Messaging | Used as part of the Firebase runtime initialization | Optional post-commit notification delivery only; never a queue, match, reward, or auth authority |

The following SMARTS behaviors are explicitly unsafe and must be moved behind NestJS: client-supplied player IDs/names/level/ELO, client-created queue/match IDs, client-provided challenge lists, direct nested match-state updates, local answer validation as a reward authority, local bot settlement, local game-stat increments, client-reported ad value/region, and “read latest inventory item then attach reward metadata.”

## 3. Target NestJS architecture

### 3.1 Module layout

Start with the existing modules and add domains in this shape:

```text
src/
  common/
    decorators/
    guards/
    helpers/
      prisma-transaction.ts
    idempotency/
    outbox/
  database/
  modules/
    auth/
    admin/
      access/users/
      access/sessions/
    players/
    progression/
    economy/
    leaderboards/
    matchmaking/
    game-content/
    game-stats/
    matches/
    ad-rewards/
    notifications/
    rewards/
      catalog/
      inventory/
      purchases/
    player-storage/
    social/
      friends/
      presence/
    feedback/
    system-admin/
```

Each domain should follow the Nexa-shaped structure:

```text
<domain>/
  <domain>.module.ts
  <domain>.controller.ts
  <domain>.service.ts
  dtos/
    create-*.dto.ts
    update-*.dto.ts
    *-query.dto.ts
    *-response.dto.ts
    index.ts
  entities/                 # only when a Prisma/domain entity wrapper is useful
  enums/
    *.enum.ts
    index.ts
  utilities/
  transactions/
    create-*-transaction.ts
    update-*-transaction.ts
    award-*-transaction.ts
```

A transaction class should:

- accept a typed input object;
- validate the invariant that belongs to the command;
- read and lock rows when concurrent updates are possible;
- write all related rows with the same `Prisma.TransactionClient`;
- create idempotency/event/ledger rows in the same transaction;
- return a typed result;
- be composable through `runWithinTransaction`.

A service should orchestrate the use case and map the result to a DTO. Controllers should only validate transport input, identify the authenticated user, and call a service.

### 3.2 Transaction boundaries

Use one atomic transaction for commands such as:

```text
Register user
  User + PlayerProfile + PlayerStats + Wallet + default balances

Complete match
  Match + MatchParticipant states + player stats + progression events
  + wallet ledger + leaderboard score events + outbox event

Award progression
  Player progression + crossed tiers + reward grants + XP event

Purchase catalog item
  Purchase + price snapshot + debit ledger + inventory grants

Change account status
  User status + active session termination + audit event
```

Do not make an HTTP call to Google, Firebase, an ad provider, S3, or any other external service while a PostgreSQL transaction is open. Persist an outbox job first, commit, and let a worker perform the external operation.

### 3.3 Concurrency and idempotency rules

- Use `SELECT ... FOR UPDATE` semantics through Prisma interactive transactions or explicit SQL for wallet balances, progression rows, match settlement, leaderboard entries, and purchase claims.
- Add unique constraints for all client command idempotency keys.
- A repeated command returns the original committed result; it does not award again.
- Never use a client timestamp as an authority for expiry or reward eligibility. Use PostgreSQL/server time.
- Never use JavaScript `number` arithmetic for BigInt balances, XP totals, or scores that can exceed the safe integer range.
- Serialize Prisma `BigInt` values to JSON strings consistently.
- Keep transactions short. Compute and validate the request before entering the transaction where possible.
- Use bounded pagination for every list. Never load an unbounded user, inventory, ledger, or leaderboard collection.

## 4. Database design

The starter already defines these base tables for the empty initial database:

```text
User
Session
PlayerProfile
PlayerStats
```

The following schema is the recommended target. Names use Prisma model style; SQL migrations should use explicit PostgreSQL types and constraints. All IDs are UUID unless a field is explicitly a key/code/cursor.

### 4.1 Existing base models to retain and harden

#### `User`

| Column | PostgreSQL type | Rules |
| --- | --- | --- |
| `id` | `UUID` | PK, `gen_random_uuid()` |
| `username` | `VARCHAR(50)` | required, normalized lowercase, unique |
| `email` | `VARCHAR(255)` | nullable if product allows it, normalized lowercase, unique when present |
| `passwordHash` | `VARCHAR(255)` | bcrypt/argon-compatible hash, never returned |
| `firstName` | `VARCHAR(100)` | nullable |
| `lastName` | `VARCHAR(100)` | nullable |
| `status` | enum `ACTIVE/INACTIVE/BANNED` | default `ACTIVE` |
| `isSystemAdmin` | `BOOLEAN` | default false; never client-controlled |
| `lastOnline` | `TIMESTAMPTZ` | server-maintained |
| `createdAt` / `updatedAt` | `TIMESTAMPTZ` | server-maintained |

Do not add LootLocker or Firebase identity columns to the new `User` table. If Google/Apple or another approved sign-in provider is supported, store its runtime subject in `ExternalIdentity`; there is no legacy identity import.

#### `Session`

Retain the UUID `id`, UUID `tokenId`, `userId`, `sessionStatus`, `refreshTokenHash`, timestamps, expiry, client metadata, and mobile/browser flag already present in the starter. Add or verify:

- `replacedBySessionId UUID NULL` for refresh-token rotation tracing;
- `revokedAt TIMESTAMPTZ NULL`;
- `revocationReason VARCHAR(80) NULL`;
- index `(userId, sessionStatus, expiresAt)`;
- index `(expiresAt)` for cleanup.

The access token is short-lived and stateless, but every request still validates the active session and user status. Refresh tokens are stored only as hashes, and rotation must atomically terminate the old session/token and create the replacement.

#### `PlayerProfile`

Retain the existing UUID profile ID and one-to-one `userId`. Keep user-editable fields such as `displayName`, `avatarUrl`, `countryCode`, and `bio`. Do not use this table as the source of truth for all game calculations once the progression and rating tables exist.

`level`, `xp`, and `elo` may remain as compatibility projections for the existing `/players/me` response. They must be initialized by registration and written only by progression/rating transactions, never by `PATCH /players/me`.

#### `PlayerStats`

Retain `gamesPlayed`, `wins`, `losses`, `draws`, streak fields, `highestElo`, and `totalScore` as projections. The authoritative operation history should be in match/result and event tables. A repair/rebuild job must be able to recalculate these projections.

### 4.2 External identities and idempotency

#### `ExternalIdentity`

Use this only for runtime sign-in providers that the new application intentionally supports. It is not a legacy migration table.

| Column | Type | Rules |
| --- | --- | --- |
| `id` | UUID | PK |
| `userId` | UUID | FK `User`, cascade |
| `provider` | enum/string | `GOOGLE`, `APPLE`, or another approved provider; never LootLocker/Firebase |
| `providerSubject` | `VARCHAR(255)` | required, unique per provider |
| `providerEmail` | `VARCHAR(255)` | nullable, provider metadata only |
| `metadata` | `JSONB` | non-authoritative provider details |
| `linkedAt` | `TIMESTAMPTZ` | required |
| `createdAt` / `updatedAt` | `TIMESTAMPTZ` | server-maintained |

Unique constraint: `(provider, providerSubject)`. Never use an email alone as a stable external identity.

#### `IdempotencyKey`

| Column | Type | Rules |
| --- | --- | --- |
| `id` | UUID | PK |
| `userId` | UUID NULL | actor, nullable for trusted jobs |
| `scope` | `VARCHAR(100)` | e.g. `MATCH_COMPLETE`, `WALLET_CREDIT` |
| `key` | `VARCHAR(128)` | client/job supplied opaque key |
| `requestHash` | `CHAR(64)` | hash of normalized request |
| `responseJson` | `JSONB` | original safe response |
| `status` | enum | `PROCESSING`, `COMPLETED`, `FAILED` |
| `createdAt` / `completedAt` | `TIMESTAMPTZ` | server-maintained |

Unique constraint: `(scope, key)`. If the same key arrives with a different request hash, return a conflict.

### 4.3 Progression and leveling tables

#### `ProgressionDefinition`

| Column | Type | Rules |
| --- | --- | --- |
| `id` | UUID | PK |
| `key` | `VARCHAR(64)` | unique, stable API key such as `main` or `elo` |
| `name` | `VARCHAR(100)` | display name |
| `kind` | enum | `LEVEL`, `RATING`, `BATTLE_PASS`, `SKILL`, `OTHER` |
| `active` | `BOOLEAN` | default true |
| `allowNegative` | `BOOLEAN` | normally false for main XP; policy decision for rating |
| `resetPolicy` | enum | `NEVER`, `SEASON`, `MANUAL` |
| `metadata` | `JSONB` | admin configuration, not client authority |
| `createdAt` / `updatedAt` | `TIMESTAMPTZ` | server-maintained |

#### `ProgressionTier`

| Column | Type | Rules |
| --- | --- | --- |
| `id` | UUID | PK |
| `progressionId` | UUID | FK, cascade |
| `step` | `INTEGER` | positive, unique within progression |
| `pointsThreshold` | `BIGINT` | non-negative; monotonic within progression |
| `name` | `VARCHAR(100)` | nullable |
| `metadata` | `JSONB` | optional display configuration |
| `createdAt` / `updatedAt` | `TIMESTAMPTZ` | server-maintained |

Unique constraint: `(progressionId, step)`. Index `(progressionId, pointsThreshold)`.

#### `ProgressionTierReward`

Use typed nullable foreign keys instead of an unvalidated arbitrary JSON reward.

| Column | Type | Rules |
| --- | --- | --- |
| `id` | UUID | PK |
| `tierId` | UUID | FK, cascade |
| `rewardType` | enum | `PROGRESSION_POINTS`, `PROGRESSION_RESET`, `CURRENCY`, `ASSET`, `ENTITLEMENT` |
| `targetProgressionId` | UUID NULL | for points/reset |
| `currencyId` | UUID NULL | for currency |
| `assetDefinitionId` | UUID NULL | for asset |
| `amount` | `BIGINT NULL` | integer reward quantity |
| `assetVariationId` | UUID NULL | optional variation |
| `assetRentalOptionId` | UUID NULL | optional rental |
| `sortOrder` | `INTEGER` | deterministic order |
| `createdAt` | `TIMESTAMPTZ` | server-maintained |

Add a database/application check that the target columns match `rewardType`.

#### `PlayerProgression`

| Column | Type | Rules |
| --- | --- | --- |
| `id` | UUID | PK |
| `userId` | UUID | FK `User`, cascade |
| `progressionId` | UUID | FK, cascade |
| `points` | `BIGINT` | authoritative current points |
| `step` | `INTEGER` | cached derived tier |
| `previousThreshold` | `BIGINT` | cached response field |
| `nextThreshold` | `BIGINT NULL` | null when maxed |
| `lastLevelUpAt` | `TIMESTAMPTZ NULL` | server time |
| `seasonId` | UUID NULL | required if progression is seasonal |
| `createdAt` / `updatedAt` | `TIMESTAMPTZ` | server-maintained |

Unique constraint: `(userId, progressionId, seasonId)` with a deliberate nullable-season strategy. Prefer a non-null `seasonId` for seasonal rows and a sentinel/current season for global progressions if PostgreSQL uniqueness semantics would otherwise be ambiguous.

#### `ProgressionEvent`

Append-only audit/ledger of point changes.

| Column | Type | Rules |
| --- | --- | --- |
| `id` | UUID | PK |
| `userId` | UUID | FK |
| `progressionId` | UUID | FK |
| `delta` | `BIGINT` | signed change |
| `balanceBefore` / `balanceAfter` | `BIGINT` | audit snapshot |
| `sourceType` | enum | `MATCH`, `AD`, `PURCHASE`, `ADMIN`, `SYSTEM` |
| `sourceId` | UUID/string | source command or internal reference |
| `idempotencyKeyId` | UUID NULL | FK |
| `metadata` | `JSONB` | safe calculation context, no secrets |
| `createdAt` | `TIMESTAMPTZ` | server time |

Unique source/idempotency rules must prevent the same reward event from being applied twice.

### 4.4 Economy tables

#### `CurrencyDefinition`

| Column | Type | Rules |
| --- | --- | --- |
| `id` | UUID | PK |
| `code` | `VARCHAR(32)` | uppercase unique, e.g. `MCN`, `GLD` |
| `name` | `VARCHAR(100)` | display name |
| `kind` | enum | `SOFT`, `HARD`, `PREMIUM`, `EVENT` |
| `precision` | `SMALLINT` | normally 0 for integer game currency |
| `active` | `BOOLEAN` | default true |
| `metadata` | `JSONB` | safe display/config fields |
| `createdAt` / `updatedAt` | `TIMESTAMPTZ` | server-maintained |

For MCN/GLD-style whole-unit currency, use `BIGINT` amounts and `precision = 0`. If fractional amounts are genuinely required, use fixed-point `NUMERIC(30, 6)` consistently; never use floating-point values.

#### `Wallet`

| Column | Type | Rules |
| --- | --- | --- |
| `id` | UUID | PK |
| `userId` | UUID | FK `User`, unique for player wallet |
| `walletType` | enum | `PLAYER`, `SYSTEM` |
| `status` | enum | `ACTIVE`, `LOCKED`, `CLOSED` |
| `createdAt` / `updatedAt` | `TIMESTAMPTZ` | server-maintained |

#### `WalletBalance`

| Column | Type | Rules |
| --- | --- | --- |
| `id` | UUID | PK |
| `walletId` | UUID | FK, cascade |
| `currencyId` | UUID | FK |
| `amount` | `BIGINT` | non-negative current balance |
| `version` | `BIGINT` | optimistic/concurrency diagnostic |
| `createdAt` / `updatedAt` | `TIMESTAMPTZ` | server-maintained |

Unique constraint: `(walletId, currencyId)`. Lock this row before debit/credit.

#### `WalletTransaction`

Append-only balance ledger.

| Column | Type | Rules |
| --- | --- | --- |
| `id` | UUID | PK |
| `walletId` | UUID | FK |
| `currencyId` | UUID | FK |
| `direction` | enum | `CREDIT`, `DEBIT`, `REVERSAL` |
| `amount` | `BIGINT` | positive magnitude |
| `balanceBefore` / `balanceAfter` | `BIGINT` | audit snapshot |
| `sourceType` | enum | `SIGNUP`, `MATCH`, `AD`, `PURCHASE`, `REFUND`, `ADMIN`, `SYSTEM` |
| `sourceId` | `VARCHAR(255)` | source reference |
| `idempotencyKeyId` | UUID NULL | FK |
| `metadata` | `JSONB` | calculation context |
| `createdAt` | `TIMESTAMPTZ` | immutable |

For a debit, lock the balance, verify sufficient funds, insert the ledger row, then update the balance in the same transaction. Never permit a negative balance unless a specifically documented currency policy allows it.

### 4.5 Leaderboard tables

#### `Leaderboard`

| Column | Type | Rules |
| --- | --- | --- |
| `id` | UUID | PK |
| `key` | `VARCHAR(80)` | unique stable key |
| `name` | `VARCHAR(120)` | display name |
| `memberType` | enum | `PLAYER`, `COUNTRY`, `GENERIC` |
| `period` | enum | `ALL_TIME`, `WEEKLY`, `MONTHLY`, `SEASONAL` |
| `direction` | enum | `DESCENDING`, `ASCENDING` |
| `writePolicy` | enum | `SERVER_ONLY`, `AUTHENTICATED_COMMAND` |
| `active` | `BOOLEAN` | default true |
| `metadata` | `JSONB` | display/config fields |
| `createdAt` / `updatedAt` | `TIMESTAMPTZ` | server-maintained |

#### `LeaderboardSeason`

| Column | Type | Rules |
| --- | --- | --- |
| `id` | UUID | PK |
| `leaderboardId` | UUID | FK |
| `startsAt` / `endsAt` | `TIMESTAMPTZ` | server-defined UTC boundaries |
| `status` | enum | `SCHEDULED`, `ACTIVE`, `CLOSED` |
| `resetAt` | `TIMESTAMPTZ NULL` | optional settlement time |
| `createdAt` | `TIMESTAMPTZ` | server-maintained |

Unique/partial rule: one active season per leaderboard.

#### `LeaderboardEntry`

| Column | Type | Rules |
| --- | --- | --- |
| `id` | UUID | PK |
| `leaderboardId` | UUID | FK |
| `seasonId` | UUID NULL | FK; required for periodic boards |
| `playerId` | UUID NULL | FK for player boards |
| `memberKey` | `VARCHAR(128)` | player UUID string, country code, or generic key |
| `score` | `BIGINT` | authoritative score |
| `metadata` | `JSONB` | server-generated safe metadata |
| `createdAt` / `updatedAt` | `TIMESTAMPTZ` | server-maintained |

Use a unique constraint on `(leaderboardId, seasonId, memberKey)`. For player boards, also enforce that `playerId` is present. For country boards, `memberKey` must be a normalized ISO country code and `playerId` must be null.

#### `LeaderboardScoreEvent`

Append-only score changes:

| Column | Type | Rules |
| --- | --- | --- |
| `id` | UUID | PK |
| `entryId` | UUID | FK |
| `delta` | `BIGINT` | signed change |
| `scoreBefore` / `scoreAfter` | `BIGINT` | audit snapshot |
| `sourceType` | enum | `MATCH`, `ADMIN`, `SYSTEM` |
| `sourceId` | `VARCHAR(255)` | source reference |
| `idempotencyKeyId` | UUID NULL | FK |
| `createdAt` | `TIMESTAMPTZ` | immutable |

Rank should be calculated in SQL over the selected season/board using the configured direction and deterministic tie-breaker. Do not store a mutable rank as the authority.

### 4.6 Match and secure result tables

These tables are required before moving reward calculations out of Flutter.

#### `GameDefinition`

| Column | Type | Rules |
| --- | --- | --- |
| `id` | UUID | PK |
| `key` | `VARCHAR(64)` | unique, e.g. `flick_master` |
| `name` | `VARCHAR(120)` | display name |
| `active` | `BOOLEAN` | server-controlled |
| `modePolicy` | `JSONB` | time/question/ranking constraints |
| `rewardPolicy` | `JSONB` | versioned policy reference, not client input |
| `createdAt` / `updatedAt` | `TIMESTAMPTZ` | server-maintained |

#### `Match`

| Column | Type | Rules |
| --- | --- | --- |
| `id` | UUID | PK |
| `gameDefinitionId` | UUID | FK |
| `mode` | enum | `SINGLE_PLAYER`, `BOT`, `RANKED`, `CASUAL` |
| `status` | enum | `CREATED`, `STARTED`, `FINISHED`, `CANCELLED`, `SETTLED` |
| `serverNonce` | `VARCHAR(128)` | opaque anti-replay value |
| `startedAt` / `endedAt` | `TIMESTAMPTZ NULL` | server time |
| `settledAt` | `TIMESTAMPTZ NULL` | reward settlement time |
| `createdByUserId` | UUID | FK |
| `metadata` | `JSONB` | non-sensitive match configuration |
| `createdAt` / `updatedAt` | `TIMESTAMPTZ` | server-maintained |

#### `MatchParticipant`

| Column | Type | Rules |
| --- | --- | --- |
| `id` | UUID | PK |
| `matchId` | UUID | FK |
| `userId` | UUID NULL | null for a bot if bots are modeled separately |
| `participantType` | enum | `PLAYER`, `BOT` |
| `finalScore` | `INTEGER NULL` | server-accepted final score |
| `answeredCount` | `INTEGER NULL` | server-accepted metric |
| `result` | enum | `PENDING`, `WIN`, `LOSS`, `DRAW`, `COMPLETED`, `FORFEIT` |
| `submittedAt` | `TIMESTAMPTZ NULL` | server time |
| `createdAt` / `updatedAt` | `TIMESTAMPTZ` | server-maintained |

Unique constraint: `(matchId, userId)` for players and a separate participant slot constraint. Never permit a client to update another participant's row.

#### `MatchSettlement`

| Column | Type | Rules |
| --- | --- | --- |
| `id` | UUID | PK |
| `matchId` | UUID | FK unique |
| `policyVersion` | `VARCHAR(32)` | exact reward policy used |
| `winnerParticipantId` | UUID NULL | FK |
| `settlementJson` | `JSONB` | server-generated result summary |
| `idempotencyKeyId` | UUID | FK/unique |
| `createdAt` | `TIMESTAMPTZ` | immutable |

The settlement row is the durable proof that a match was rewarded. A second completion request must return this row and perform no writes.

#### `MatchmakingTicket`

This replaces both Firebase queue collections. Do not store an active queue as a JSON blob or depend on Firebase TTL/onDisconnect behavior.

| Column | Type | Rules |
| --- | --- | --- |
| `id` | UUID | PK and public ticket identifier |
| `userId` | UUID | FK `User`; resolved from the access token |
| `gameDefinitionId` | UUID | FK; never accepted as an arbitrary client-owned game ID |
| `mode` | enum | `CASUAL`, `RANKED`, `FRIEND`, `BOT_FALLBACK` |
| `status` | enum | `SEARCHING`, `MATCHED`, `CANCELLED`, `EXPIRED` |
| `isRankingMatch` | `BOOLEAN` | server policy result |
| `rankingSeriesId` | UUID NULL | FK when the request is a multi-round ranking series |
| `levelSnapshot` | `INTEGER` | server snapshot at enqueue time |
| `eloSnapshot` | `BIGINT` | server snapshot at enqueue time |
| `countryCodeSnapshot` | `CHAR(2) NULL` | normalized profile snapshot |
| `constraints` | `JSONB` | bounded, validated matchmaking constraints |
| `createdAt` / `expiresAt` | `TIMESTAMPTZ` | PostgreSQL/server time |
| `lastHeartbeatAt` / `matchedAt` | `TIMESTAMPTZ NULL` | lease/audit fields |
| `matchId` | UUID NULL | FK after an atomic match claim |
| `idempotencyKeyId` | UUID NULL | FK for enqueue/retry safety |

Use a partial unique index so one user has at most one active ticket. Match selection must lock candidate tickets with `FOR UPDATE SKIP LOCKED`, verify expiry and heartbeat, then transition both tickets and create the match in one transaction.

#### `MatchRound` and `MatchEvent`

`MatchRound` makes the current ranking-match series explicit instead of storing an unbounded mutable map:

```text
id UUID, matchId UUID, roundIndex INTEGER, gameDefinitionId UUID,
status ENUM, challengeSeedHash CHAR(64), startedAt TIMESTAMPTZ NULL,
endedAt TIMESTAMPTZ NULL, createdAt TIMESTAMPTZ, updatedAt TIMESTAMPTZ
```

Unique `(matchId, roundIndex)`. A server-generated seed or assignment token may be returned to the client, but the answer key and reward policy remain server-only.

`MatchEvent` is append-only and replaces direct writes to Firebase `playerStates`:

| Column | Type | Rules |
| --- | --- | --- |
| `id` | UUID | PK |
| `matchId` / `participantId` | UUID | FKs |
| `sequence` | `INTEGER` | monotonic per participant, server-assigned/checked |
| `eventType` | enum | `READY`, `HEARTBEAT`, `ANSWER`, `SCORE_UPDATE`, `FINISH`, `LEAVE`, `FORFEIT` |
| `clientEventId` | `VARCHAR(128)` | unique per match/participant for retries |
| `payload` | `JSONB` | bounded normalized input, never trusted as final result |
| `clientOccurredAt` | `TIMESTAMPTZ NULL` | telemetry only |
| `serverReceivedAt` | `TIMESTAMPTZ` | authority timestamp |
| `accepted` | `BOOLEAN` | validation result |
| `rejectionReason` | `VARCHAR(120) NULL` | safe audit reason |

Unique `(matchId, participantId, clientEventId)` and `(matchId, participantId, sequence)`. Invalid events may be retained for abuse analysis but must not affect settlement.

#### `GameContentItem` and `MatchContentAssignment`

These replace active Firestore `questions` and the client-owned challenge lists.

```text
GameContentItem:
  id UUID, gameDefinitionId UUID, version INTEGER, contentType VARCHAR(40),
  prompt JSONB, options JSONB, difficulty SMALLINT, category VARCHAR(80) NULL,
  answerHash CHAR(64), answerPayload JSONB NULL, active BOOLEAN,
  createdAt TIMESTAMPTZ, updatedAt TIMESTAMPTZ

MatchContentAssignment:
  id UUID, matchId UUID, roundId UUID NULL, contentItemId UUID,
  position INTEGER, assignmentTokenHash CHAR(64), servedAt TIMESTAMPTZ,
  expiresAt TIMESTAMPTZ NULL, answeredAt TIMESTAMPTZ NULL, createdAt TIMESTAMPTZ
```

Keep the answer key out of mobile payloads. If a game uses deterministic challenge seeds, the seed is server-generated, signed/hashed, scoped to the match, and never accepted from Flutter as the source of the challenge.

#### `PlayerGameStats`

This replaces the public-storage keys updated by `GameStatsProvider` and gives each game a rebuildable projection.

```text
id UUID, userId UUID, gameDefinitionId UUID, gamesPlayed INTEGER,
wins INTEGER, losses INTEGER, draws INTEGER, forfeits INTEGER,
totalCorrect INTEGER, totalQuestions INTEGER, totalTimeMs BIGINT,
totalScore BIGINT, bestScore BIGINT, lastPlayedAt TIMESTAMPTZ NULL,
createdAt TIMESTAMPTZ, updatedAt TIMESTAMPTZ
```

Unique `(userId, gameDefinitionId)`. Accuracy and average time should be derived from these counters or stored as carefully defined projections, never accepted from the client. Update it only from settled results and provide a rebuild command from `MatchEvent`/`MatchSettlement`.

#### `RewardGrant` and `Redemption`

`RewardGrant` is the common audit record for match, progression, ad, purchase, admin, and signup rewards:

```text
id UUID, userId UUID, sourceType ENUM, sourceId VARCHAR(255),
rewardType ENUM, currencyId UUID NULL, amount BIGINT NULL,
assetDefinitionId UUID NULL, quantity INTEGER NULL,
progressionDefinitionId UUID NULL, idempotencyKeyId UUID NULL,
status ENUM, policyVersion VARCHAR(32) NULL, createdAt TIMESTAMPTZ
```

Add a unique `(sourceType, sourceId, rewardType)` rule where a source can grant a reward only once. Currency effects must also have a matching `WalletTransaction`.

`Redemption` replaces the separate LootLocker metadata flag and Firestore reward status:

```text
id UUID, userId UUID, inventoryItemId UUID, status ENUM,
redeemedAt TIMESTAMPTZ NULL, idempotencyKeyId UUID UNIQUE,
metadata JSONB, createdAt TIMESTAMPTZ, updatedAt TIMESTAMPTZ
```

Redeem by inventory UUID and ownership, not by “newest inventory item” or a client-supplied legacy instance ID.

#### `AdImpression` and `AdRewardClaim`

The current `AdRewardService` trusts client-reported impression data, eCPM, and sometimes a client-provided region before crediting GLD. The replacement must require a provider-verifiable token/event or a server-issued nonce.

```text
AdImpression:
  id UUID, userId UUID, provider VARCHAR(40), adUnitKey VARCHAR(120),
  providerEventId VARCHAR(255) NULL, verificationTokenHash CHAR(64) NULL,
  observedAt TIMESTAMPTZ, verifiedAt TIMESTAMPTZ NULL, status ENUM,
  createdAt TIMESTAMPTZ

AdRewardClaim:
  id UUID, impressionId UUID, userId UUID, currencyId UUID,
  rewardAmount BIGINT, ecpmSnapshot NUMERIC(20,8) NULL,
  multiplierSnapshot NUMERIC(20,8) NULL, regionSnapshot CHAR(2) NULL,
  policyVersion VARCHAR(32), status ENUM, idempotencyKeyId UUID UNIQUE,
  rejectionReason VARCHAR(160) NULL, createdAt TIMESTAMPTZ, rewardedAt TIMESTAMPTZ NULL
```

Unique provider event/transaction IDs, per-user daily caps, cooldowns, replay detection, and rate limits are mandatory. Never accept `valueMicros`, eCPM, region, currency amount, or “ad watched” as proof from Flutter. The wallet credit and `RewardGrant` must commit together.

#### `GameConfig` and `RewardPolicyVersion`

Replace Firebase Remote Config for security-sensitive settings with versioned, audited server records. Store typed critical values (currency codes, reward amounts, multipliers, match durations, available games, app maintenance/version gates) in columns where practical and bounded JSON only for non-sensitive game options. Every settlement/ad claim stores the exact policy version/checksum used. Public config endpoints may expose display-safe values, but never answer keys, reward authority, ad verification rules, or admin secrets.

### 4.7 Catalog, inventory, entitlement, and purchase tables

#### `AssetDefinition`

Fields: `id UUID`, stable `key VARCHAR(100) UNIQUE`, `name VARCHAR(120)`, `description TEXT NULL`, `assetType ENUM`, `active BOOLEAN`, `metadata JSONB`, timestamps.

#### `AssetVariation`

Fields: `id UUID`, `assetDefinitionId UUID`, `key VARCHAR(100)`, `metadata JSONB`, `active BOOLEAN`, timestamps. Unique `(assetDefinitionId, key)`.

#### `CatalogItem`

Fields: `id UUID`, `key VARCHAR(100) UNIQUE`, `name VARCHAR(120)`, `description TEXT NULL`, `active BOOLEAN`, `startsAt TIMESTAMPTZ NULL`, `endsAt TIMESTAMPTZ NULL`, `metadata JSONB`, timestamps.

#### `CatalogPrice`

Fields: `id UUID`, `catalogItemId UUID`, `currencyId UUID`, `amount BIGINT`, `active BOOLEAN`, timestamps. Unique `(catalogItemId, currencyId)` while active. The price must be copied into a purchase line as a snapshot.

#### `CatalogReward`

Fields: `id UUID`, `catalogItemId UUID`, `rewardType`, nullable target foreign key, `amount BIGINT NULL`, `quantity INTEGER`, `sortOrder INTEGER`, timestamps. Use the same typed reward approach as progression tier rewards.

#### `InventoryItem`

Fields: `id UUID`, `userId UUID`, `assetDefinitionId UUID`, `assetVariationId UUID NULL`, `quantity INTEGER`, `acquisitionSource ENUM`, `sourceId VARCHAR(255) NULL`, `rentalExpiresAt TIMESTAMPTZ NULL`, `metadata JSONB`, timestamps.

Unique policy depends on the item: stackable items use `(userId, assetDefinitionId, assetVariationId)`; unique instance items need an instance row and quantity 1. Do not silently merge unique assets.

#### `Purchase`

Fields: `id UUID`, `userId UUID`, `status ENUM` (`PENDING`, `COMPLETED`, `FAILED`, `REFUNDED`), `currencyId UUID`, `totalAmount BIGINT`, `idempotencyKeyId UUID UNIQUE`, `provider VARCHAR(40) NULL`, `providerReference VARCHAR(255) NULL`, `completedAt TIMESTAMPTZ NULL`, timestamps.

#### `PurchaseLine`

Fields: `id UUID`, `purchaseId UUID`, `catalogItemId UUID`, `itemKeySnapshot VARCHAR(100)`, `quantity INTEGER`, `unitAmount BIGINT`, `totalAmount BIGINT`, `rewardSnapshot JSONB`, timestamps.

Purchase transaction sequence:

```text
lock catalog item and current prices
validate active dates and quantity
calculate total from server price
lock wallet balance
insert purchase and price/reward snapshots
debit wallet ledger
grant inventory/entitlements/progression/currency rewards
mark purchase completed
write outbox event
```

### 4.8 Player storage, metadata, files, and feedback

#### `PlayerStorageEntry`

Fields: `id UUID`, `userId UUID`, `key VARCHAR(100)`, `value TEXT`, `visibility ENUM` (`PRIVATE`, `PUBLIC`), `valueType ENUM` (`STRING`, `JSON`, `DATE`, `URL`), `updatedAt TIMESTAMPTZ`, `createdAt TIMESTAMPTZ`.

Unique `(userId, key)`. Whitelist public keys; do not let the mobile client mark arbitrary sensitive data public.

#### `PlayerFile`

Fields: `id UUID`, `userId UUID`, `purpose ENUM/string`, `objectKey VARCHAR(512)`, `contentType VARCHAR(120)`, `byteSize BIGINT`, `checksum CHAR(64)`, `visibility`, `status`, timestamps. Store the file in S3-compatible storage and only its durable reference in PostgreSQL. Upload/delete must use an outbox or compensation strategy; never hold a DB transaction open during file transfer.

#### `MetadataEntry`

Use only if generic metadata is truly needed. Fields: `id UUID`, `ownerType`, `ownerId UUID`, `key VARCHAR(100)`, `value JSONB`, `readPolicy`, timestamps. Define an allowlist of owner types and keys in code. Do not reproduce LootLocker's unrestricted metadata surface.

#### `FeedbackCategory` and `Feedback`

Categories: `id UUID`, `key`, `name`, `entityType`, `active`, timestamps. Feedback: `id UUID`, `userId UUID`, `categoryId UUID`, `entityType`, `entityId UUID NULL`, `description VARCHAR(5000)`, `status`, timestamps. Rate-limit submission and never trust a client-provided administrator status.

### 4.9 Social, presence, and outbox tables

#### `Friendship`

Fields: `id UUID`, `userAId UUID`, `userBId UUID`, `status ENUM` (`PENDING`, `ACCEPTED`, `DECLINED`, `BLOCKED`), `requestedByUserId UUID`, `respondedAt TIMESTAMPTZ NULL`, timestamps. Normalize the pair so `(min(userAId,userBId), max(userAId,userBId))` is unique.

#### `Presence`

Fields: `userId UUID UNIQUE`, `state ENUM` (`ONLINE`, `IDLE`, `OFFLINE`), `lastSeenAt TIMESTAMPTZ`, `connectionId VARCHAR(255) NULL`, `updatedAt TIMESTAMPTZ`. Presence is ephemeral and should have TTL/cleanup behavior; it is not a permanent gameplay audit.

#### `OutboxEvent`

Fields: `id UUID`, `eventType VARCHAR(120)`, `aggregateType`, `aggregateId UUID`, `payload JSONB`, `status ENUM` (`PENDING`, `PROCESSING`, `PUBLISHED`, `FAILED`), `attempts INTEGER`, `availableAt TIMESTAMPTZ`, `processedAt TIMESTAMPTZ NULL`, `lastError TEXT NULL`, timestamps. Insert it in the originating transaction and process it after commit with a bounded worker.

## 5. Backend API contract

Use the existing API prefix/version convention once introduced. The following is the intended mobile contract; exact response DTO names may vary, but fields and authority must remain equivalent.

### 5.1 Authentication and profile

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/auth/register` | create identity, profile, stats, wallet, session |
| `POST` | `/auth/login` | authenticate by username/email and issue token pair |
| `POST` | `/auth/refresh` | rotate refresh token and issue pair |
| `POST` | `/auth/logout` | terminate current session |
| `POST` | `/auth/logout-all` | terminate all sessions |
| `GET` | `/auth/me` | identity and current status |
| `GET` | `/players/me` | profile, progressions, stats, safe wallet summary |
| `PATCH` | `/players/me` | profile-only fields: display name, avatar URL, country, bio |
| `GET` | `/players/:userId` | public profile only |

Use the current starter's JWT access/refresh/session design. Mobile should send `Authorization: Bearer <accessToken>` and store tokens securely. Do not carry over `x-session-token`, domain keys, game keys, or LootLocker API keys.

### 5.2 Progression

| Method | Route | Purpose | Write authority |
| --- | --- | --- | --- |
| `GET` | `/progressions` | list active definitions | public/authenticated read policy |
| `GET` | `/progressions/:key/tiers` | paginated tier/reward definitions | authenticated read |
| `GET` | `/players/me/progressions` | all current player progressions | authenticated read |
| `GET` | `/players/me/progressions/:key` | one progression | authenticated read |
| `POST` | `/players/me/progressions/:key/claim` | only if a separate claim mechanic exists | server validation + idempotency |

There must be no public mobile endpoint equivalent to arbitrary `add points`, `subtract points`, or `reset progression`. Those operations are internal service commands invoked by match settlement, purchase settlement, an approved ad-reward verifier, or a protected system-admin action.

### 5.3 Economy

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/wallet` | current user's safe balances |
| `GET` | `/wallet/transactions` | paginated own ledger history, sanitized |
| `POST` | `/wallet/claims/ad` | submit a one-time ad reward claim token |
| `GET` | `/currencies` | active public currency definitions |

No mobile route accepts arbitrary `walletId`, `currencyId`, or credit amount from the client. The authenticated user is resolved from the access token, and the server selects the wallet/currency/policy.

### 5.4A Matchmaking and game content

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/matchmaking/queue` | enqueue the authenticated player using a server-resolved game/mode/policy |
| `GET` | `/matchmaking/status` | return the current ticket and matched state |
| `POST` | `/matchmaking/tickets/:ticketId/heartbeat` | renew a server-owned queue lease |
| `DELETE` | `/matchmaking/tickets/:ticketId` | cancel the authenticated player's ticket |
| `POST` | `/matchmaking/friend-invites` | create an authenticated friend invite |
| `POST` | `/matchmaking/friend-invites/:inviteId/accept` | atomically join/create the friend match |
| `GET` | `/matches/:matchId` | return authorized match state and round summary |
| `POST` | `/matches/:matchId/events` | submit a bounded gameplay event with sequence and idempotency |
| `POST` | `/matches/:matchId/complete` | request server validation and settlement |
| `GET` | `/matches/:matchId/settlement` | retrieve the committed one-time settlement |
| `GET` | `/game-definitions` | list safe active game definitions |
| `GET` | `/game-definitions/:key/content` | return server-assigned, safe content/assignment data |
| `GET` | `/players/me/game-stats` | return rebuildable per-game statistics |

The queue request may contain only game key, mode, ranking intent, friend invite data, client version, and bounded preferences. The server resolves the user, level, ELO, country, game policy, queue ID, expiry, challenge assignment, and bot fallback. It must not accept `playerId`, `playerName`, `playerLevel`, `playerElo`, question lists, final scores, or opponent state as authoritative input.

### 5.4 Leaderboards

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/leaderboards` | list active board definitions |
| `GET` | `/leaderboards/:key` | paginated entries for current season/period |
| `GET` | `/leaderboards/:key/me` | current user's score/rank |
| `POST` | `/leaderboards/:key/members` | selected public members, bounded list |
| `GET` | `/leaderboards/:key/details` | period and renewal details |

There is no client `increment` or `submit arbitrary score` route. The only score writer is the trusted match settlement/admin correction path.

### 5.5 Matches and reward settlement

The minimum secure command contract is:

```http
POST /matches
POST /matches/:matchId/events
POST /matches/:matchId/complete
GET  /matches/:matchId
```

The exact event model depends on whether the game can be server-authoritative. The completion request may include client-observed score data, but the server must validate it against a trusted match state, allowed time/question bounds, participant identity, and a one-time settlement key. If the server cannot verify a score, the safe policy is to withhold competitive rewards and place the match in review—not to accept the client number.

### 5.6 Rewards and inventory

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/catalog` | active listings and server prices |
| `GET` | `/inventory` | current user's items, paginated |
| `POST` | `/purchases` | purchase using server-side price and wallet |
| `GET` | `/purchases/:id` | purchase result |
| `POST` | `/inventory/:id/use` | optional item use command |
| `POST` | `/inventory/:id/redeem` | idempotently redeem an owned item through `Redemption` |
| `POST` | `/ad-rewards/claims` | submit a provider-verifiable ad impression token/nonce |

Never expose legacy provider IDs as authority. Return Railway UUIDs or stable public keys created by the new catalog/inventory domain.

### 5.7 Storage, friends, presence, and feedback

Add only when each domain has an explicit privacy and abuse policy:

```text
GET/PATCH /players/me/storage                 private allowlisted key/value data
POST/DELETE /players/me/files                 controlled profile files
GET/POST/PATCH /friends                       requests and friendship state
GET /players/:id/presence                     coarse public presence only
GET /feedback/categories/:entity
POST /feedback
```

## 6. Phased implementation plan

Every phase must finish its Prisma schema migration, transaction classes, DTOs, focused tests, mobile contract notes, seed/bootstrap checklist, and rollback/observability checklist before the next phase begins.

### Phase 0 — Greenfield foundation and old-client contract inventory

**Goal:** Start with an empty Railway database while preserving the useful SMARTS behavior as a compatibility reference. No user or gameplay data is imported.

Tasks:

1. Create a behavior inventory from all `smarts/lib/infrastructure/lootlocker`, Firebase, and game-provider files. This documents the old mobile contract only; it is not an import specification.
2. Record every configured key from `ConfigService`: main/ELO progression keys, currency codes, leaderboard keys, catalog key, reward multipliers, ranking-match settings, and ad multipliers.
3. Convert old provider IDs/keys into new stable Railway keys and UUID relationships. Do not create legacy-ID columns or import mappings in the new schema.
4. Record game types and each provider's finish/reward path.
5. Inventory Firebase Realtime Database/Firestore matchmaking, `matches`, `friend_matches`, questions, public game-stat keys, `rewards`, Remote Config, Cloud Functions, and Messaging usage.
6. Mark NestJS as the required final authority for each LootLocker/Firebase surface. There is no dual-write, fallback, shadow-read, or legacy rollback path for user data.
7. Define the clean-install seed set: game definitions, content, progression tiers, currencies, catalog, reward policies, leaderboard definitions, admin bootstrap, and safe public config.
8. Freeze new LootLocker/Firebase feature work. All new policy changes must be represented in Railway configuration/database tables.

Deliverables:

- signed behavior/contract inventory;
- greenfield seed and bootstrap specification;
- reward-policy version table;
- sanitized API contract fixtures;
- fresh-database reset and deployment checklist.

### Phase 1 — Stabilize UUID authentication, sessions, and profile

**Goal:** Railway is the identity authority from the first account; there is no imported user population.

Tasks:

1. Verify the UUID schema and all foreign keys on a fresh PostgreSQL database.
2. Keep registration atomic: `User`, `PlayerProfile`, `PlayerStats`, `Wallet`, and default balances must be created through one composed transaction.
3. Normalize email and username consistently on read and write.
4. Finish access/refresh token rotation and session revocation.
5. Ensure inactive/banned users cannot authenticate or use an existing token.
6. Add `ExternalIdentity` only for deliberately supported new providers such as Google or Apple; never accept LootLocker/Firebase identity subjects.
7. Keep `/players/me` compatible with the current Flutter model while marking level/XP/ELO as backend-owned projections initialized at registration.
8. Update the system-admin bootstrap to use the same transaction-safe user creation path and to terminate sessions on status change.

Transaction classes:

```text
auth/transactions/register-user-transaction.ts
auth/transactions/link-external-identity-transaction.ts
admin/access/sessions/transactions/create-session-transaction.ts
admin/access/sessions/transactions/rotate-session-transaction.ts
admin/access/sessions/transactions/terminate-session-transaction.ts
players/transactions/update-profile-transaction.ts
```

Exit criteria:

- a new user has all required rows or none;
- a refresh token can be used once only;
- banned/inactive users receive no valid authenticated response;
- Flutter can sign in, refresh, load `/auth/me`, and load `/players/me` without LootLocker.

### Phase 2 — Progression definitions, leveling, and reward grants

**Goal:** Replace LootLocker progressions with backend-owned progression state.

Tasks:

1. Add progression definitions and tiers for the current main and ELO keys.
2. Seed the approved thresholds and tier rewards from the SMARTS behavior inventory. Do not import player progression rows; every new player starts from the defined initial tier/points.
3. Implement `GetPlayerProgression` and `GetProgressionTiers` query services with bounded pagination.
4. Implement `AwardProgressionPointsTransaction`:
   - validate source and idempotency key;
   - lock `PlayerProgression`;
   - calculate before/after points;
   - clamp or reject negative values by progression policy;
   - determine every crossed tier;
   - insert one `ProgressionEvent`;
   - insert one grant per crossed reward;
   - update cached step/threshold fields;
   - update compatibility fields on `PlayerProfile` only if still needed.
5. Implement reset as a protected internal command. A reset must create an auditable event and never silently erase history.
6. Return a result like:

```json
{
  "progression": {
    "key": "main",
    "points": "1250",
    "step": 3,
    "previousThreshold": "1000",
    "nextThreshold": "2000"
  },
  "delta": "250",
  "crossedTiers": [2, 3],
  "rewardsGranted": []
}
```

7. Remove mobile calls to arbitrary add/subtract points. The mobile client calls match settlement or a specific approved claim endpoint.
8. Replace local-only level-up detection with the server's `crossedTiers`/`rewardsGranted` response and a display-only local acknowledgement.

Transaction classes:

```text
progression/transactions/create-progression-transaction.ts
progression/transactions/update-progression-tier-transaction.ts
progression/transactions/award-progression-points-transaction.ts
progression/transactions/reset-player-progression-transaction.ts
```

Exit criteria:

- concurrent awards cannot lose points;
- retrying the same award does not duplicate XP or tier rewards;
- a player can cross multiple tiers in one award and receive each reward once;
- player-facing values match the approved SMARTS contract fixtures from a clean database.

### Phase 3 — Wallets, currencies, and immutable economy ledger

**Goal:** Replace LootLocker wallet/balance calls with atomic Railway economy operations.

Tasks:

1. Create MCN/GLD (or the approved final codes) in `CurrencyDefinition`.
2. Create one player wallet and one zero/default balance row per required currency during registration.
3. Implement `GetWalletForUser` and `ListWalletBalances` read services.
4. Implement reusable transaction components:
   - `CreditWalletTransaction`;
   - `DebitWalletTransaction`;
   - `TransferWalletTransaction` if needed;
   - `ReverseWalletTransaction` for refunds/corrections;
5. Make credit/debit transaction classes composable so match settlement and purchases can call them with `runWithinTransaction`.
6. Use BigInt/fixed-point semantics end to end. JSON responses must use strings.
7. Add a unique idempotency source to every reward/debit.
8. Add reconciliation queries: every balance equals the sum of its immutable ledger effects. There is no opening migration balance because the database starts empty.
9. Move starting signup credit out of Flutter and into registration. Decide the exact amount in a versioned server policy and seed it before enabling registration.

Exit criteria:

- two concurrent debits cannot overspend;
- a repeated match/ad reward cannot credit twice;
- every balance has an inspectable ledger trail beginning at zero or the approved signup grant;
- mobile only reads balances and submits approved claims/purchases.

### Phase 4 — Leaderboards and seasons

**Goal:** Replace the four configured boards and make score writes server-only.

Tasks:

1. Create board definitions for player/country × weekly/monthly.
2. Create UTC season boundaries and a scheduled season close/reset process.
3. Implement paginated list, details, selected-members, and current-user-rank queries.
4. Implement `ApplyLeaderboardScoreTransaction` with row locking/upsert and a `LeaderboardScoreEvent`.
5. Use a stable member mapping:
   - player board: `memberKey = user.id`, `playerId = user.id`;
   - country board: normalized ISO country code, `playerId = null`.
6. Define tie behavior explicitly: score direction, rank formula, and deterministic secondary order.
7. Recreate current behavior only after confirming policy: player boards receive eligible match score/ELO increments; country boards receive the winner-country contribution only when the game policy allows it.
8. Remove mobile `incrementScore`, `submitScore`, and “read current score then submit current + increment” logic. That pattern is race-prone and cannot be trusted.
9. Add a rebuild command that can recreate entries from score events and settled matches.

Transaction classes:

```text
leaderboards/transactions/apply-score-transaction.ts
leaderboards/transactions/close-season-transaction.ts
```

Exit criteria:

- a leaderboard read matches the approved clean-install fixture;
- duplicate settlement produces one score event;
- rank is correct for ties and both ascending/descending policies;
- a closed weekly/monthly board cannot receive late writes.

### Phase 5 — Server-authoritative game results and reward orchestration

**Goal:** Move insecure result/reward logic out of Flutter.

The current Flutter providers perform important decisions locally, including score-derived XP, ELO changes, currency rewards, winner selection, and leaderboard updates. This is the highest-security phase.

Tasks:

1. Add `GameDefinition`, `Match`, `MatchParticipant`, and `MatchSettlement`.
2. Define how each game proves a result:
   - server-issued question/challenge IDs and answer timestamps;
   - signed match nonce;
   - server-accepted event stream; or
   - a conservative result-review state when verification is impossible.
3. Port reward policy into versioned backend code/config. Record the exact policy version in settlement.
4. Reconcile the current observed formulas before implementation. Examples found in the client include:
   - XP approximately `score × score_multiplier_for_xp`;
   - multiplayer ELO delta derived from score difference and clamped to `[-500, 500]`;
   - solo/bot ELO points derived from score divided by 100 and clamped to `[0, 200]`;
   - winner currency often based on a configured base plus a score-derived bounded amount;
   - separate ranked-match and regional multipliers.
5. Do not copy those formulas blindly. Confirm the desired product policy, then test boundary values, forfeits, ties, duplicate finishes, bot matches, and incomplete matches.
6. Implement `SettleMatchTransaction` as one transaction:

```text
lock match and participants
verify match status and idempotency
validate accepted scores/result
calculate winner/result and policy version
update PlayerStats projection
update authoritative rating/progression
write progression events
write wallet ledger effects
write leaderboard score events
insert MatchSettlement
insert OutboxEvent for notifications/analytics
mark match SETTLED
```

7. Return one settlement response containing all changed progression, wallet, stats, rating, leaderboard, and reward data needed by the result screen.
8. Move `FirebaseGameRepository`/`FirebaseMathGameRepository` answer validation and scoring into the server-authoritative content/event path. Move `GameStatsProvider` counters out of public storage and update `PlayerGameStats` only from settlement.
9. Update Flutter so a result screen displays the response rather than independently calling LootLocker, Firebase, wallet, progression, stats, and leaderboard services.

Transaction classes:

```text
matches/transactions/create-match-transaction.ts
matches/transactions/record-match-event-transaction.ts
matches/transactions/complete-match-transaction.ts
matches/transactions/settle-match-transaction.ts
```

Exit criteria:

- a client cannot award itself arbitrary XP, currency, ELO, or score;
- one match can be settled once, even after retries or simultaneous finish requests;
- a partial failure rolls back all related writes;
- settlement can be replayed/reconciled from durable event rows.

### Phase 6 — Catalog, inventory, purchases, and entitlements

**Goal:** Create the catalog/assets/purchase flows natively in Railway; there are no legacy inventory or purchase rows to import.

Tasks:

1. Seed asset definitions, variations, catalog listings, prices, and reward bundles from the approved SMARTS catalog design.
2. Use new stable catalog/item keys and UUIDs. There are no existing inventory items or LootLocker instance-ID mappings.
3. Implement catalog read endpoints with active-date and currency filtering.
4. Implement inventory reads with bounded pagination and safe item fields.
5. Implement the atomic purchase transaction described in the schema section.
6. Decide stackable versus unique-asset behavior before the first purchase and encode it in the asset definition.
7. Add grant/revoke transactions for protected system-admin and progression-reward flows.
8. Add purchase reconciliation checks and immutable price/reward snapshots from the first transaction.
9. If App Store/Google Play purchases are used, verify receipts on the backend and make provider transaction IDs unique. Never accept “purchase succeeded” from Flutter alone.

Transaction classes:

```text
rewards/catalog/transactions/create-catalog-item-transaction.ts
rewards/inventory/transactions/grant-inventory-item-transaction.ts
rewards/inventory/transactions/revoke-inventory-item-transaction.ts
rewards/purchases/transactions/create-purchase-transaction.ts
rewards/purchases/transactions/redeem-store-purchase-transaction.ts
```

Exit criteria:

- catalog price cannot be changed by request payload;
- insufficient currency cannot produce an item;
- repeated purchase/provider callback does not duplicate grants;
- a fresh catalog and empty inventory pass integrity checks before the first purchase.

### Phase 7 — Player storage, public profile data, files, metadata, and feedback

**Goal:** Replace the storage/file/metadata surfaces without reproducing unsafe arbitrary key/value writes.

Tasks:

1. Define approved player fields such as country, profile URL, and last-seen metadata. There are no existing player-storage rows to migrate.
2. Replace generic storage updates with allowlisted DTOs (`UpdatePlayerProfile`, `UpdatePresence`, etc.) where possible.
3. Add private/public visibility policy and strip private keys from public queries.
4. Integrate object storage for profile files using signed upload/download URLs.
5. Add file type, size, checksum, ownership, and deletion checks.
6. Define metadata only for known entity types and keys; do not create a legacy metadata importer.
7. Add feedback category and submission endpoints with rate limiting.

Exit criteria:

- one player cannot read or alter another player's private storage;
- file deletion cannot delete another user's object;
- public profile responses contain no password, session, wallet, private metadata, or moderation-only fields.

### Phase 8 — Friends and presence

**Goal:** Replace LootLocker friends and public last-seen lookups.

Tasks:

1. Implement normalized friend requests and accepted relationships.
2. Add transactions for request, accept, decline, cancel, block, and remove.
3. Add duplicate/cycle/self-request constraints.
4. Add paginated friend and player lookup queries with privacy rules.
5. Move online state to `Presence` and server heartbeats/WebSocket or bounded polling.
6. Do not use a public player-storage key as the authority for presence.
7. If friend leaderboards are needed, query leaderboard entries by selected player UUIDs through a safe read service.

### Phase 9 — NestJS matchmaking, Firebase game-state replacement, and content authority

**Goal:** Replace Firebase RTDB/Firestore matchmaking, friend matchmaking, match state, question data, and game statistics with PostgreSQL-backed NestJS domains. This phase is required; it is not a conditional future option.

#### 9.1 Queue and match lifecycle

Tasks:

1. Implement `MatchmakingTicket` with one active ticket per user, server-owned expiry, heartbeat lease, cancellation, and a bounded queue policy.
2. Implement `EnqueuePlayerTransaction`, `HeartbeatMatchmakingTicketTransaction`, `CancelMatchmakingTicketTransaction`, and `ExpireMatchmakingTicketsTransaction`.
3. Run a matcher worker with PostgreSQL row locks/`SKIP LOCKED` and advisory-lock protection. Pair tickets and create `Match`, `MatchParticipant`, and any `MatchRound` rows atomically.
4. Replace the Firebase 20/30-second queue TTL and `onDisconnect` behavior with explicit server expiry plus a heartbeat timeout. Never use a mobile timestamp as the expiry authority.
5. Implement friend invite, accept, decline, and removal with the same relational transaction rules. `friend_matches` is not a second storage system.
6. Resolve level, ELO, country, game type, ranking eligibility, duration, and challenge configuration on the server. The client sends intent, not a player snapshot.
7. Implement server-side bot fallback. A bot is a backend participant/policy result; `BotGameplayService` must not settle rewards locally in Flutter.
8. Implement match status transitions (`CREATED`, `STARTED`, `FINISHED`, `CANCELLED`, `SETTLED`), countdown, heartbeat, leave, forfeit, and abandonment transactions.
9. Expose authorized match reads through HTTP plus WebSocket/SSE or bounded polling. Firebase snapshots are not part of the final contract.

Transaction classes:

```text
matchmaking/transactions/enqueue-player-transaction.ts
matchmaking/transactions/heartbeat-ticket-transaction.ts
matchmaking/transactions/cancel-ticket-transaction.ts
matchmaking/transactions/claim-matchmaking-pair-transaction.ts
matchmaking/transactions/create-friend-invite-transaction.ts
matchmaking/transactions/accept-friend-invite-transaction.ts
matches/transactions/start-match-transaction.ts
matches/transactions/record-match-event-transaction.ts
matches/transactions/forfeit-match-transaction.ts
matches/transactions/expire-match-transaction.ts
```

#### 9.2 Server game content and event validation

1. Seed the approved game content as versioned `GameContentItem` rows. There are no existing Firestore question rows to import; preserve the SMARTS behavior as a content-authoring reference only.
2. Replace unbounded client loading/shuffling with server-selected, bounded `MatchContentAssignment` rows. Keep correct answers and scoring parameters private.
3. Issue a match nonce and assignment token. Validate participant ownership, match/round status, assignment position, sequence, timing, replay, and answer shape for every event.
4. Port the observed game-specific formulas only after product approval: trivia/flick/follow-the-lead time windows, math scoring, difficulty points, wrong-answer penalties, ranking-series multipliers, and winner/loser rules.
5. Store accepted events append-only. Mutable participant summaries are projections, not client-write targets.
6. Move `PlayerGameStats` updates into settlement and provide a rebuild from accepted events and settlements.
7. Return review/withhold status for games that cannot be verified. Never compensate for weak verification by trusting a Flutter final score.

Exit criteria:

- no RTDB/Firestore queue or match writes remain;
- the same ticket cannot be matched twice;
- friend and bot matches use the same server lifecycle;
- an invalid/replayed event has no scoring effect;
- active game content and stats are served by NestJS;
- no client can submit a final score, answer key, opponent state, or game-stat total as authority.

### Phase 9B — Firebase reward, Remote Config, ad-reward, and notification replacement

**Goal:** Remove Firebase from every reward/configuration path that can change player value or purchase state.

Tasks:

1. Seed and approve the initial `game_config`, `game_rewards`, `ranking_match`, currency, leaderboard, maintenance/version, ad-provider, regional multiplier, and eCPM policies into versioned Railway records.
2. Add `GameConfig`/`RewardPolicyVersion` read services and admin-only mutation transactions. Safe mobile config is a projection; critical reward values are never a client authority.
3. Replace the Firestore `rewards` collection with the purchase/inventory/redemption schema. Purchase, price snapshot, wallet debit, item grant, `RewardGrant`, and outbox event commit atomically.
4. Replace `notifyAdminPurchaseHttp` with an `OutboxEvent` emitted by the purchase transaction and delivered by a NestJS worker after commit. Notification failure must not roll back a completed purchase.
5. Replace `AdRewardService.creditWalletForAdImpression` with server/provider verification, unique provider event IDs, server-side region/policy selection, daily caps, cooldowns, replay detection, and `AdRewardClaim` plus wallet ledger transaction.
6. Remove client reads of eCPM, reward multipliers, and reward amounts. Public ad unit identifiers may remain in mobile configuration, but reward policy and verification rules must not.
7. Ensure every match, progression, purchase, admin, signup, and ad reward produces one `RewardGrant` with an idempotency/source constraint.
8. Remove Firebase Remote Config and Cloud Function calls from the final mobile/backend build. If push notifications temporarily use FCM, document it as delivery-only and keep all durable notification state in `OutboxEvent`/`Notification`.

Transaction classes:

```text
config/transactions/publish-reward-policy-transaction.ts
rewards/purchases/transactions/create-purchase-transaction.ts
rewards/inventory/transactions/redeem-inventory-item-transaction.ts
ad-rewards/transactions/verify-ad-impression-transaction.ts
ad-rewards/transactions/claim-ad-reward-transaction.ts
notifications/transactions/create-notification-outbox-transaction.ts
```

Exit criteria:

- no Firestore `rewards` writes or Firebase Cloud Function reward/purchase calls remain;
- Remote Config is no longer required to calculate rewards, maintenance, versions, or currencies;
- an ad callback can be replayed without a second credit;
- all purchase/reward effects are visible in Railway ledger/grant/audit rows;
- a notification outage cannot create or destroy a reward;
- zero Firebase reads/writes remain in the authoritative game backend.

### Phase 10 — System administrator console and operations

**Goal:** Give system administrators safe visibility and controlled correction tools.

The current starter already serves a `/system-admin` page and has status/list/delete/register flows. Extend it after the underlying domains exist.

Admin views should include:

- users and account status;
- active sessions;
- player profile/progression summary;
- wallet balances and immutable ledger;
- inventory and purchase history;
- match settlement history;
- leaderboard entries and season status;
- transaction, settlement, seed, and reconciliation failures;
- outbox/job health.

Admin commands must use their own transaction classes and audit actor identity:

```text
system-admin/transactions/update-user-status-transaction.ts
system-admin/transactions/delete-user-transaction.ts
system-admin/transactions/adjust-wallet-transaction.ts
system-admin/transactions/adjust-progression-transaction.ts
system-admin/transactions/rebuild-player-projections-transaction.ts
system-admin/transactions/close-leaderboard-season-transaction.ts
```

Rules:

- no direct SQL editing in the UI;
- no deleting the last active system administrator;
- ban/inactivate terminates active sessions in the same transaction;
- every correction requires a reason and writes an audit/outbox event;
- sensitive token hashes, password hashes, and provider secrets never appear in the UI.

### Phase 11 — Greenfield launch and removal of legacy providers

**Goal:** Deploy a clean Railway database and launch the Flutter client with NestJS as the only game backend. There are zero existing users, so this phase performs no user import, data export, shadow comparison, delta import, or legacy cutover.

#### 11.1 Fresh database bootstrap order

Run migrations and seed only static/system data in dependency order:

```text
database extensions and enums
game definitions and versioned game content
progression definitions, tiers, and tier rewards
currency definitions and approved reward policies
catalog items, prices, assets, and catalog rewards
leaderboard definitions and initial UTC season rows
feedback categories and safe public configuration
system-admin bootstrap account through the normal registration transaction
```

Do not seed player users, wallets, balances, inventory, progression rows, stats, matches, friendships, purchases, or leaderboard entries. Those rows are created by normal NestJS commands after launch. A new registration creates the user-owned rows atomically; all initial balances and progression points come from explicit server policy.

#### 11.2 Clean-install verification

Before opening registration:

1. Apply migrations to an empty PostgreSQL database and verify that `synchronize` is disabled.
2. Run static seeds idempotently; rerunning them must not duplicate definitions or catalog prices.
3. Verify no seed requires LootLocker, Firebase, a mobile token, or an existing user.
4. Register a disposable test account and verify the complete atomic row set: user, profile, stats, wallet, balances, initial progressions, and session.
5. Exercise matchmaking, content assignment, match events, settlement, purchase, redemption, ad-claim rejection/verification, leaderboard reads, and admin status changes.
6. Confirm all reward effects have ledger/grant/audit rows and all retryable commands are idempotent.
7. Delete the disposable test database/account according to the local testing policy; never treat test data as launch data.

#### 11.3 Legacy provider removal

Before the production launch build:

1. Remove LootLocker SDK/configuration, Firebase initialization, Firestore/RTDB repositories and writes, Firebase Remote Config reads, and `notifyAdminPurchaseHttp` from the mobile/backend runtime.
2. Remove legacy provider environment variables and secrets from Railway.
3. Remove temporary legacy identity fields/tables if they were added during development. They are not needed in a zero-user installation.
4. Confirm the deployed backend has no provider fallback, dual-write, shadow-read, or legacy import job.
5. Confirm the Flutter app uses only Railway auth, matchmaking, content, stats, rewards, and settlement clients.

#### 11.4 Launch rollback

Rollback is a software deployment rollback, not a data migration rollback. If a release is defective before meaningful production use, deploy the previous known-good NestJS/mobile build or disable the affected feature flag. Never switch new users back to LootLocker or Firebase, and never copy balances or settlements between providers. For an already-created Railway record, use an audited compensating transaction.

## 7. Mobile migration execution plan: LootLocker/Firebase to NestJS

This section is the Flutter execution track for the backend phases above. It is
intentionally ordered by dependency. A mobile phase is not complete merely
because one screen displays data from NestJS: the old provider path must be
removed from that feature's dependency graph, its retry behavior must be safe,
and the feature must pass against a clean Railway database.

The current SMARTS app has a shared `AuthRepository` abstraction, but its
production implementation is still `LootLockerAuthRepository` backed by
`LootLockerAuthService`. `ConfigService` still reads Firebase Remote Config and
stores LootLocker domain/session keys. `dependency_injection.dart` registers
LootLocker services, Firebase repositories, and Firebase Cloud Functions. Game
providers also directly type-depend on `LootLockerAuthService`. These are the
primary seams to replace; do not add a second provider fallback in the final
build.

### 7.1 Mobile migration rules

The following rules apply to every mobile phase:

1. Build a small typed HTTP transport around the NestJS base URL. It must add
   `Authorization: Bearer <accessToken>`, `Content-Type: application/json`,
   `x-client-platform: mobile`, and the app version header. It must never add
   `domain-key`, `is-development`, `game_key`, `x-session-token`, or a
   LootLocker API key.
2. Keep one authenticated request pipeline. Repositories and providers must not
   construct provider-specific headers or URLs themselves.
3. Parse Railway UUIDs as opaque strings. Do not call them ULIDs, convert them
   to integers, or derive identity from their formatting.
4. Preserve server numeric values that can exceed JavaScript-style safe integer
   ranges as strings. This includes wallet amounts, XP, ELO/rating values when
   represented as a large integer, leaderboard scores, timestamps where
   applicable, and ledger deltas.
5. Retry a retryable command only with the same idempotency key and the same
   request body. Never generate a new key automatically for an uncertain
   response.
6. A `401` may trigger one single-flight refresh attempt. If rotation fails,
   clear the access/refresh pair and return the app to the signed-out state.
   Do not recursively refresh forever or retry a rejected command indefinitely.
7. Local state is a cache and presentation state. It is not authority for
   currency, XP, ELO, scores, inventory quantity, match state, rewards, or
   game statistics.
8. Remove a legacy implementation only after its replacement is wired into
   every consumer. A dead file that remains registered in GetIt is still a
   runtime migration risk.
9. Log operation names and safe IDs only. Never log passwords, raw JWTs,
   refresh tokens, provider credentials, ad verification payloads, or answer
   keys.

### 7.2 Mobile Phase M0 — Contract lock and transport foundation

**Depends on:** backend Phase 0 and the API contract in Section 5.

**Purpose:** Establish one Railway transport and freeze the response shapes
before feature-by-feature replacement begins.

Implementation steps:

1. Add a Railway base URL selected by build flavor/environment, not by Firebase
   Remote Config. Production must point to the Railway API and development
   must be explicit.
2. Add typed `RailwayApiClient`, request/response error models, timeout rules,
   and the single-flight token-refresh interceptor.
3. Add a secure-storage adapter with separate keys for access token, refresh
   token, user UUID, and optional token-expiry metadata. Never reuse the old
   LootLocker session-token keys as a semantic alias.
4. Add serializers for the NestJS token pair, `UserResponse`, `PlayerResponse`,
   wallet string amounts, pagination, and server error messages.
5. Add a request context for idempotency keys. Commands such as purchase,
   matchmaking enqueue/cancel, match events, completion, ad claims, feedback,
   friend requests, and profile writes must be able to supply a stable key.
6. Add a development-only network log redactor and verify that authorization
   and refresh headers/body values are never printed.

**Do not migrate screens yet.** First make the transport testable with fake
responses and one real `/health` request in a development build.

**Exit criteria:** the app can reach `/health`; the transport can decode a
NestJS error; token refresh is single-flight and one-shot; no request uses a
LootLocker header; and the old provider transport remains unused by the new
Railway test client.

### 7.3 Mobile Phase M1 — Railway UUID authentication and player profile

**Depends on:** backend Phase 1 and M0.

**Purpose:** Make NestJS the only identity authority from first registration.

Add these clients/adapters:

```text
RailwayAuthService
RailwayAuthRepository implements AuthRepository
RailwayPlayerService
RailwayPlayerRepository
```

Use the backend contract exactly:

| Mobile action | NestJS request | Required client behavior |
| --- | --- | --- |
| Register | `POST /auth/register` | Send username, email, password, display name, and optional names/country; store the returned pair. |
| Sign in | `POST /auth/login` | Accept username or email; never send a LootLocker domain/game key. |
| Refresh | `POST /auth/refresh` | Rotate the refresh token and atomically replace both stored tokens. |
| Current identity | `GET /auth/me` | Reconcile account status and UUID after app restart. |
| Player model | `GET /players/me` | Load profile, backend projections, stats, and safe wallet summary. |
| Profile edit | `PATCH /players/me` | Send only profile fields allowed by the DTO. |
| Logout | `POST /auth/logout` | Terminate the current Railway session, then clear local credentials. |

Implementation steps:

1. Preserve the domain-level `AuthRepository` and use cases where possible,
   but replace the concrete LootLocker implementation with the Railway one.
2. Update `AuthResult` mapping from the NestJS shape `{ token, user }` and map
   `token.accessToken`, `token.refreshToken`, and their expiry values without
   treating them as `session_token`.
3. Update `AuthProvider` startup: load tokens, call `/auth/me`, then load
   `/players/me`; if either returns an authorization/status failure, clear the
   session safely.
4. Replace `getSessionToken`, `setSessionToken`, and `verifySession` semantics
   with access/refresh pair semantics. Keep a compatibility migration that
   deletes old LootLocker secure-storage keys; it must not send them to NestJS.
5. Change registration to include the required NestJS `username` and
   `displayName` fields. If the current UI asks for only email/password, add
   the missing fields or derive a user-visible value before the request; do not
   invent a hidden provider identity.
6. Keep level, XP, and ELO display-only. The app may animate a response from
   the server but must not update these values as a local game side effect.
7. Google/Apple login needs a deliberate backend `ExternalIdentity` flow. Do
   not route Google tokens through LootLocker as a temporary shortcut. If that
   backend flow is not approved yet, disable those buttons for the Railway
   build rather than creating an insecure client-only account link.
8. Replace direct `LootLockerAuthService` constructor dependencies in game and
   feature providers with a small interface for the authenticated player/session
   context. This prevents later phases from importing LootLocker by accident.

**Exit criteria:** a new account creates the complete atomic Railway row set;
the app can sign in, restart, refresh, call `/auth/me`, call `/players/me`,
logout, and sign in again without any LootLocker request or Firebase identity
dependency.

### 7.4 Mobile Phase M2 — Progression, leveling, wallet, and leaderboard reads

**Depends on:** backend Phases 2–4 and M1.

**Purpose:** Move all player-owned display data to Railway before moving game
result writes.

Create:

```text
RailwayProgressionService / RailwayProgressionRepository
RailwayWalletService / RailwayWalletRepository
RailwayLeaderboardService / RailwayLeaderboardRepository
```

Implementation steps:

1. Replace LootLocker progression reads with `/progressions`,
   `/progressions/:key/tiers`, `/players/me/progressions`, and
   `/players/me/progressions/:key`.
2. Replace local tier/threshold calculations with the server's `step`,
   `previousThreshold`, `nextThreshold`, `crossedTiers`, and `rewardsGranted`
   response. A local level-up animation may acknowledge a server response but
   cannot grant or replay the reward.
3. Replace wallet reads with `/wallet`, `/wallet/transactions`, and
   `/currencies`. Display amounts from strings and refresh after a successful
   server command rather than incrementing a local balance optimistically as
   committed state.
4. Replace leaderboard reads with `/leaderboards`, board details, paginated
   entries, current-user rank, and selected-member reads. Remove mobile
   `incrementScore`, `submitScore`, and read-current-then-write-current-plus-
   delta behavior.
5. Remove mobile calls to arbitrary XP, ELO, currency, or score mutation
   endpoints. Those writes can only arrive from match settlement, approved ad
   claims, purchases, or protected admin commands.
6. Update wallet, progression, friend leaderboard, and result-screen providers
   to consume repository interfaces rather than LootLocker concrete types.
7. Reconcile on app resume and after a result/reward response. A stale cache is
   acceptable; silently showing a locally invented balance is not.

**Exit criteria:** progression, wallet, and leaderboard screens work with
Railway reads; all amounts and scores render correctly as strings; mobile has
no arbitrary progression/score writer; and a retry cannot duplicate a reward.

### 7.5 Mobile Phase M3 — Catalog, inventory, purchases, storage, and files

**Depends on:** backend Phases 6–7 and M1/M2.

Create:

```text
RailwayCatalogService
RailwayInventoryService
RailwayPurchaseService
RailwayStorageService
```

Implementation steps:

1. Replace LootLocker catalog/assets reads with `/catalog`. Use Railway
   catalog/item UUIDs or stable public keys only; never expose provider IDs as
   authority.
2. Replace inventory reads with `/inventory` and item detail/use/redeem
   commands where enabled. Treat quantity and entitlement status as server
   projections.
3. Start purchases with a client-generated idempotency key, send only the
   selected Railway catalog item and desired quantity, and let NestJS select
   the active price/reward snapshot. Never send a client price, reward bundle,
   currency amount, or “purchase succeeded” claim.
4. If app-store billing is used, send the platform receipt/token to the
   backend verification endpoint. A successful local billing callback is not a
   completed game purchase until the Railway purchase response is committed.
5. Replace generic LootLocker storage with allowlisted `/players/me/storage`
   requests. Do not carry over arbitrary Firebase document paths or storage
   keys.
6. Replace player/profile file uploads with the Railway storage flow. Upload
   only to server-approved S3 paths or signed URLs, then store the resulting
   file reference returned by NestJS. Do not expose S3 credentials in Flutter.
7. Render signed short-lived download URLs and handle expiration by requesting
   a new URL. Never persist a private object URL as permanent authorization.
8. Remove `LootLockerMetadataService`, LootLocker asset/file repositories, and
   public Firebase storage writes after all consumers are migrated.

**Exit criteria:** catalog prices come only from the server; purchase retry is
idempotent; inventory and entitlements reconcile from Railway; private files
are inaccessible without a signed URL; and no mobile code contains S3 secrets,
LootLocker object IDs, or Firebase document paths.

### 7.6 Mobile Phase M4 — Friends, presence, sessions, and feedback

**Depends on:** backend Phases 1, 7, and 8.

Create:

```text
RailwayFriendsService / RailwayFriendsRepository
RailwayPresenceService
RailwayFeedbackService
```

Implementation steps:

1. Replace LootLocker friends requests, accepted relationships, blocks, and
   friend leaderboard lookups with the Railway friends routes. Use UUIDs as
   opaque identifiers and apply the server's privacy response.
2. Send an authenticated heartbeat at a bounded interval while the app is
   active and stop it when the app goes to the background. Presence is a
   server-derived TTL signal, not a public storage key.
3. On resume, reconcile presence and friend state. Do not claim that a player
   is online solely because the local app is open.
4. Replace feedback writes with category lookup and `/feedback` submission.
   Use a stable idempotency key for retries and display the server's accepted
   status.
5. If the mobile app exposes session management, use `/auth/sessions` and the
   session termination routes; never display or store refresh-token hashes.

**Exit criteria:** friend operations are relational Railway operations,
presence survives reconnects correctly, feedback is rate-limit compatible,
and no friend/presence/feedback write reaches LootLocker or Firebase.

### 7.7 Mobile Phase M5 — Matchmaking queue and friend-match lifecycle

**Depends on:** backend Phase 9.1 and M1–M4.

Create:

```text
RailwayMatchmakingService / RailwayMatchmakingRepository
RailwayMatchService
```

Implementation steps:

1. Replace `RealtimeDatabaseMatchmakingRepository` and
   `LootLockerMatchmakingService` with `/matchmaking/queue`, status,
   heartbeat, cancellation, and friend-invite routes.
2. The queue request may send game intent, mode, ranking intent, client version,
   bounded preferences, and an idempotency key. It must not send player level,
   ELO, country authority, final score, question lists, or opponent state.
3. Keep the queue lease alive using the server ticket ID and explicit heartbeat
   endpoint. Replace Firebase `onDisconnect` and local 20/30-second TTL logic.
4. Poll with bounded backoff or use the authorized server stream when available.
   Stop polling after cancellation, expiry, match creation, sign-out, or ban.
5. Replace friend-match Firebase documents with friend invite/accept routes.
   The match ID returned by NestJS becomes the only match identity.
6. Make provider state transitions explicit in the Flutter state machine:
   `idle -> searching -> matched -> loadingMatch -> active -> finishing ->
   settled/review/cancelled`.
7. Handle expiry, cancellation, reconnect, and duplicate responses as normal
   states, not as new queue commands with new identities.

**Exit criteria:** queue and friend matchmaking work without Firebase RTDB or
LootLocker; the server resolves player snapshots and bot fallback; and app
restart can reconcile an existing ticket/match from NestJS.

### 7.8 Mobile Phase M6 — Server game content and accepted gameplay events

**Depends on:** backend Phase 9.2 and M5.

**Purpose:** Remove Firebase question/game-state authority and make every game
action a bounded server event.

Implementation steps:

1. Replace `FirebaseGameRepository`, `FirebaseMathGameRepository`, local
   public question loading, and any Firestore `matches`/`playerStates` writes
   with authorized match and content reads.
2. Load only server-issued content assignments. The client receives prompt,
   safe options, position, assignment token, and expiry data; it never receives
   an answer key, answer hash, private challenge seed, or reward policy.
3. For each answer/ready/heartbeat/leave/finish action, send the match ID,
   participant context supplied by the server, monotonic sequence,
   client-event ID, bounded event payload, and idempotency key.
4. Treat accepted/rejected event responses as authoritative. Do not update
   final score, opponent state, question validity, or game statistics from a
   local calculation and then write it to Firebase.
5. Keep local scoring only as an immediate display hint if product requires it;
   replace it with the server projection as soon as the event response arrives.
6. On reconnect, call `GET /matches/:matchId` and replay only safe, unconfirmed
   commands with their original idempotency keys. Never replay an entire local
   event list with new IDs.
7. Replace local finish/reward chains with `POST /matches/:matchId/complete`
   followed by one settlement read. A review/withheld response must be shown
   as pending review, not converted into a client-side win.

**Exit criteria:** no Firebase question, match, or player-state write remains;
the client uses server assignments/events; accepted events are replay-safe; and
the result screen can render a committed or review settlement.

### 7.9 Mobile Phase M7 — Server settlement, rewards, ad claims, config, and notifications

**Depends on:** backend Phases 5 and 9B, plus M6.

Implementation steps:

1. Replace per-game local result chains in trivia, math, flick, follow-the-lead,
   stacking, high-low, memorize, and similar providers with one
   `RailwayMatchService.completeMatch` flow.
2. Render the settlement response as the source for XP, level changes, ELO,
   wallet effects, leaderboard effects, game stats, tier rewards, and reward
   grants. Do not independently call old LootLocker/Firebase reward paths
   after settlement.
3. Replace `FirebaseCloudFunctionsService` reward/purchase calls with Railway
   purchase and reward endpoints. A background retry must retain the original
   idempotency key.
4. Replace `AdRewardService` client credit logic with a Railway ad-claim flow:
   request a server challenge if required, show the ad through the approved
   provider, submit only provider-verifiable token/nonce data, and render the
   committed wallet response. Never send amount, region, eCPM, or “watched” as
   proof.
5. Replace Firebase Remote Config reads with the safe public projection from
   NestJS. Server-only reward, answer, verification, maintenance authority,
   and provider secrets must not be copied into mobile configuration.
6. Replace durable Firebase notification state with Railway notification
   reads/acknowledgement. FCM may remain temporarily as delivery-only; a push
   callback must not create a reward or match state.
7. Keep result screens resilient to delayed outbox notifications. The direct
   settlement response is the source of immediate UI truth; notifications are
   secondary delivery.

**Exit criteria:** one match completion produces one server settlement, no
client-side reward authority remains, ad retries cannot double-credit, Firebase
Remote Config is not required for game value decisions, and durable rewards or
notifications do not depend on Firebase.

### 7.10 Mobile Phase M8 — Provider removal, clean-install verification, and release

**Depends on:** M0–M7 and backend Phase 11.

This is the final removal phase, not a temporary “switch” controlled by a
runtime flag. There are zero users and no legacy data import, so the release
build can remove old providers outright.

Removal checklist:

1. Remove LootLocker SDK/configuration and all `LootLocker*Service`,
   `LootLocker*Repository`, `lootlocker_config.json`, domain/game key reads,
   `x-session-token`, LootLocker ID parsing, and legacy session-key handling.
2. Remove Firebase initialization that is used for authoritative game state,
   Firestore/RTDB matchmaking, questions, player states, rewards, and Remote
   Config. Remove Firebase Cloud Function reward/purchase calls.
3. If FCM is retained for push delivery, document the exact delivery-only
   boundary and ensure notification state remains in Railway.
4. Remove dead GetIt registrations and direct imports. Run a source search for
   `lootlocker`, `firebase_database`, `cloud_firestore`,
   `firebase_remote_config`, `session_token`, `domain-key`, `x-session-token`,
   `playerStates`, `friend_matches`, and `notifyAdminPurchaseHttp`.
5. Remove legacy provider environment variables and secrets from the mobile
   build configuration. Do not ship Railway database, S3 secret, JWT secret,
   ad webhook secret, or provider verification secret in the app.
6. Install from scratch, register a disposable account, and verify auth,
   profile, progression, wallet, catalog, purchase, inventory, matchmaking,
   gameplay events, settlement, ad claim rejection/verification, friends,
   presence, storage, and feedback.
7. Kill and restart the app during login, token refresh, queueing, an active
   match, purchase submission, and settlement retrieval. Verify every recovery
   path reconciles with NestJS instead of recreating a command.
8. Test a rejected/banned account, expired access token, refresh-token reuse,
   duplicate command, duplicate ad callback, duplicate purchase receipt,
   matchmaking expiry, review settlement, and outbox delay.

**Final mobile exit criteria:** the release build uses only Railway auth,
player, progression, wallet, leaderboard, matchmaking, match, content, stats,
catalog, inventory, purchase, ad-reward, storage, friends, presence, config,
and feedback clients. No authoritative read or write reaches LootLocker or
Firebase, and the app passes the clean-install checks in Phase 11.

### 7.11 Mobile-to-backend compatibility matrix

Use this matrix during code review. A row is complete only when the old mobile
implementation is no longer reachable from production dependency injection.

| SMARTS legacy surface | Current examples found in Flutter | Railway replacement | Removal gate |
| --- | --- | --- | --- |
| Authentication/session | `LootLockerAuthService`, `LootLockerAuthRepository`, `ConfigService` session keys | `RailwayAuthService`, bearer access token, rotated refresh token, NestJS `Session` | M1 auth restart/refresh test passes |
| Profile/player | LootLocker player info/name and metadata calls | `RailwayPlayerService`, `/auth/me`, `/players/me` | M1 profile fields reconcile |
| Progression | `LootLockerProgressionService` and local level-up calculations | Railway progression queries and settlement response | M2 server step/threshold test passes |
| Wallet | `LootLockerWalletService`, wallet provider local balance updates | `/wallet`, ledger-backed settlement/claim/purchase responses | M2 amount-string and retry tests pass |
| Leaderboards | LootLocker leaderboard service and score increments | Railway leaderboard read queries; trusted settlement writer | M2 no client score-writer search |
| Catalog/inventory/purchase | LootLocker catalog/assets/inventory/purchase services | Railway catalog, inventory, purchase, entitlement APIs | M3 price snapshot/retry test passes |
| Storage/files | LootLocker storage/file/metadata services and public writes | Railway storage DTOs plus signed S3 URLs | M3 private-file ownership test passes |
| Friends/presence | LootLocker friends/presence services | Railway friends and heartbeat endpoints | M4 privacy/expiry test passes |
| Matchmaking | `RealtimeDatabaseMatchmakingRepository`, LootLocker matchmaking | Railway ticket/worker/friend-invite lifecycle | M5 restart/expiry test passes |
| Game content/state | `FirebaseGameRepository`, `FirebaseMathGameRepository`, Firestore/RTDB state | Railway assignments, accepted match events, settlement | M6 answer/event replay test passes |
| Rewards/config | Firebase Remote Config, `FirebaseCloudFunctionsService`, local ad credit | Railway policies, claims, grants, outbox, notifications | M7 server-only reward test passes |
| Push delivery | Firebase Messaging | FCM delivery-only adapter, Railway notification state | M7 outage cannot alter reward state |

### 7.12 Mobile testing and rollout gates

Run focused tests after each mobile phase; do not wait for the final release.

#### Transport and authentication

- register rollback leaves no partial user-owned rows;
- login accepts username and email as specified;
- access expiry causes one refresh, not a loop;
- refresh rotation replaces the old pair and rejects reuse;
- concurrent requests share one refresh promise;
- inactive/banned status clears the mobile session;
- logout and logout-all reconcile after app restart.

#### Data and economy

- BigInt/string values render without rounding;
- stale wallet/progression/leaderboard cache is replaced by the server;
- duplicate purchase/ad/claim commands return the original committed result;
- no price, reward, score, XP, or ELO comes from a trusted mobile field;
- signed file URLs are renewed after expiration.

#### Match lifecycle

- queue heartbeat and expiry behave correctly across background/resume;
- duplicate event responses do not advance local state twice;
- event sequence/replay/assignment rejection is displayed safely;
- reconnect reads the server match projection;
- complete/settlement is called once logically and remains retryable;
- review/withheld settlement does not display competitive rewards.

#### Release search gates

Before release, fail the build review if production mobile code still imports
or registers any of these authoritative legacy surfaces:

```text
LootLockerAuthService / LootLockerAuthRepository
LootLockerProgressionService / LootLockerProgressionRepository
LootLockerWalletService / LootLockerWalletRepository
LootLockerLeaderboardService / LootLockerLeaderboardRepository
LootLockerMatchmakingService
RealtimeDatabaseMatchmakingRepository
FirebaseGameRepository / FirebaseMathGameRepository
FirebaseCloudFunctionsService
firebase_remote_config for game authority
domain-key / x-session-token / lootlocker_config.json
```

The final smoke test must use the same clean Railway database verification
sequence in Phase 11. No shadow-read, dual-write, feature-flagged provider
fallback, or runtime “legacy mode” is permitted after the final provider
removal build.

## 8. Security checklist

Before declaring the greenfield launch complete, verify:

- access and refresh secrets are separate production secrets;
- refresh tokens are hashed and rotated;
- UUID format is validated at transport boundaries;
- all identifiers are scoped to the authenticated user unless the route is explicitly public/admin;
- banned/inactive status is checked on every authenticated request;
- all write DTOs use whitelist validation;
- no controller accepts a client-owned wallet ID, player ID, reward amount, score authority, or admin flag;
- all sensitive writes have idempotency protection;
- all economy/progression/leaderboard writes have immutable event rows;
- all multi-step operations use the Prisma transaction helper;
- row locking is used for concurrent balances, progressions, scores, and settlements;
- no external provider is called inside a database transaction;
- Firebase security rules are not treated as a replacement for backend authorization; final clients cannot write matchmaking, matches, questions, rewards, or game stats to Firebase;
- match events validate participant ownership, sequence, assignment, nonce, timing, and replay before affecting a result;
- reward policies, answer keys, eCPM rules, and anti-abuse decisions are not exposed through client configuration;
- ad claims require provider verification or a server-issued one-time nonce, unique event IDs, caps, and cooldowns;
- game statistics are derived from accepted server events and settlements, never from client-reported totals;
- object-storage URLs are signed and short-lived;
- rate limiting exists for login, registration, claims, purchases, feedback, friend requests, and match commands;
- system-admin actions require an active administrator session and an audit reason;
- logs contain IDs and operation codes but never passwords, raw JWTs, refresh tokens, or provider credentials.

## 9. Testing and verification strategy

Do not wait until the final phase to test. Add focused tests next to each affected transaction and service.

### Transaction tests

- registration rollback if profile/stats/wallet creation fails;
- duplicate idempotency key returns the first result;
- conflicting request hash is rejected;
- concurrent wallet debit cannot overspend;
- concurrent XP awards do not lose points;
- multiple crossed tiers grant each reward exactly once;
- duplicate match settlement creates one settlement and one set of effects;
- status change terminates sessions atomically;
- last admin protection works.

### Property/boundary tests

- zero, negative, and maximum XP;
- tier threshold exactly equal, one below, and one above;
- max tier with no next threshold;
- score-difference clamp boundaries;
- solo/bot/ranked/casual reward policy differences;
- draw/forfeit/incomplete match;
- wallet amount at zero and at maximum configured value;
- weekly/monthly UTC boundary;
- leaderboard ties and ascending boards;
- stackable and unique inventory items.

### Greenfield bootstrap tests

- an empty database applies all migrations without `synchronize: true`;
- rerunning static seeds produces no duplicate definitions, tiers, prices, or policies;
- no seed creates player-owned rows or requires a legacy provider;
- the first registration creates exactly one user, profile, stats, wallet, balances, progressions, and session;
- a failed registration leaves no partial player-owned rows;
- the first purchase, match settlement, ad claim, redemption, and leaderboard update are independently idempotent;
- projection rebuilds from the new event/settlement tables are deterministic;
- a clean installation has no LootLocker/Firebase provider fallback or legacy import job.

### API/mobile contract tests

Use sanitized fixtures from the current SMARTS payloads. Verify token refresh, profile loading, progression response fields, wallet string amounts, leaderboard pagination, inventory pagination, purchase responses, and settlement responses. Test that malicious client values are ignored or rejected.

## 10. Observability and operations

Every command should log a structured operation code, for example:

```text
AUTH_REGISTER
AUTH_REFRESH
PROGRESSION_AWARD
WALLET_CREDIT
WALLET_DEBIT
MATCH_SETTLE
LEADERBOARD_SCORE_APPLY
PURCHASE_COMPLETE
SYSTEM_BOOTSTRAP
SEED_APPLY
AD_REWARD_VERIFY
MATCHMAKING_TICKET_EXPIRE
```

Track:

- authentication success/failure and refresh reuse;
- transaction duration and rollback rate;
- idempotency replay/conflict counts;
- wallet ledger reconciliation failures;
- progression reward grant failures;
- settlement duplicates and review-required matches;
- leaderboard write/read latency;
- purchase/provider callback duplicates;
- outbox age, retries, and dead letters;
- seed/bootstrap failures and duplicate-seed attempts;
- rejected/replayed ad claims and matchmaking expiry counts.

Add health checks for PostgreSQL and migrations. A deployment is not complete until migrations run successfully and the live health endpoint reports database connectivity.

## 11. Definition of done

The LootLocker replacement is complete only when all of the following are true:

1. SMARTS can register, login, refresh, logout, and load profile using Railway tokens.
2. No runtime mobile request goes to LootLocker.
3. Main and ELO progressions are stored and awarded by Railway transactions.
4. Tier rewards cannot be duplicated by retries or concurrent requests.
5. Wallet balances are ledger-backed and cannot be client-credited.
6. Weekly/monthly player and country leaderboards are server-written and queryable.
7. Game results are settled once and drive all rewards atomically.
8. Catalog, inventory, and purchases use server prices and idempotent grants.
9. Public storage, files, friends, presence, and feedback obey ownership/privacy rules.
10. System administrators can inspect and correct the system through audited transactions.
11. A clean database bootstrap and first-registration flow pass the agreed integrity checks.
12. NestJS owns matchmaking queues, friend matches, match state, game content, accepted gameplay events, bots, and per-game statistics.
13. Firestore/RTDB matchmaking and match writes, Firebase question/game-stat reads, and Firebase `rewards` writes are removed.
14. Firebase Remote Config and Cloud Function calls are removed from reward, purchase, ad, maintenance, and version decisions.
15. LootLocker and Firebase keys, dependencies, services, repositories, initialization, and legacy runtime configuration are removed, except for any explicitly temporary delivery-only adapter.

## 12. Reference material

Local implementation references:

- [SMARTS authentication README](../../smarts/smarts/AUTH_README.md)
- [SMARTS LootLocker infrastructure](../../smarts/smarts/lib/infrastructure/lootlocker/)
- [SMARTS core entities and repositories](../../smarts/smarts/lib/core/)
- [Railway Prisma schema](../prisma/schema.prisma)
- [Railway Prisma transaction helper](../src/common/helpers/prisma-transaction.ts)
- [Nexa transaction base](../../Backend/src/common/helpers/base-transaction.ts)
- [Nexa admin user transactions](../../Backend/src/modules/admin/access/users/transactions/)
- [Nexa admin session transactions](../../Backend/src/modules/admin/access/sessions/transactions/)

Official LootLocker documentation used to verify the old product concepts and payload terminology:

- [LootLocker Game API reference](https://ref.lootlocker.com/game/index)
- [LootLocker player progressions](https://ref.lootlocker.com/game/get-all-player-progressions-api-5291510)
- [LootLocker progressions overview](https://docs.lootlocker.com/game-systems/progressions/overview/)
- [LootLocker catalogs overview](https://docs.lootlocker.com/commerce/catalogs/overview/)
- [LootLocker admin API reference](https://ref.lootlocker.com/admin-api/)

These external references describe the legacy behavior only. They are not a reason to retain a LootLocker dependency or to expose the same trust model to the mobile client.
