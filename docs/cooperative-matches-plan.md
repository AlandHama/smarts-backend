# SMARTS Party Lobbies & Cooperative Matches Implementation Plan

## 1. Purpose

Add a complete cooperative multiplayer experience to SMARTS:

- A player can host a private party lobby.
- The host can invite one friend, creating a two-player team.
- Party members can chat and send voice messages while waiting.
- The party can enter a random cooperative match or a ranked cooperative match.
- Two parties are matched into a four-player 2v2 match.
- If a second party cannot be found, the server may fill missing positions with cooperative bots when policy allows.
- Both teams answer the same challenge sequence and collect team scores.
- The team with the higher authoritative score wins.
- Ranked cooperative matches use the existing ranked/ELO/GLD economy with cooperative-specific configuration.
- Exiting an active match returns the player to the party lobby when possible.
`
This plan is implementation guidance only. It must be implemented across the NestJS backend, Flutter mobile app, and System Admin without trusting client-submitted scores, match results, GLD deductions, or player state.

## 2. Product model

### Party

A party is a temporary group of one or two real players preparing to enter a cooperative match.

Party rules:

- Maximum real players: 2.
- One owner/host controls matchmaking mode and can start or cancel matchmaking.
- The invited player must be an accepted friend and must not be blocked, restricted from matchmaking, or already committed to another party/match.
- The party expires after a configurable idle period.
- A player may belong to only one active party.
- Party membership changes are server-authoritative and broadcast through sockets.
- The party remains available after a match ends so members can rematch or leave.

### Cooperative match

Every match has two teams:

```text
Team A: Party A player 1 + Party A player 2
Team B: Party B player 1 + Party B player 2
```

Allowed variations:

- A real party plus a bot-supported party.
- One or more bots only when the configured matchmaking policy permits it.
- Never silently place a solo player into a cooperative match without displaying the team composition before the match begins.

The server must always identify real players and bots separately in matchmaking, gameplay, results, analytics, moderation, and rewards.

## 3. Match modes

### Cooperative random match

- No ranked GLD stake.
- Party enters the cooperative matchmaking pool.
- Server selects a compatible game and challenge configuration rather than requiring the host to preselect a game.
- Matchmaking attempts to find another two-player party first.
- Bot filling is controlled by System Admin configuration.
- Results award normal gameplay progression according to the existing casual policy.

### Cooperative ranked match

- Uses the existing ranked-match architecture as the foundation.
- Every participating real player must pass the ranked eligibility checks.
- Every real player is charged the configured cooperative ranked entry fee before match commitment.
- The debit must be idempotent and held in a server-owned ledger transaction.
- If the match fails before commitment, the server refunds affected players according to policy.
- A completed result settles the ranked outcome, ELO changes, GLD payout/stake policy, XP, missions, achievements, and streak activity exactly once.
- ELO updates are individual but team-result based, with configurable teammate/opponent weighting.
- Bots do not receive GLD, ELO, XP, missions, achievements, or leaderboard entries unless explicitly enabled by a future policy.

Ranked cooperative matching must show the exact entry fee and possible result policy before the party confirms.

## 4. Party lifecycle

```text
NONE
  ↓
CREATED
  ↓
INVITE_PENDING
  ↓
READY
  ↓
QUEUED_RANDOM or QUEUED_RANKED
  ↓
MATCH_FOUND
  ↓
COMMITTED
  ↓
IN_MATCH
  ↓
RESULTS
  ↓
