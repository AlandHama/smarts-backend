# SMARTS Match Reward Integrity and Anti-Farming Implementation Plan

## 1. Objective

Make progression, ratings, GLD rewards, statistics, streaks, missions, leaderboards, and match outcomes fair and server-authoritative for every SMARTS game.

This plan addresses:

- forfeiting, disconnects, timeouts, and abandoned matches;
- repeated quit farming and reward farming through bots or rematches;
- casual versus ranked rating behavior;
- client-controlled correctness in legacy games;
- inconsistent XP scales and progression keys;
- switching accounts or devices to evade abuse detection;
- settlement idempotency, retries, and recovery;
- fraud review, observability, rollout, and rollback.

The goal is abuse resistance and auditable fairness. Absolute hack-proof behavior is not possible, so all economically valuable decisions must be made by the backend and supported by layered risk controls.

## 2. Scope: every current game

### Server-authoritative games

These games already contain dedicated backend engines and should remain authoritative:

- `gem_blitz` — Gem Blitz
- `tile_rush` — Tile Rush
- `word_dash` — Word Dash
- `domino` — Domino Duel
- `perfect_timing` — Perfect Timing
- `bomb_path` — Bomb Path

### Generic-content games

- `trivia`
- `math`
- `flick_master`
- `high_low`
- `stacking`
- `similarities`
- `follow_the_lead`
- `memorize_cards`
- `bird_watching`

`trivia` and `math` already validate the submitted answer index against server content. The remaining local games currently accept a client-provided correctness flag and must be migrated to server-verifiable challenges.

## 3. Current findings to preserve in regression tests

The implementation must preserve the good existing behavior:

- match rows are locked before authoritative actions and settlement;
- action sequences and client event IDs are checked;
- settlement is idempotent and match-scoped;
- bots do not receive player progression, wallet, leaderboard, or audit rewards;
- practice matches do not receive competitive progression or economy rewards;
- server-authoritative game engines calculate score rather than accepting client score deltas;
- ranked entry stakes and payout settlement remain transactional;
- settlement retries do not reopen an already finished match;
- duplicate requests return the original result instead of applying a second reward.

Relevant existing areas:

- `src/modules/matches/transactions/settle-match-transaction.ts`
- `src/modules/matches/transactions/record-match-event-transaction.ts`
- `src/modules/matches/transactions/forfeit-match-transaction.ts`
- `src/modules/matches/transactions/expire-match-transaction.ts`
- `src/modules/progression/transactions/award-progression-points-transaction.ts`
- `src/modules/fraud/fraud.service.ts`

## 4. Product and policy decisions

Before changing code, freeze these rules in an admin-managed policy version.

### 4.1 Match modes

| Mode | XP | GLD | Public Elo | Hidden matchmaking rating | Leaderboard |
|---|---:|---:|---:|---:|---:|
| Practice | No | No | No | No | No |
| Casual versus human | Yes, subject to eligibility | Yes, subject to eligibility | No | Optional | Yes, per-game best-score leaderboard |
| Casual versus bot | Reduced or capped XP | No GLD | No | No | No |
| Ranked versus human | Yes | Ranked payout only | Yes | Yes | Yes |
| Ranked versus bot | Disabled by default | Disabled | Disabled | Disabled | Disabled |

The backend must derive the mode from the match record. Flutter must not be able to select a reward mode after the match starts.

### 4.2 Forfeit policy

Forfeiting is an authoritative loss for the forfeiting participant and an authoritative win for the opponent.

The forfeiting player receives:

- zero match XP;
- zero GLD reward;
- no `MATCH_COMPLETED` streak credit;
- no win, perfect-match, correct-answer, or gameplay mission credit;
- no leaderboard score (including the per-game leaderboard);
- no cognitive-skill update from the abandoned match;
- a `FORFEIT` statistic increment;
- a ranked rating loss according to the ranked rating policy.

The opponent receives the normal win result and normal ranked payout where applicable.

The only exception is a controlled network disconnect grace period. A player may reconnect during the grace period, but the player must still complete the match or be finalized as a forfeit.

### 4.3 Timeout policy

Timeouts must be distinct from voluntary forfeits in event metadata but must not be a reward shortcut.

