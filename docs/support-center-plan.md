# SMARTS in-game support center implementation plan

## 1. Goal

Add a complete support center inside the SMARTS mobile app, opened from the existing profile/settings surface. Players should be able to:

- Read help articles and frequently asked questions.
- Create free support tickets.
- Attach screenshots or other safe evidence to tickets.
- Track ticket status, priority, replies, and history.
- Start a live support chat with a support agent for a configurable GLD price.
- Receive notifications when a ticket or live chat receives a reply.
- Rate the support experience after resolution.
- Escalate a ticket when the first answer does not solve the problem.

Support agents should be normal SMARTS accounts with explicitly granted support permissions. They should be able to work from the mobile app and from the system-admin website. The system administrator must control support-agent access, pricing, queue behavior, retention, working rules, canned replies, categories, and reporting.

The feature must be independent from player-to-player chats. It may reuse the existing authenticated HTTP client, socket transport, notification delivery, file upload service, moderation primitives, and visual language, but support conversations must have their own authorization, billing, retention, and audit rules.

## 2. Product surfaces

### Mobile player surface

Add `Support Center` to the profile/settings menu. The entry should show an unread badge when there is a new ticket reply, live-chat reply, status change, or system announcement.

The support center home should contain:

1. A friendly header: `How can we help?`
2. Searchable help articles and FAQs.
3. Primary actions:
   - `New ticket` — free.
   - `Start live chat` — costs the configured GLD amount.
4. `My tickets` with status and unread indicators.
5. `My live chats` with active, waiting, ended, and rated conversations.
6. A small pricing explanation before live-chat payment.
7. A support status card showing whether live agents are online and the estimated queue wait.
8. A link to report a payment or GLD issue separately from a gameplay issue.

### Mobile support-agent surface

If the authenticated account has a support capability, show an additional `Support inbox` entry. It must not be visible merely because the user is a friend, group-chat admin, leaderboard moderator, or system-admin user without the support capability.

The support inbox should provide:

- Unassigned queue.
- My assigned tickets.
- My active live chats.
- Waiting-for-player tickets.
- Escalated tickets.
- Search and filters by category, priority, age, status, player, and assignment.
- Agent presence toggle: `Available`, `Busy`, and `Offline`.
- A conversation view with player profile context, ticket metadata, safe account diagnostics, and reply composer.
- Assignment, transfer, escalation, internal notes, canned replies, status changes, and close/reopen actions according to granted permissions.

Agents must never see private wallet secrets, authentication tokens, password data, unrelated player conversations, or unnecessary personal information.

### System-admin surface

Create a separate system-admin navigation item and page called `Support center`. Do not place the feature under player chats, commerce, or notifications.

The page should contain tabs or sections for:

- Overview.
- Support configuration.
- Support agents and permissions.
- Tickets.
- Live chats.
- Help center articles and FAQs.
- Categories and canned replies.
- SLAs and business rules.
- Pricing and billing ledger.
- Reports and analytics.
- Audit log.

System admins should be able to open a conversation in read-only or intervention mode, depending on their permission. Any admin intervention must be clearly labeled in the conversation and recorded in the audit log.

## 3. Important separation from player chats

Use a dedicated support domain rather than inserting support conversations into `ChatConversation`.

The current friend/group chat implementation is designed around player participants. Support has different requirements:

- A player can have several tickets but only one active live-chat session per issue.
- An agent may access a ticket without becoming a normal player-chat participant.
- Tickets need statuses, assignment, priority, SLA timers, internal notes, escalations, and resolution codes.
- Live chats have a paid session lifecycle and payment ledger.
- Support messages require stronger auditability and staff controls.
- Support retention and evidence rules differ from ordinary friend-chat retention.

Reuse shared low-level components where practical:

- Authenticated Railway API client and token refresh.
- Socket connection and reconnection patterns.
- Notification inbox and FCM delivery.
- Public file upload pipeline and image validation.
- Message sanitization, rate limiting, report/evidence patterns, and audit helpers.