READY / CLOSED
```

Failure and recovery states:

- `INVITE_EXPIRED`
- `INVITE_DECLINED`
- `CANCELLED`
- `MATCHMAKING_TIMEOUT`
- `DISCONNECTED_RECONNECTING`
- `ABANDONED`
- `SETTLEMENT_REVIEW`

State transitions must be validated on the backend. The mobile app only renders the current server state.

## 5. Backend architecture

Create a dedicated cooperative feature module rather than placing cooperative logic inside ordinary friend or single-match controllers.

Suggested module structure:

```text
src/modules/cooperative/
├── cooperative.module.ts
├── cooperative.controller.ts
├── cooperative.agent.controller.ts
├── cooperative.service.ts
├── party.service.ts
├── cooperative-matchmaking.service.ts
├── cooperative-match.service.ts
├── cooperative-settlement.service.ts
├── cooperative-policy.service.ts
├── cooperative.gateway.ts
├── cooperative-events.service.ts
├── dto/
├── transactions/
└── workers/
```

Reuse existing services where possible:

- friends and friend validation
- friend-chat conversation and voice-message infrastructure
- standard match lifecycle and challenge assignment
- ranked match policy and ELO progression
- wallet debit, hold, refund, and settlement transactions
- notifications and outbox processing
- fraud/risk observation
- missions, achievements, progression, and streak services
- server-owned analytics event writer

Do not duplicate wallet, ELO, match settlement, or notification logic.

## 6. Database design

Add a migration with server-owned cooperative records.

### Party

Suggested `Party` fields:

- `id`
- `hostUserId`
- `status`
- `mode`: `RANDOM` or `RANKED`
- `maxMembers`
- `expiresAt`
- `queuedAt`
- `matchedAt`
- `closedAt`
- `createdAt`
- `updatedAt`

Indexes:

- active party by host
- active party by member
- status/mode/queuedAt
- expiresAt

### PartyMember

- `id`
- `partyId`
- `userId`
- `role`: `HOST` or `MEMBER`
- `status`
- `joinedAt`
- `leftAt`
- `readyAt`
- `lastHeartbeatAt`

Unique constraint:

```text
(partyId, userId)
```

### PartyInvite

- `id`
- `partyId`
- `inviterId`
- `inviteeId`
- `status`
- `expiresAt`
- `respondedAt`
- `createdAt`

Prevent duplicate active invites for the same party and invitee.

### CooperativeQueueEntry

- `id`
- `partyId`
- `mode`
- `status`
- `ratingSnapshot`
- `levelSnapshot`
- `countrySnapshot`
- `clientVersion`
- `queuedAt`
- `lastHeartbeatAt`
- `expiresAt`
- `matchId`

Only the host enters or leaves the queue. The server verifies all party members before enqueueing.

### CooperativeMatch

Either extend the existing match model with a cooperative type or create a linked record containing:

- `matchId`
- `format`: `TWO_V_TWO`
- `mode`: `RANDOM` or `RANKED`
- `teamOneId`
- `teamTwoId`
- `gameDefinitionId`
- `policyVersion`
- `rankingPolicyVersion`
- `status`
- `entryFeeGld`
- `createdAt`
- `startedAt`
- `endedAt`
- `settledAt`

### CooperativeTeam

- `id`
- `matchId`
- `teamNumber`
- `score`
- `correctAnswers`
- `answeredQuestions`
- `result`
- `rankingDelta`
- `rewardSummary`

### CooperativeParticipant

- `id`
- `matchId`
- `teamId`
- `userId` nullable for bots
- `participantType`: `PLAYER` or `BOT`
- `displaySnapshot`
- `levelSnapshot`
- `eloSnapshot`
- `finalScore`
- `correctAnswers`
- `connectedAt`
- `disconnectedAt`
- `forfeitAt`

### CooperativeLedgerOperation

Use an idempotent record for ranked entry debits, refunds, and payouts:

- `id`
- `matchId`
- `userId`
- `operationType`
- `amount`
- `currencyCode`
- `walletTransactionId`
- `idempotencyKey`
- `status`
- `createdAt`

## 7. Party APIs

Suggested authenticated endpoints:

```text
POST   /cooperative/parties
GET    /cooperative/parties/current
POST   /cooperative/parties/:partyId/invites
POST   /cooperative/party-invites/:inviteId/accept
POST   /cooperative/party-invites/:inviteId/decline
POST   /cooperative/parties/:partyId/ready
DELETE /cooperative/parties/:partyId/members/:userId
POST   /cooperative/parties/:partyId/leave
POST   /cooperative/parties/:partyId/queue
POST   /cooperative/parties/:partyId/queue/cancel
POST   /cooperative/parties/:partyId/heartbeat
GET    /cooperative/parties/:partyId/history
```

Rules:

- Validate the caller is a member for reads and a host for host-only actions.
- Validate the invitee is a friend and is not blocked.
- Recheck party membership, player status, ranked eligibility, wallet balance, and existing matches before queueing.
- Queueing is idempotent.
- Leaving a party while queued removes the queue entry atomically.
- Host transfer must be explicit and server-authoritative if the host leaves.

## 8. Party chat and voice messages

The party lobby should use the existing friend-chat system with a temporary party conversation.

Requirements:

- Create or link one private party conversation per party.
- Only current party members can read or send.
- Preserve the configured chat retention period.
- Support text, image, system events, and voice messages using the existing media storage bucket.
- Use sockets for new messages, typing, read receipts, online state, recording state, and member changes.
- Use HTTP for history, pagination, media upload, and reconnect recovery.
- Show system messages for invite accepted, member left, queue started, match found, match cancelled, and return to lobby.
- Expire or archive the party conversation when the party is closed according to chat retention policy.
- Never expose storage URLs in notification previews or lobby summaries.

## 9. Matchmaking

### Queue behavior

The backend creates a queue entry only after:

1. The party has exactly two eligible real players, unless solo-party policy is enabled.
2. Both players are online enough to receive match events.
3. Both players have accepted the selected mode.
4. Ranked players have enough GLD and meet ranked requirements.
5. No member is in another queue, active match, restricted state, or unresolved conflict.

### Match selection

Matchmaking should prefer:

1. Two compatible two-player parties.
2. Similar combined rating/level and acceptable region.
3. Similar queue age after widening the rating window gradually.
4. Bot fill only after the configured wait threshold.

The server selects a compatible game definition from the active cooperative pool and sends the same game assignment to both teams.

### Queue widening configuration

System Admin controls:

- initial rating window
- maximum rating window
- widening interval
- maximum queue duration
- bot fallback enabled/disabled
- bot fallback delay
- country/region preference
- minimum app version
- ranked solo-party allowance
- ranked cooperative eligibility requirements

### Match-found confirmation

Before commitment, both real players should receive a short confirmation state. If a player fails to acknowledge within the configured window, cancel or rematch without charging ranked fees unless the policy explicitly defines a no-show penalty.

## 10. Ranked cooperative economy

Implement ranked cooperative as a separate policy version under the existing ranking/economy controls.

System Admin-configurable values:

- enabled state
- entry fee
- stake/payout model
- refund policy
- minimum level
- minimum ELO
- minimum completed matches
- party rating spread
- team rating calculation
- ELO gain/loss formula
- maximum ELO delta
- bot eligibility
- abandonment penalty
- disconnect grace period
- settlement retry policy

Recommended settlement flow:

```text
Party confirms ranked queue
        ↓