- A player who times out before meeting minimum participation receives no XP or GLD.
- A player who times out after meeting the minimum participation threshold may receive only the configured capped participation XP, never a win reward.
- A ranked timeout is a loss unless the server proves that the player completed the required action before the deadline.
- The opponent receives the win only when the server has finalized the opponent’s result.
- All timeout decisions use server time, not device time.

### 4.4 Minimum participation

Reward eligibility must be calculated per participant, not from a match-wide event count.

Each game policy must define:

- minimum accepted server actions;
- minimum active play duration or verified challenge count;
- maximum rewardable score before completion;
- whether a partial timeout can receive capped participation XP;
- whether a bot match is rewardable;
- whether a rematch has diminishing rewards.

The minimum must be difficult to satisfy by submitting one no-op action and immediately quitting.

## 5. Shared settlement redesign

### 5.1 Add a participant reward-eligibility projection

Add server-owned settlement fields, either on `MatchParticipant` or a dedicated settlement eligibility table:

- `acceptedActionCount`;
- `acceptedScoringActionCount`;
- `verifiedPlayMilliseconds`;
- `firstAcceptedAt`;
- `lastAcceptedAt`;
- `completionState`;
- `terminationReason`;
- `rewardEligibility`;
- `rewardHoldReason`;
- `serverScoreBeforeTermination`;
- `policyVersion`;
- `stateHashAtTermination`.

Do not infer these fields from client payloads during settlement.

### 5.2 Replace the match-wide accepted-event gate

The current settlement gate counts accepted events for the entire match. Replace it with a per-player check.

Required behavior:

- one player’s accepted action must not make the other player reward-eligible;
- a terminal event must not count as gameplay participation;
- rejected, duplicate, heartbeat, emote, and forfeit events must not count as scoring actions;
- an accepted action with zero score may count toward diagnostics but not automatically toward rewards;
- each game defines its own verified participation threshold.

### 5.3 Separate result from reward eligibility

A participant can have a result and still be ineligible for rewards.

Use separate concepts:

- `result`: `WIN`, `LOSS`, `DRAW`, `FORFEIT`, or `TIMEOUT`;
- `completionState`: `COMPLETED`, `ABANDONED`, `TIMED_OUT`, `DISCONNECTED`, or `REVIEW`;
- `rewardEligibility`: `FULL`, `PARTIAL`, `NONE`, or `HELD`.

Settlement must calculate the result first, then independently calculate reward eligibility.

### 5.4 Forfeit settlement rules

When `result === FORFEIT`:

- XP amount is zero;
- GLD amount is zero;
- Elo is a ranked loss, not zero delta;
- no mission, streak, leaderboard, or cognitive update is written;
- game statistics increment `forfeits`, but not `gamesCompleted`;
- the settlement response explicitly exposes `rewardEligibility: NONE`;
- the opponent is settled normally.

For a ranked match, preserve the existing stake/payout transaction, but ensure the forfeiter cannot receive normal loser rewards in addition to the ranked result.

### 5.5 Timeout and disconnect settlement

Add a server-side disconnect/heartbeat lifecycle:

1. Record the last authenticated activity timestamp.
2. Start a short reconnect grace period after a missed heartbeat or socket disconnect.
3. Do not reward during the grace period.
4. Recover the match if the player reconnects.
5. Finalize as `DISCONNECTED`/`FORFEIT` after the grace period.
6. Run settlement through the same idempotent transaction.

A client closing the app must not be able to keep a match pending indefinitely or choose a favorable completion path.

### 5.6 Reward calculation

Replace raw score-to-XP behavior with policy fields:

- `scoreNormalizationFactor`;
- `maximumMatchXp`;
- `minimumCompletionXp`;
- `participationXp`;
- `winnerXpBonus`;
- `loserXpBonus`;
- `drawXpBonus`;
- `forfeitXp = 0`;
- `timeoutXp`;
- `botXpMultiplier`;
- `dailyGameXpCap`;
- `dailyAccountXpCap`;
- `sameOpponentDiminishingFactor`.

XP must be comparable across games with different score scales and durations.

Recommended initial normalization:

- use a configured expected-score value per game;
- convert score to a bounded performance fraction;
- cap the match XP before applying outcome bonuses;
- do not let Gem Blitz, Tile Rush, or Word Dash’s large score ranges produce hundreds of times more level progress than Perfect Timing or Bomb Path.