Do not reuse player-chat authorization or participant-role checks as a shortcut.

## 4. Roles and permissions

Use explicit capability-based permissions. Suggested permissions:

| Capability | Purpose |
|---|---|
| `support.player.create_ticket` | Player can open a ticket. Usually granted to every active player. |
| `support.player.start_live_chat` | Player can purchase/start a live support session. |
| `support.player.reply` | Player can reply to their own support conversation. |
| `support.agent.view_queue` | Agent can see tickets assigned to their permitted queues. |
| `support.agent.claim` | Agent can claim an unassigned ticket. |
| `support.agent.reply_ticket` | Agent can reply to tickets. |
| `support.agent.reply_live_chat` | Agent can answer paid live chats. |
| `support.agent.assign` | Agent can assign or transfer tickets. |
| `support.agent.internal_note` | Agent can create staff-only notes. |
| `support.agent.escalate` | Agent can escalate to a senior queue. |
| `support.agent.close` | Agent can resolve or close a ticket/session. |
| `support.agent.presence` | Agent can change availability status. |
| `support.supervisor.manage_agents` | Supervisor can grant queue membership and agent limits. |
| `support.supervisor.override_billing` | Supervisor can refund, waive, or adjust support charges. |
| `support.admin.configure` | Configure support policies, price, queues, and SLAs. |
| `support.admin.view_all` | View all support conversations and reports. |
| `support.admin.export` | Export permitted support reports. |
| `support.admin.audit` | View support audit logs and intervention history. |

System admin should be able to:

- Search a player and grant/revoke support-agent access.
- Select one or more queues/categories for the agent.
- Set agent level: agent, senior agent, supervisor.
- Set maximum simultaneous live chats.
- Set working status or suspend the agent.
- Require two-person approval for refunds and sensitive actions.
- See when the permission was granted, by whom, and why.

Every privileged action must be checked in the backend. Hiding a button in Flutter is not authorization.

## 5. Support configuration

Store configuration in a dedicated support configuration record with versioned updates and audit history.

### General settings

- `enabled`.
- `maintenanceMessage`.
- `supportEmail` or escalation contact.
- `defaultLanguage`.
- `timezone`.
- `playerCanReopenDays`.
- `ticketRetentionDays`.
- `messageRetentionDays`.
- `attachmentRetentionDays`.
- `maxOpenTicketsPerPlayer`.
- `maxMessageLength`.
- `maxAttachmentsPerMessage`.
- `maxAttachmentSizeBytes`.
- Allowed attachment MIME types.

### Live-chat settings

- `liveChatEnabled`.
- `liveChatPriceGld` — default `2` GLD, decimal-safe if the economy supports it.
- `liveChatPriceCurrencyCode` — normally `GLD`.
- `liveChatSessionMinutes`.
- `liveChatGraceMinutes`.
- `maxQueueSize`.
- `maxConcurrentChatsPerAgent`.
- `autoCloseInactiveMinutes`.
- `playerReplyTimeoutMinutes`.
- `agentReplySlaMinutes`.
- `queueAssignmentStrategy`: round robin, least active, or manual.
- `allowAgentsToStartChats`.
- `refundOnNoAgentConnection`.
- `refundOnSystemFailure`.
- `refundOnAgentCancellation`.
- `requirePlayerRating`.

### Safety and abuse settings

- Per-player ticket creation rate.
- Per-player live-chat purchase rate.
- Per-agent reply rate.
- Maximum repeated-message count.
- Link policy.
- Profanity/spam policy.
- Automatic abuse escalation threshold.
- Blocked attachment extensions.
- Whether a restricted player may contact support.
- Whether support can be used during maintenance.

Configuration changes should take effect for new sessions. Existing paid sessions should keep the price and duration recorded at purchase time.

## 6. Ticket lifecycle

Suggested ticket states:

```text
OPEN
  -> TRIAGED
  -> ASSIGNED
  -> WAITING_FOR_PLAYER
  -> WAITING_FOR_SUPPORT
  -> ESCALATED
  -> RESOLVED
  -> CLOSED
  -> REOPENED
```

Rules:

- A ticket starts as `OPEN` and receives a server-generated ticket number such as `SUP-2026-000123`.
- A player may add messages while the ticket is open, assigned, waiting, or reopened.
- `WAITING_FOR_PLAYER` pauses the agent-response SLA but not the retention timer.
- A player reply to a resolved ticket reopens it only within the configured reopen window.
- A closed ticket cannot be silently changed; reopening creates an audit event.
- A ticket may have exactly one current assignee, one current queue, and many historical assignments.
- Internal notes are never visible to players.
- Closing a ticket requires a resolution code and optional public closing message.

Suggested ticket categories:

- Account and login.
- Matchmaking and gameplay.
- Game result or reward issue.
- GLD wallet or transfer.
- Social gifts.
- Friend chats and notifications.
- Purchases and store.
- Ads and rewards.
- Bug report.
- Fraud or suspicious activity.
- Safety, harassment, or abuse.
- Other.

Categories must be configurable in system admin and may have their own queue, priority defaults, SLA, article suggestions, and required fields.

## 7. Live-chat lifecycle and GLD billing

Live chat is a paid support session. The default price is `2 GLD`, but it must never be hardcoded in Flutter or the backend transaction.

### Recommended payment flow

1. Mobile requests the current support configuration.
2. Mobile requests a live-chat quote from the backend.
3. Backend returns:
   - price and currency;
   - quote ID;
   - expiration time;
   - whether agents are currently available;
   - estimated wait.
4. Player confirms in a dialog showing `Start live chat — 2 GLD`.
5. Backend atomically validates the quote, configuration, player status, limits, and balance.
6. Backend debits GLD with an idempotency key and creates the live-chat session in the same transaction boundary used by the economy ledger.
7. The player enters the support queue or is connected to an available agent.
8. The price, quote, configuration version, and ledger transaction ID are permanently recorded on the session.

Never trust the amount sent by Flutter. Never debit by directly mutating a wallet balance.

### Billing policy

Define and expose the policy clearly before purchase:

- Free ticket creation never charges GLD.
- A live-chat charge happens once per session, not per message.
- If no agent connects within the configured guarantee window, automatically refund if enabled.
- If the player cancels before assignment, follow the configured refund policy.
- If the player disconnects temporarily, keep the session alive for the grace period.
- A player cannot create duplicate paid sessions from double taps or network retries.
- Refunds and waivers create compensating ledger entries, never deletions.
- Support agents cannot alter wallet balances directly.

### Live-chat states

```text
PAYMENT_PENDING
QUEUED
ASSIGNED
ACTIVE
PAUSED
WAITING_FOR_PLAYER
ENDED
REFUND_PENDING
REFUNDED
EXPIRED
```

## 8. Data model

Use dedicated Prisma models. Names can be adjusted to match existing conventions.

### Support configuration and taxonomy

```text
SupportConfiguration
SupportConfigurationVersion
SupportCategory
SupportQueue
SupportSlaPolicy
SupportCannedReply
SupportHelpArticle
SupportAnnouncement
```

### Player and agent access

```text
SupportAgent
SupportAgentQueue
SupportAgentStatus
SupportPermissionGrant
```

`SupportAgent` should reference the existing user, not duplicate player identity. Store status, level, capacity, last-seen time, and suspension/revocation metadata.

### Tickets

```text
SupportTicket
SupportTicketAssignment
SupportTicketStatusEvent
SupportTicketTag
SupportTicketInternalNote
SupportTicketRating
SupportTicketEscalation
```

Important ticket fields:

- ID and human ticket number.
- Player ID.
- Category and queue.
- Subject and sanitized initial description.
- Status and priority.
- Current agent ID.
- SLA due timestamps.
- Created, updated, resolved, closed, and reopened timestamps.
- Last player activity and last agent activity.
- Source app version and platform.
- Optional safe diagnostic snapshot ID.
- Idempotency key for ticket creation.