Eligibility and balance check
        ↓
Idempotent GLD hold/debit for both players
        ↓
Match found and committed
        ↓
Server assigns challenge sequence
        ↓
Server validates answers and calculates team scores
        ↓
Match ends
        ↓
Determine winning team
        ↓
Calculate each player's ELO change
        ↓
Apply ranked payout and progression
        ↓        base/assets/flutter_assets/fonts/MaterialIcons-Regular.otf

If you don't know why you're seeing this error, visit our troubleshooting page at https://docs.shorebird.dev/code-push/troubleshooting#your-app-contains-asset-changes-warning-when-creating-a-patch
Write immutable settlement
        ↓
Publish results and notifications
```

No GLD or ELO operation may be performed from the mobile client.

## 11. Cooperative gameplay

### Challenge rules

- Both teams receive the same challenge assignments and time limits.
- Challenge assignment tokens are server-owned and bound to participant, match, round, and position.
- Answers are submitted through the existing authoritative match endpoint.
- Duplicate, late, impossible, or replayed answers are rejected.
- Team score is calculated from accepted server events only.
- The client may display optimistic feedback, but settlement uses server records.

### In-game HUD

Add a compact cooperative header/panel showing:

- Team A and Team B names or team colors.
- Current team scores.
- Current round/question progress.
- Small player avatars and connection indicators.
- Player contribution score for the local team.
- Opposing team score with a subtle, non-distracting update animation.
- Team lead indicator such as `+12` or `Behind by 8`.

Do not reveal answer keys or future challenge content.

### Disconnect behavior

- Show reconnecting state and grace countdown.
- Keep the player in the match if they reconnect within the policy window.
- Continue server-side timing regardless of client state.
- Apply abandonment/forfeit policy only after the grace period.
- Keep the remaining teammate informed through a system event.
- Record all disconnects and reconnects for analytics and fraud review.

## 12. Matchmaking screen

Create a cooperative match-found screen matching the current SMARTS visual language.

Display:

```text
COOPERATIVE MATCH