### 5.7 Currency rewards

For casual matches:

- reward only completed, eligible matches;
- do not reward forfeits or zero-participation timeouts;
- cap daily GLD earned from matches;
- apply diminishing returns for repeated matches against the same opponent, bot, or account cluster;
- keep ranked payouts separate from casual reward minting.

Eligible casual human matches are included in the selected game's all-time
best-score leaderboard. This is written from authoritative `PlayerGameStats`
during settlement and does not grant public Elo or place bot/practice/held
matches on the board.

For all reward writes:

- preserve source IDs and idempotency;
- record the exact policy version;
- record eligibility and risk status in settlement metadata;
- hold rewards instead of issuing them when fraud review is required.

## 6. Rating and leveling redesign

### 6.1 Public Elo

Only `RANKED` human-versus-human matches may update public Elo.

Use a standard expected-score rating calculation or the existing rating algorithm after it is made mode-aware. Do not use raw final-score difference as the primary rating delta.

Required behavior:

- normal win: positive delta;
- normal loss: negative delta;
- draw: small or zero delta based on expected score;
- forfeit: loss delta, with optional escalating penalty;
- timeout: loss delta after server grace expires;
- practice: no delta;
- bot: no delta;
- casual: no public Elo delta.

Rating changes must be bounded by policy and written with the match ID as the idempotency source.

### 6.2 Main player level

Choose one supported model and enforce it consistently:

**Recommended:** use the shared `main` progression for the visible player level and use separate hidden per-game stats for game mastery.

Alternative: create a complete progression definition for every game and clearly expose per-game levels. Do not mix game-specific XP keys with a UI that reads `PlayerProfile.level` from `main`.

Before rollout, validate that every active `GameConfig.mainProgressionKey` and `eloProgressionKey` exists and has active tiers.

Add a startup/admin consistency check that fails loudly when a configuration references a missing progression definition.

### 6.3 Progression tiers

Ensure the progression system has:

- complete tier definitions;
- explicit maximum or prestige behavior;
- increasing thresholds;
- reward grants that are idempotent;
- no unintended level increase from held or reversed rewards;
- an audit trail for administrative tier changes.

The current award transaction allows points to continue beyond the final configured tier while exposing the last tier as the player level. Define whether this is intended or replace it with an explicit cap/prestige rule.

## 7. Make every game server-verifiable

### 7.1 Gem Blitz

- Keep board state, move legality, cascades, score, combo, and timer on the server.
- Enforce per-player action counts and score caps.
- Do not count terminal or bot events as human participation.
- Add minimum verified play duration before XP eligibility.
- Add score-distribution and score-velocity monitoring.

### 7.2 Tile Rush

- Keep the existing authoritative board, path validation, board hash, sequence, and rate limits.
- Treat stale board hashes as reconciliation events, not automatic fraud unless repeated.
- Keep score velocity thresholds policy-driven and device-independent.
- Add forfeit reward suppression and normalized XP.

### 7.3 Word Dash

- Keep server board generation, dictionary validation, path validation, duplicate-word checks, submission rate limits, and word caps.
- Do not use client-reported score or word validity.
- Add minimum verified word count and active duration before reward eligibility.
- Normalize XP so the 250,000 score cap does not dominate other games.

### 7.4 Domino Duel

- Keep legal tile, turn, chain hash, boneyard, hand, round, and timeout validation on the server.
- Ensure all pass/draw/round-end events are classified correctly.
- Add a per-player minimum participation rule.
- Ensure long match timeouts cannot be used to avoid a ranked loss.
- Keep private hands out of opponent projections and replay exports.

### 7.5 Perfect Timing

- Keep schedule generation, marker position, target position, timestamp validation, clock offset checks, and judgement on the server.
- Never accept a client judgement or score.
- Require valid tap evidence for XP eligibility.
- Use the same rating/forfeit policy as other ranked games.
- Keep device latency as a fairness signal, not as a client-controlled score adjustment.

### 7.6 Bomb Path

- Keep field generation, commitment, safe route, orthogonal step validation, bomb detection, trophy completion, speed score, and efficiency score on the server.
- Ensure terminal events do not satisfy participation requirements.
- Clear previous-round actions and hashes when creating the next round.
- Apply per-player eligibility, not match-wide event eligibility.
- Treat bomb hits, incomplete rounds, timeout, disconnect, and voluntary forfeit distinctly in diagnostics but consistently for rewards.