### Messages and attachments

```text
SupportConversation
SupportMessage
SupportMessageRead
SupportAttachment
```

A ticket may have a support conversation. A paid live chat should have its own conversation record linked to a `SupportLiveChatSession`.

Message fields should include:

- sender ID and sender kind (`PLAYER`, `AGENT`, `SYSTEM`);
- body and sanitized body;
- sequence number;
- moderation state;
- created and edited timestamps;
- read state handled by a separate participant/read model;
- client message ID for idempotency;
- optional attachment references;
- optional system event type.

### Live chat and billing

```text
SupportLiveChatSession
SupportLiveChatParticipant
SupportLiveChatCharge
SupportLiveChatRefund
SupportLiveChatEvent
```

Record:

- configuration version;
- quoted price;
- charged amount;
- currency;
- quote ID;
- wallet ledger transaction ID;
- refund ledger transaction ID;
- queue and agent assignment history;
- session duration and disconnect timestamps;
- reason for ending;
- rating and transcript retention deadline.

### Audit

```text
SupportAuditEvent
```

Audit agent access changes, ticket reads where required, assignment, replies, internal notes, exports, status changes, refunds, evidence access, and admin interventions.

Add indexes for player/status, queue/status, assignee/status, SLA due time, unread state, created time, and active live-chat sessions.

## 9. Backend API

All endpoints must require authenticated users and enforce capability checks server-side.

### Public/player endpoints

```text
GET    /support/configuration
GET    /support/summary
GET    /support/articles?query=&category=&cursor=
GET    /support/articles/:articleId
GET    /support/categories

POST   /support/tickets
GET    /support/tickets?status=&category=&cursor=&limit=
GET    /support/tickets/:ticketId
POST   /support/tickets/:ticketId/messages
POST   /support/tickets/:ticketId/attachments/presign
PATCH  /support/tickets/:ticketId/read
POST   /support/tickets/:ticketId/reopen
POST   /support/tickets/:ticketId/rate

POST   /support/live-chats/quote
POST   /support/live-chats
GET    /support/live-chats?status=&cursor=
GET    /support/live-chats/:sessionId
POST   /support/live-chats/:sessionId/messages
PATCH  /support/live-chats/:sessionId/read
POST   /support/live-chats/:sessionId/cancel
POST   /support/live-chats/:sessionId/end
POST   /support/live-chats/:sessionId/rate
```

### Support-agent endpoints

```text
GET    /support/agent/me
PATCH  /support/agent/status
GET    /support/agent/queue?queue=&status=&priority=&cursor=
POST   /support/agent/tickets/:ticketId/claim
POST   /support/agent/tickets/:ticketId/assign
POST   /support/agent/tickets/:ticketId/transfer
POST   /support/agent/tickets/:ticketId/messages
POST   /support/agent/tickets/:ticketId/internal-notes
PATCH  /support/agent/tickets/:ticketId/status
POST   /support/agent/tickets/:ticketId/escalate
GET    /support/agent/canned-replies

GET    /support/agent/live-chats
POST   /support/agent/live-chats/:sessionId/claim
POST   /support/agent/live-chats/:sessionId/messages
PATCH  /support/agent/live-chats/:sessionId/status
POST   /support/agent/live-chats/:sessionId/transfer
POST   /support/agent/live-chats/:sessionId/end
```

### System-admin endpoints