YOUR TEAM                    OPPOSING TEAM
[avatar] Player one          [avatar] Player three
[avatar] Player two          [avatar] Player four

Team rating / rank           Team rating / rank
Game selected                Game selected

[Accept match]
```

Additional states:

- searching for another party
- widening search
- bot fill warning
- waiting for teammate
- match confirmation countdown
- opponent disconnected before commitment
- queue cancelled

Show rank tier names, not only raw ELO, while retaining ELO in an expandable detail area if needed.

## 13. Party lobby mobile UI

Create a dedicated lobby screen rather than reusing the ordinary friend screen.

### Header

- Back button.
- Party title such as `Ally lobby`.
- Host badge.
- Party expiry or inactivity indicator.
- Settings/more action for host.

### Team area

- Two member slots.
- Large avatar, username, rank tier, level, online/ready status.
- Invite friend action when the second slot is empty.
- Host transfer and remove-member actions.

### Chat area

- Compact embedded party chat.
- Text composer.
- Plus action for game invite and GLD transfer if supported by current chat policy.
- Hold-to-record voice message button with seconds indicator, swipe-left cancel, and playback bubbles.
- System messages for lobby state changes.

### Match actions

- `Random cooperative match` primary action.
- `Ranked cooperative` secondary action with entry fee and rank explanation.
- Ready toggle.
- Queue status and cancel action.
- Match-found transition.

The lobby must restore correctly after app resume, socket reconnect, match cancellation, and match completion.

## 14. Match result screen

Create a cooperative-specific result screen.

Display:

- Winning team banner and clear result state.
- Both teams with avatars and rank tiers.
- Team score comparison.
- Each player's contribution: score, correct answers, accuracy, and time.
- Ranked result: ELO before/after, tier movement, GLD entry fee, payout/refund, and settlement status.
- XP, mission, achievement, and streak rewards.
- Disconnect/forfeit indicators where relevant.
- Match report and player-report actions.
- `Return to lobby` primary action.
- `Play again` action for the same party.
- `Leave party` secondary action.

Results must remain available through HTTP history if the app is closed before displaying them.

## 15. Notifications

Add notification types for:

- party invitation
- party invitation accepted/declined
- party member removed
- teammate ready
- match found
- opponent found
- match confirmation expiring
- teammate disconnected
- match settled
- ranked cooperative result
- ranked refund or settlement review

Foreground notifications should use in-app banners. Background notifications should show safe human-readable content without exposing storage URLs, tokens, or sensitive fraud details.

## 16. Socket events

Use a dedicated cooperative namespace or clearly namespaced events:

```text
party.snapshot
party.member.joined
party.member.left
party.member.updated
party.invite.created
party.invite.updated
party.chat.message
party.chat.typing
party.chat.read
party.voice.recording
party.queue.updated
cooperative.match.found
cooperative.match.confirmation
cooperative.match.started
cooperative.match.score.updated
cooperative.match.player.connected
cooperative.match.player.disconnected
cooperative.match.ended
cooperative.match.settled
```

Socket requirements:

- Authenticate every connection.
- Authorize party/match membership for every event.
- Never trust client-supplied user IDs or team IDs.
- Use sequence numbers and reconnect snapshots.
- Support idempotent client commands.
- Use HTTP recovery when events were missed.
- Apply rate limits to typing, heartbeat, and chat events.

## 17. System Admin page

Add a dedicated navigation item:

```text
Cooperative matches
├── Overview
├── Party lobbies
├── Matchmaking queue
├── Live matches
├── Ranked settlements
├── Policies
├── Games and challenge pool
├── Bots
├── Abandonments and disconnects
├── Reports and moderation
└── Audit
```

### Overview

Show:

- active parties
- parties waiting for a member
- random queue size
- ranked queue size
- average queue wait
- match-found acceptance rate
- bot-fill rate
- active cooperative matches
- completion rate
- disconnect and abandonment rate
- ranked settlement failures
- GLD held, debited, refunded, and paid
- ELO movement and tier distribution

### Party lobbies

Administrators can search by party ID, player, status, mode, and date. Display members, chat metadata, queue state, match linkage, and lifecycle events. Message content remains restricted and audited.

Allowed administrative actions, permission-controlled and audited:

- cancel a stuck party
- remove an invalid member
- close a stale lobby
- force a safe queue recheck
- inspect event history

### Matchmaking queue

Display live queue entries, rating snapshots, queue age, region, mode, bot eligibility, and widening stage. Allow safe cancellation of stuck entries and configuration-driven bot fill; never edit a player score directly.

### Live matches

Display team composition, scores, challenge progress, connection state, server timing, policy version, and settlement state. Sensitive answer data and answer keys are never displayed.

### Ranked settlements

Provide filters for pending, settled, refunded, failed, disputed, and review-required matches. Show immutable ledger operations, ELO deltas, policy versions, and retry/reconciliation actions.

### Policies

Editable sections:

- party limits and expiry
- queue windows and widening
- random match game pool
- bot behavior and limits
- cooperative scoring
- ranked entry fee and payout
- ELO formula
- disconnect/abandonment rules
- confirmation timeout
- reward policy
- chat/voice retention for party lobbies

Every policy update creates a versioned record, takes effect atomically, and is audited with before/after values.

## 18. Permissions and auditing

Suggested System Admin permissions:

```text
cooperative.view
cooperative.view_live_matches
cooperative.view_ranked_settlements
cooperative.manage_policies
cooperative.manage_bots
cooperative.cancel_queue
cooperative.cancel_party
cooperative.retry_settlement
cooperative.view_chat_metadata
cooperative.view_chat_content
cooperative.export
```

Audit:

- policy reads and changes
- player/party lookup
- live match inspection
- queue cancellation
- party cancellation
- bot policy changes
- ranked settlement retry/refund
- chat content access
- exports

## 19. Analytics and fraud instrumentation

Emit server-owned analytics events for:

- party created, joined, left, expired, and closed
- party invite sent, accepted, declined, and expired
- party queue entered, widened, cancelled, and timed out
- cooperative match found, confirmed, committed, started, ended, and settled
- team score updates and rejected answer events
- bot fill
- disconnect and reconnect
- abandonment and forfeit
- ranked debit, refund, payout, and settlement failure
- lobby chat and voice-message metadata

Do not store message bodies, voice bytes, answer keys, access tokens, or raw media URLs in analytics events.

Feed the existing analytics/reporting area with cooperative metrics and add System Admin breakdowns for random versus ranked cooperative matches.

Fraud/risk checks should cover:

- coordinated impossible scoring
- repeated teammate collusion patterns
- answer timing anomalies
- account/device clusters
- repeated ranked abandonment
- suspicious GLD refund patterns
- bot exploitation attempts

## 20. Safety and moderation

- Party members can report another player from the lobby, match, and results screen.
- Existing block/restriction rules apply before invites and queueing.
- Moderators can inspect party and match metadata.
- Chat content access requires explicit permission and a reason.
- Preserve reported messages or voice-message metadata according to moderation evidence policy.
- A player restricted from chat must not be able to use party chat or voice messages.
- A player restricted from ranked play must not enter ranked cooperative queues.

## 21. Testing requirements

### Backend

- party creation and one-party-per-player constraints
- friend-only invitation validation
- invite expiry and duplicate invite handling
- host leave and host transfer
- queue idempotency and cancellation
- two-party matching
- bot fallback policy
- ranked balance checks for both players
- atomic GLD debit and refund
- duplicate settlement protection
- ELO/team result calculations
- answer validation and score aggregation
- disconnect/reconnect grace windows
- socket authorization and replay protection
- chat and voice retention
- report/moderation authorization
- analytics event idempotency

### Mobile

- lobby restore after app restart
- socket reconnect snapshot recovery
- invitation notification deep links
- voice recording, timer, playback, and swipe-to-cancel
- match-found confirmation timeout
- team score updates and connection indicators
- ranked fee confirmation
- result display after background/resume
- return to lobby after exit
- accessibility and small-screen layouts

### System Admin

- policy CRUD and versioning
- permissions for sensitive operations
- live queue and match refresh
- settlement filters and reconciliation
- audit records
- safe empty/loading/stale/error states
- responsive desktop layout

## 22. Implementation phases

### Phase 1 — Party foundation

- Database migration for parties, members, invites, and queue entries.
- Party REST APIs and socket snapshots.
- Friend invitation validation and notifications.
- Party lobby mobile screen.
- Existing text/voice chat embedded in the lobby.
- System Admin party and policy foundation.

### Phase 2 — Cooperative random matches

- Cooperative matchmaking pool.
- Two-party matching and configurable bot fill.
- Cooperative match lifecycle and authoritative team scoring.
- Matchmaking screen, cooperative HUD, disconnect recovery, and results screen.
- Random cooperative analytics and moderation events.

### Phase 3 — Ranked cooperative

- Ranked cooperative policy and System Admin controls.
- Atomic two-player GLD debit/hold/refund.
- Team-based ELO settlement and ranked rewards.
- Ranked settlement/reconciliation page.
- Abandonment, disputes, risk checks, and full audit trail.

### Phase 4 — Hardening and live operations

- Load tests for queue and socket fan-out.
- Settlement failure recovery worker.
- Historical analytics and exports.
- Bot quality tuning.
- Operational alerts and incident runbooks.
- Production rollout behind feature flags.

## 23. Feature flags and rollout

Use server-controlled feature flags:

- `cooperativePartyEnabled`
- `cooperativeRandomEnabled`
- `cooperativeBotFillEnabled`
- `cooperativeRankedEnabled`
- `cooperativeVoiceEnabled`
- `cooperativeRewardsEnabled`

Recommended rollout:

1. Enable party creation for internal/admin accounts.
2. Enable random cooperative matches with bots disabled.
3. Enable controlled bot filling.
4. Enable ranked cooperative for a small eligible cohort.
5. Monitor queue health, settlement, GLD reconciliation, and fraud signals.
6. Expand gradually after successful reconciliation.

## 24. Completion criteria

The feature is complete when:

1. Two friends can create a party, chat, and send voice messages in the lobby.
2. The party can enter random or ranked cooperative matchmaking.
3. The server creates a visible 2v2 team composition with real players and/or clearly marked bots.
4. Both teams play the same challenge sequence and receive authoritative team scores.
5. The cooperative HUD shows team scores and player contribution without crowding gameplay.
6. Ranked cooperative debits, refunds, payouts, ELO, XP, and rewards settle exactly once.
7. Disconnects, app restarts, socket recovery, and exits return players safely to the lobby or results.
8. Players receive correct foreground and background notifications.
9. System Admin can configure, monitor, inspect, reconcile, and audit the entire feature.
10. Cooperative metrics and risks appear in analytics and moderation reports.