### 7.7 Trivia and Math

- Keep server assignment tokens and server answer-index validation.
- Validate assignment order, expiry, time limits, and duplicate submissions.
- Never trust client score, correctness, or elapsed time beyond bounded telemetry.
- Add minimum answered questions before XP or GLD rewards.

### 7.8 Flick Master, High Low, Stacking, Similarities, Follow the Lead, Memorize Cards, Bird Watching

Replace client correctness with server verification.

For each game:

1. Generate a server challenge from the match nonce and policy version.
2. Store the answer or a keyed answer commitment on the server.
3. Send only the challenge projection to Flutter.
4. Accept a structured action, not `answerCorrect`.
5. Recompute correctness on the server.
6. Bound action time using server receipt time and allowed clock tolerance.
7. Store the challenge ID, action, result, score delta, and state hash.
8. Add replay fixtures proving the same challenge produces the same result.

The legacy `answerCorrect` field should be rejected after migration, except for a temporary versioned compatibility path that awards no competitive rewards.

## 8. Anti-farming and fraud controls

### 8.1 Match-level signals

Record and score these signals per account:

- repeated forfeits;
- repeated matches ending within a few seconds;
- high percentage of matches with one action followed by forfeit;
- high XP per minute;
- high GLD per minute;
- repeated matches against the same bot or opponent;
- repeated same-device or same-network account clusters;
- impossible score velocity;
- impossible timing or action cadence;
- abnormal win/loss alternation;
- repeated ranked entry, quit, and rematch cycles;
- client version or state-hash mismatch patterns;
- settlement retries or duplicate-action anomalies.

Add new fraud signal types for:

- `REPEATED_MATCH_FORFEITS`;
- `SHORT_MATCH_REWARD_FARMING`;
- `MATCH_XP_VELOCITY`;
- `MATCH_GLD_VELOCITY`;
- `SAME_OPPONENT_FARMING`;
- `BOT_REWARD_FARMING`;
- `CLIENT_CORRECTNESS_MISMATCH`;
- `RANKED_QUIT_AVOIDANCE`.

### 8.2 Reward enforcement

Fraud observations must affect match rewards, not only payouts and ads.

At settlement:

- `CLEAR`/`WATCH`: issue eligible rewards;
- `SUSPICIOUS`: hold GLD and competitive rewards for review, optionally issue capped non-economic XP;
- `RESTRICTED`/`SUSPENDED`: issue no rewards and no rating changes until review;
- preserve the match result for history even when rewards are held.

Use a separate reward ledger status so a held reward can be released, cancelled, or reversed without replaying gameplay.

### 8.3 Device and account identity

Device identity is a risk signal, not a sole ban key.

Add where platform support allows:

- an app-install identifier stored server-side;
- platform attestation signals such as Apple App Attest or Play Integrity;
- token rotation and session binding;
- IP/ASN and network-risk signals with privacy limits;
- account age and verification status;
- rate limits per account, install, network, and risk cluster.

Do not rely only on client-supplied manufacturer/model headers. They are useful telemetry but are spoofable.

An account must retain its server-side progression when changing devices, but suspicious activity must follow the account’s risk profile and reward eligibility.

## 9. Matchmaking controls

Add server checks before queue entry and pair claiming:

- reject active duplicate matches for the same account;
- enforce account-level cooldown after repeated forfeits;
- prevent ranked queue access while ranked rewards are held;
- exclude restricted accounts from bots and ranked games;
- do not allow bot fallback to grant competitive progression;
- record level and rating snapshots at match creation;
- use current server rating for future matchmaking, never client-supplied values;
- limit repeated same-opponent and same-bot pairings within a rolling window;
- prevent rapid queue-cancel/requeue loops from bypassing cooldowns.

## 10. Settlement, idempotency, and recovery requirements

Every settlement must:

- lock the match;
- verify the captured policy version;
- verify every participant’s terminal state;
- compute participant result independently;
- compute participant reward eligibility independently;
- create one settlement record per match;
- use a unique source ID for every XP, rating, currency, mission, streak, and leaderboard write;
- write an outbox event after successful settlement;
- remain retryable after partial external failure;
- never reopen gameplay after terminal state;
- preserve a state hash and replay reference;
- record the actor as server/system, never Flutter.