```text
GET    /system-admin/api/support/configuration
PATCH  /system-admin/api/support/configuration
GET    /system-admin/api/support/agents
POST   /system-admin/api/support/agents/:userId/grant
PATCH  /system-admin/api/support/agents/:userId
POST   /system-admin/api/support/agents/:userId/revoke

GET    /system-admin/api/support/tickets
GET    /system-admin/api/support/tickets/:ticketId
GET    /system-admin/api/support/tickets/:ticketId/messages
POST   /system-admin/api/support/tickets/:ticketId/assign
PATCH  /system-admin/api/support/tickets/:ticketId/status
POST   /system-admin/api/support/tickets/:ticketId/intervene
POST   /system-admin/api/support/tickets/:ticketId/refund

GET    /system-admin/api/support/live-chats
GET    /system-admin/api/support/live-chats/:sessionId
POST   /system-admin/api/support/live-chats/:sessionId/intervene
POST   /system-admin/api/support/live-chats/:sessionId/refund

GET    /system-admin/api/support/categories
POST   /system-admin/api/support/categories
PATCH  /system-admin/api/support/categories/:id
DELETE /system-admin/api/support/categories/:id
GET    /system-admin/api/support/queues
POST   /system-admin/api/support/queues
PATCH  /system-admin/api/support/queues/:id
GET    /system-admin/api/support/canned-replies
POST   /system-admin/api/support/canned-replies
PATCH  /system-admin/api/support/canned-replies/:id
GET    /system-admin/api/support/articles
POST   /system-admin/api/support/articles
PATCH  /system-admin/api/support/articles/:id
POST   /system-admin/api/support/retention/run
GET    /system-admin/api/support/reports
GET    /system-admin/api/support/audit
```

Use cursor pagination for queues and conversation history. Do not load all tickets or all messages into a single admin page.

## 10. Socket design

Use sockets for live updates only. HTTP remains authoritative for history, mutations, billing, and retry.

### Player socket events

```text
support.subscribe
support.unsubscribe
support.typing.start
support.typing.stop
support.read
```

Server-to-client events:

```text
support.message.created
support.message.accepted
support.message.removed
support.typing.changed
support.read.changed
support.ticket.updated
support.live-chat.assigned
support.live-chat.status-changed
support.agent.joined
support.agent.left
support.error
```

### Agent socket events

```text
support.agent.subscribe-queue
support.agent.unsubscribe-queue
support.agent.presence
support.agent.typing.start
support.agent.typing.stop
```

Agent queue events:

```text
support.queue.ticket-created
support.queue.ticket-updated
support.queue.live-chat-waiting
support.queue.agent-availability-changed
```

Socket authorization must verify the user is a ticket participant or has the exact support-agent/admin capability for the queue. Never allow a client to subscribe to an arbitrary ticket ID.

Handle reconnects by:

1. Re-authenticating the socket.
2. Re-subscribing only to authorized active conversations.
3. Fetching missed messages/events over HTTP using the last known sequence.
4. Rebuilding unread counts from the server.

## 11. Notification behavior

Use the existing durable notification inbox plus FCM/local notification delivery.

Notification types:

```text
support.ticket.created
support.ticket.assigned
support.ticket.message.received
support.ticket.status.changed
support.ticket.escalated
support.live-chat.queued
support.live-chat.assigned
support.live-chat.message.received
support.live-chat.ended
support.live-chat.refunded
support.agent.queue.alert
```

Examples:

- `Support replied to ticket SUP-2026-000123` — `We found the issue with your match reward...`
- `A support agent joined your live chat`.
- `Your live chat is ready`.
- `Your live chat payment was refunded`.
- `New support ticket waiting` for an authorized agent.

Use a dedicated high-importance support notification channel on Android, separate from friend chats. The notification body must contain a safe message preview, never raw attachment URLs, wallet internals, access tokens, or private staff notes.

When the player is actively viewing the conversation, suppress duplicate push notifications but keep the durable inbox event. Respect the global support notification setting and per-conversation mute settings.

## 12. Mobile Flutter implementation

### Domain layer

Add entities for:

- `SupportConfiguration`.
- `SupportCategory`.
- `SupportArticle`.
- `SupportTicket`.
- `SupportMessage`.
- `SupportAttachment`.
- `SupportLiveChatSession`.
- `SupportAgentProfile`.
- `SupportQueueEntry`.
- `SupportNotificationSummary`.

Add a `RailwaySupportService`, `SupportProvider`, and realtime support adapter. Keep support state separate from `ChatProvider`.