Add a settlement repair command that can:

- inspect unsettled finished matches;
- recalculate eligibility from stored server evidence;
- retry safe idempotent side effects;
- hold or reverse suspicious rewards;
- write an admin audit event for every manual action.

## 11. Database and migration work

Add migrations for:

- participant evidence and reward eligibility fields;
- termination reason and disconnect grace metadata;
- match policy snapshot/version fields;
- reward hold/review status;
- per-account reward velocity counters or a materialized daily ledger;
- fraud signals listed above;
- progression-key consistency constraints or validation records;
- server challenge commitments for legacy games;
- optional app-install and attestation records;
- indexes for user, game, mode, result, termination reason, and settlement status.

Do not delete historical match events. Existing events must remain replayable and must be marked with their original policy version.

Before enabling rewards, run a data audit:

```sql
SELECT key FROM "GameDefinition" ORDER BY key;

SELECT "key", "mainProgressionKey", "eloProgressionKey", "rankingEnabled"
FROM "GameConfig";

SELECT "key", "active"
FROM "ProgressionDefinition"
ORDER BY "key";
```

Every referenced progression key must exist, be active, and contain valid tiers.

## 12. Testing plan

### 12.1 Settlement matrix

For every game, test:

- normal win/loss;
- draw;
- voluntary forfeit before any action;
- forfeit after one accepted action;
- forfeit after a high score;
- disconnect during grace period;
- disconnect after grace period;
- timeout with no participation;
- timeout after minimum participation;
- bot opponent;
- human opponent;
- casual mode;
- ranked mode;
- practice mode;
- duplicate settlement request;
- duplicate action request;
- out-of-order action;
- settlement retry after a wallet/progression failure;
- fraud-held reward;
- match-wide opponent activity while this player performs no action.

### 12.2 Security tests

- Modify Flutter payloads to claim arbitrary scores.
- Submit `answerCorrect: true` for every local legacy challenge.
- Replay old client event IDs.
- Change sequence numbers.
- Submit actions after the server deadline.
- Change client timestamps and device headers.
- Switch the account between devices.
- Create multiple accounts on one install.
- Repeatedly quit bot matches.
- Repeatedly quit after one scoring action.
- Repeatedly rematch the same account.

All attempts must either be rejected, produce no reward, or enter fraud review.

### 12.3 Property and replay tests

For every authoritative engine:

- same seed and policy produce the same schedule/board;
- replaying the same accepted actions produces the same final score;
- score never exceeds the configured cap;
- invalid actions never mutate authoritative score;
- a terminal action cannot be used as participation evidence;
- a participant cannot receive more than one reward per source ID;
- a forfeit cannot increase score or progression.

### 12.4 Narrow-device and latency tests

Although the backend is authoritative, test realistic mobile conditions:

- delayed requests;
- duplicate requests after retry;
- clock offset;
- app backgrounding;
- network handoff;
- reconnect during a round;
- slow device rendering;
- offline client attempting to submit stale actions.

## 13. Observability and admin tools

Add dashboards by game and mode for:

- matches started, completed, forfeited, timed out, cancelled, and reviewed;
- reward eligibility distribution;
- XP and GLD per match and per minute;
- forfeit rate and time-to-forfeit;
- ranked quit rate;
- score distributions and score velocity;
- client rejection and state-hash mismatch rates;
- settlement retry failures;
- reward holds and reversals;
- same-device and same-opponent clusters;
- progression gained per account per day;
- bot participation and bot reward attempts.

Admin actions must support:

- game-specific kill switch;
- mode-specific rollout percentage;
- reward hold/release/cancel;
- account reward restriction;
- rating correction with audit reason;
- settlement retry;
- replay inspection without exposing private answers or hands;
- policy version rollback for new matches only.

## 14. Rollout plan

### Stage 0 — Audit-only

- deploy metrics and read-only fraud observations;
- calculate would-be reward eligibility without changing rewards;
- compare current rewards with hardened rewards;
- identify accounts with repeated short matches, forfeits, and abnormal XP velocity.

### Stage 1 — Safety controls

- disable client correctness rewards for legacy local games;
- disable GLD rewards for bot and forfeited matches;
- stop casual public Elo changes;
- enable per-player participation checks;
- keep ranked rollout disabled while settlement metrics stabilize.

### Stage 2 — Casual rollout

- enable hardened XP and casual rewards for a small percentage of accounts;
- monitor reward deltas and false-positive fraud holds;
- enable daily caps and diminishing returns;
- expand only after settlement and reconnect metrics are stable.

### Stage 3 — Ranked rollout

- enable ranked mode one game at a time;
- require server-verifiable game actions;
- verify forfeit penalties, stake payout, rating movement, and leaderboard results;
- monitor ranked quit avoidance and rating inflation.

### Stage 4 — Enforcement

- enable automatic cooldowns for repeated forfeits;
- enable reward holds for suspicious accounts;
- review existing suspicious balances before irreversible action;
- publish player-facing rules for disconnects, forfeits, and reward holds.

## 15. Acceptance criteria

The work is complete only when:

- no game grants competitive rewards from a client-controlled correctness field;
- no forfeiting participant receives XP, GLD, streak, mission, cognitive, or leaderboard credit;
- casual matches do not change public Elo;
- ranked forfeits are rating losses;
- bot and practice matches cannot grant ranked progression or GLD;
- reward eligibility is calculated per participant;
- all progression keys referenced by active configs exist and have valid tiers;
- XP is normalized and capped across games;
- repeated quit farming produces no positive economic or progression result;
- device switching does not reset legitimate progression or bypass account risk controls;
- every settlement side effect is idempotent and auditable;
- all listed games pass the settlement and security matrix;
- kill switches, reward holds, settlement retries, and replay inspection work from System Admin;
- dashboards can identify farming within one day of activity.

## 16. Three-phase implementation roadmap

The integrity work is split into three deployable phases. Each phase must be
backward compatible with matches created under an older policy version. A
later phase must not be treated as complete merely because an earlier phase is
deployed: the acceptance matrix in this document remains the release gate.

### Phase 1 — Settlement safety and authoritative reward eligibility

This is the minimum safety layer and is the first implementation target.
The current implementation covers this phase's shared backend settlement
guard, participant evidence projection, and Flutter result-surface handling.

- add per-participant evidence fields and a durable reward-eligibility result;
- calculate accepted participation from that participant's accepted server
  events, never from a match-wide event count;
- grant no XP, GLD, streak, mission, cognitive, or leaderboard credit to a
  forfeiting participant;
- keep ranked forfeits as rating losses and prevent casual public Elo changes;
- keep practice reward-free and bot matches capped to non-ranked XP with no GLD
  or public Elo;
- expose `FULL`, `PARTIAL`, `HELD`, and `NONE` eligibility plus hold reasons in the
  settlement projection;
- preserve settlement idempotency and write the evidence and policy decision
  into the participant row and audit metadata;
- update Flutter settlement models and result surfaces to display the server
  decision and never infer rewards from a local score or outcome;
- add backend and mobile tests for the forfeit, practice, bot, casual, ranked,
  no-evidence, and idempotent-retry cases.

Phase 1 deliberately keeps the existing legacy answer protocol compatible. It
does not yet trust that protocol for a new reward policy; that migration is
Phase 2.

### Phase 2 — Score normalization and anti-farming enforcement

Implementation status: the Phase 2 backend/mobile safety layer is now wired.
Legacy local-answer clients remain temporarily playable through an explicit
`LEGACY_CLIENT_CORRECTNESS` compatibility path, but those events are marked
unverified and cannot receive competitive rewards. New assignment-indexed
answers are server-verified. The full legacy client migration can therefore be
rolled out without allowing the old correctness field to mint rewards.

- replace the seven legacy client-controlled correctness paths with signed or
  server-replayable challenge evidence;
- normalize XP and GLD across games, apply daily caps and diminishing returns,
  and ensure every active progression key has valid tiers;
- add fraud/risk decisions to match reward issuance, including reward holds,
  suspicious-account review, and repeated short-match/quit farming controls;
- add rematch, same-opponent, bot, and single-device abuse limits;
- add reconnect grace and authoritative timeout finalization for every game;
- extend replay and settlement tests to score bounds, velocity, stale events,
  and cross-game farming.

### Phase 3 — Identity, operations, and ranked hardening