### Player screens

Suggested routes:

```text
/support
/support/articles/:id
/support/tickets/new
/support/tickets/:id
/support/live-chat/checkout
/support/live-chat/:id
```

Design language:

- Use the existing dark purple SMARTS surface.
- Use gold for free ticket/help actions and GLD prices.
- Use a distinct support blue/teal for agent online state.
- Show a clear `Free` label on ticket creation.
- Show the exact live-chat price before payment confirmation.
- Use status chips and timeline cards so players understand what is happening.
- Make unresolved tickets and unread replies visually prominent but not alarming.

### Agent screens

Only expose these routes after the backend returns the required capability:

```text
/support/agent
/support/agent/tickets/:id
/support/agent/live-chats/:id
/support/agent/settings
```

The agent composer should support public replies, internal notes, canned replies, attachments, and a clear mode indicator so an internal note cannot accidentally be sent to the player.

### Mobile notification routing

Notification routes should deep-link to the exact ticket or live-chat session. If the player is logged out or the route is opened before initialization, store the pending route and resolve it after authentication.

## 13. System-admin UI implementation

Create `SupportCenterView.tsx` and add it as an independent navigation entry.

### Overview dashboard

Show:

- Open tickets.
- Tickets past SLA.
- Waiting live chats.
- Active agents.
- Average first response time.
- Average resolution time.
- Live-chat conversion and refund rate.
- GLD collected, refunded, and net support revenue.
- Player satisfaction score.
- Top categories and recent escalations.

### Configuration page

Provide editable forms for:

- Enable/maintenance mode.
- Free ticket limits.
- Live-chat price, duration, queue limits, and refund rules.
- Message/attachment limits.
- SLA times.
- Notification behavior.
- Retention policies.

Use decimal-safe inputs for GLD prices. Validate on both UI and backend. Display the active configuration version and last editor.

### Agents page

Include:

- Search player.
- Grant/revoke support-agent capability.
- Assign level and queues.
- Set capacity.
- Suspend agent.
- Show current availability and active workload.
- Show permission history.

### Conversation management

Support staff should have a split view with queue, ticket metadata, messages, customer context, audit timeline, internal notes, and action controls. Destructive or financial actions require confirmation and reason.

## 14. Security, privacy, and abuse controls

- Enforce all permissions in NestJS guards/service methods.
- Use idempotency keys for ticket creation, messages, live-chat purchase, refunds, and status mutations.
- Sanitize text and attachments before persistence or display.
- Scan uploads for malware and reject executable/archive types.
- Avoid exposing direct private storage URLs; use short-lived authorized URLs.
- Redact access tokens, passwords, payment credentials, and security answers from support views.
- Rate-limit ticket creation, live-chat purchases, messages, and attachments.
- Detect repeated spam tickets and duplicate payment attempts.
- Allow players to report an agent reply.
- Allow agents to flag a player for abuse without exposing internal moderation details.
- Preserve moderation evidence under its own retention and permission policy.
- Log every staff read/intervention where legally or operationally required.
- Never include internal notes in push notifications, player exports, or player API responses.
- Use server time for SLA and billing calculations.
- Ensure a revoked agent loses socket access immediately or at the next authorization check.

## 15. Operational behavior

### Agent availability

Agents should send a heartbeat while marked available. The backend should automatically mark an agent offline after a timeout. Do not assign new live chats to stale agents.

### Queue assignment

Use an atomic claim operation so two agents cannot claim the same ticket/session. The recommended initial strategy is least-active eligible agent with a round-robin tie breaker.

### SLA timers

Store absolute due timestamps. A background worker should:

- mark tickets as overdue;
- notify supervisors;
- escalate according to policy;
- close inactive live chats after the configured timeout;
- trigger refunds when the no-agent guarantee expires;
- clean up expired attachments and eligible transcripts.

### Outages

If live chat is unavailable, hide or disable the paid action and explain why. Never charge GLD when session creation cannot be confirmed. Tickets should remain available during live-chat outages unless support is globally disabled.