Implementation status: the Phase 3 backend and mobile integration is now
wired. Install identity is best-effort and risk-only, policy versions are
captured on new matches, rollout/kill-switch checks protect direct and queued
play, held amounts have an auditable release/cancel ledger, and System Admin
can inspect dashboards, holds, settlement retries, sanitized replays, policy
versions, and idempotent progression corrections. The post-implementation
audit remediation below also closes the direct-match, payout, cap-race,
leaderboard-loss, and account-cluster gaps found during review. The complete
load/fairness matrix and production alert tuning remain release-validation
work, not a reason to disable the safety controls.

- add device/install/attestation risk signals without resetting legitimate
  progression when a player changes devices;
- add System Admin policy versioning, game/mode kill switches, rollout
  percentages, reward hold/release/cancel, correction, retry, and replay
  inspection;
- add dashboards and alerts for reward deltas, Elo inflation, forfeits,
  reviews, bot attempts, device clusters, and settlement failures;
- enable casual and ranked rollout gradually, with ranked stakes, rating,
  leaderboard, and settlement retry verification;
- publish player-facing disconnect, forfeit, review, and reward-hold rules;
- complete the full all-games fairness, load, fraud, and migration matrix.

## 17. Recommended implementation order

1. Deploy Phase 1 in audit-safe mode and verify the settlement matrix.
2. Enable Phase 1 reward suppression and ranked/casual rating rules.
3. Migrate legacy correctness and add normalized reward/fraud controls in
   Phase 2.
4. Add identity, operations, staged rollout, and ranked hardening in Phase 3.
5. Do not widen rollout until the acceptance criteria and the full all-games
   test matrix pass.

## 18. Post-implementation integrity audit and remediation

The Phase 1–3 implementation was re-audited against direct match creation,
matchmaking, settlement, wallet/progression/leaderboard writes, daily ledgers,
fraud identity signals, and admin recovery paths. The following fixes are now
implemented:

- Direct `RANKED` matches are rejected by the generic `/matches` creation
  transaction. Ranked matches must be created by the ranked matchmaking path,
  which validates the ranking tier, entry stake, policy, and player risk state.
- Direct casual matches now enforce the same three-match-per-opponent rolling
  daily limit already used by rematches and matchmaking. This prevents the
  direct endpoint from bypassing the anti-farming limit.
- Forfeits always resolve to `rewardEligibility: NONE`, even when the player
  is suspicious or otherwise reviewable. A fraud hold cannot turn a quitter
  into a capped-XP recipient.
- Ranked and cooperative ranked payouts are issued only when the winning
  participant has a server decision of `FULL`. Otherwise the payout is written
  to the participant's auditable `MatchRewardHold` for admin release/cancel.
- Daily XP/GLD caps now take a PostgreSQL account/day advisory transaction lock
  before reading aggregate ledgers. Concurrent settlements from different
  games cannot spend the same remaining account-wide allowance twice.
- Ranked leaderboard deltas are applied for both wins and losses. Losses are
  floored at zero so a first loss cannot abort settlement, while the Elo
  progression ledger still records the full bounded rating delta.
- Settlement metadata uses the match's captured integrity policy version,
  rather than whichever game-config version happens to be active at finish.
- Install collisions now produce a threshold-one signal for both related
  accounts, and three-or-more-account network clusters produce pair-scoped
  signals for every account in the cluster. The legacy multi-account rule is
  retained as a secondary signal; no account is banned solely from device/IP
  identity.
- Admin progression corrections now require a caller-provided idempotency key,
  so retries cannot mint duplicate corrections. Dashboard timeout counts and
  settlement retry candidates are filtered from authoritative termination and
  settlement-outbox data respectively.

### Audit status after remediation

The static bypass audit is clear for the reviewed reward paths: direct ranked
creation is blocked, direct casual pair farming is capped, forfeits cannot
receive XP/GLD/leaderboard credit, ranked payouts are held when reviewable,
daily caps are serialized across games, and normal ranked losses reach the
leaderboards without breaking zero-floor constraints.

Remaining release-validation work is intentionally external to this code
remediation: production Apple App Attest/Google Play Integrity verification
requires provider credentials and platform signing configuration, and the
full concurrency/load/fairness matrix still needs to run against staging
PostgreSQL. Until those are configured, attestation tokens remain explicitly
`PRESENT_UNVERIFIED` and are risk evidence rather than proof of device
integrity.