## 16. Analytics and reporting

Track:

- Tickets by category, priority, source, and status.
- First response and resolution times.
- Reopen and escalation rates.
- Agent workload and response quality.
- Live-chat wait time and abandonment.
- Live-chat charge, refund, and net GLD totals.
- Article search success and deflection rate.
- Player rating and feedback.
- Notification delivery/open rates.
- Attachment failures and moderation outcomes.

Do not use message body contents as analytics identifiers. Use ticket/session IDs and event types.

## 17. Testing requirements

### Backend tests

- Player can create a free ticket.
- Ticket rate limits work.
- Only the owner, assigned agent, permitted supervisor, or permitted admin can access a ticket.
- Internal notes never appear in player responses.
- Agent cannot access another queue without permission.
- Two agents cannot claim the same ticket.
- Socket subscriptions reject unauthorized IDs.
- Message idempotency prevents duplicates.
- Live-chat quote expires correctly.
- Live-chat debit is atomic and idempotent.
- Insufficient GLD never creates an active paid session.
- Refund rules create compensating ledger transactions exactly once.
- No-agent timeout refunds according to configuration.
- Revoked agents lose access.
- Notification previews redact private data.
- Retention cleanup does not delete unresolved tickets or required evidence.

### Flutter tests

- Support entry appears in settings.
- Agent entry is hidden without capability.
- Ticket form validates category, subject, body, and attachments.
- Live-chat price comes from configuration, not a constant.
- Payment confirmation prevents accidental double tap.
- Reconnect restores unread state and missed messages.
- Ticket/live-chat notification deep links correctly.
- Internal-note mode is visibly different from public reply mode.
- Image and attachment previews do not expose raw private URLs.

### End-to-end tests

1. Player creates a ticket.
2. Support agent receives queue notification.
3. Agent claims and replies from mobile.
4. Player receives push/banner and sees the reply.
5. Player starts a 2 GLD live chat.
6. GLD ledger records one debit.
7. Agent accepts and both sides exchange socket messages.
8. Session ends, rating is recorded, and transcript is retained according to policy.
9. Simulated agent outage triggers configured refund behavior.

## 18. Recommended implementation phases

### Phase 1 — Free ticket foundation

- Prisma support ticket/message/category models.
- Configuration and category APIs.
- Player support center entry and ticket creation/history screens.
- Agent capability and basic system-admin agent management.
- Agent queue, claim, reply, status, and notification support.
- HTTP history and reliable message fallback.

### Phase 2 — Live chat and GLD billing

- Live-chat session and queue models.
- Configurable price defaulting to 2 GLD.
- Quote, debit, idempotency, refund, and audit flow.
- Socket messaging, typing, presence, reconnect, and read state.
- Agent mobile live-chat inbox.
- System-admin live-chat monitoring and billing/refund tools.

### Phase 3 — Knowledge base and operational maturity

- Help articles, FAQ search, suggested articles, and ticket deflection.
- Canned replies and category-specific forms.
- SLA worker, escalation rules, supervisor alerts, and agent capacity.
- Ratings, analytics, exports, audit viewer, and retention cleanup.
- Abuse detection, attachment scanning, and advanced reporting.

## 19. Definition of done

The support center is complete when:

- Every player can open and track a free ticket from profile/settings.
- Configured support agents can safely answer tickets from mobile and system admin.
- Players receive durable inbox notifications and push/banner notifications for replies.
- Live chat costs the configured amount, defaulting to 2 GLD, with atomic idempotent billing.
- Agents can be assigned, transferred, suspended, capacity-limited, and revoked.
- System admins control configuration, categories, queues, articles, price, SLAs, refunds, retention, and permissions.
- Support conversations use sockets for live updates and HTTP for history/recovery.
- Unauthorized users cannot read support conversations or internal notes.
- All staff actions and financial operations are auditable.
- Backend, mobile, socket, notification, billing, permission, retention, and system-admin tests pass.
