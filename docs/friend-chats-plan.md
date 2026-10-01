# SMARTS Friend Chats — Implementation TODO

> Planning document only. This file describes the recommended implementation for
> friend-to-friend chat in the Railway NestJS backend, SMARTS Flutter app, and
> System Admin web console. No application code is implemented by this document.

## 1. Product goal

Add private, direct chat between accepted SMARTS friends with:

- durable message history;
- live delivery through the existing authenticated native WebSocket transport;
- HTTP history loading and reliable fallback when the socket is unavailable;
- online/offline state, typing indicators, read receipts, unread counts, and push notifications;
- configurable message retention, defaulting to seven days;
- complete System Admin control over policy, conversations, moderation, and retention;
- a safe design that works after Railway restarts and when the service runs on multiple instances.

The first release should be direct friend chat only. Group chats, global chat, voice,
video, and end-to-end encryption should remain out of scope until the direct-chat
moderation and retention workflows are proven.

## 2. Architecture decision

Use a hybrid transport:

```text
Flutter chat screen
       │
       ├── HTTP: conversation list, paginated history, read state, retry/fallback
       │
       └── WebSocket /ws: live messages, typing, presence, read receipts
                            │
                            ▼
                 NestJS chat module
                            │
                 PostgreSQL is authoritative
                            │
             optional Redis pub/sub + presence
```

### Backend transport

- Extend the existing `src/modules/realtime/realtime.gateway.ts` and its native
  `ws` protocol instead of introducing Socket.IO as a second realtime stack.
- Authenticate the socket with the existing access token and active session check.
- Keep PostgreSQL as the source of truth. A WebSocket event is never considered
  delivered until the message has been persisted successfully.
- Use Redis pub/sub when Railway has more than one backend replica. A socket on
  replica A must be able to deliver a new message created through replica B.
- Store presence in Redis with a short TTL if multi-instance presence is enabled;
  do not treat a stale database heartbeat as live chat presence.
- Never store chat message history in Redis. Redis is only for routing, ephemeral
  presence, and short-lived typing state.

### Why this is efficient

- HTTP handles bounded, cacheable, paginated reads and reliable retries.
- WebSocket handles only low-latency deltas and ephemeral state.
- The database is updated once per accepted message; the socket broadcasts the
  resulting server message to both participants.
- Reconnection is safe because Flutter reloads history using a cursor and then
  resumes socket subscriptions.
- A single-instance deployment can initially use the existing in-process gateway;
  Redis becomes required before horizontally scaling the backend.

## 3. Retention policy

Create a singleton `ChatConfiguration` controlled by System Admin.

Recommended fields:

- `enabled` — globally enable/disable player chat;
- `retentionDays` — default `7`, configurable within a safe range such as `1..365`;
- `maxMessageLength` — default `1000` characters;
- `maxMessagesPerMinute` — flood-control limit;
- `maxMessagesPerDay` — abuse and storage safeguard;
- `typingEnabled`;
- `readReceiptsEnabled`;
- `pushNotificationsEnabled`;
- `friendChatOnly` — initially always true;
- `allowLinks` — default false or restricted by moderation policy;
- `maintenanceMessage` — optional player-facing explanation when chat is disabled.

Retention rules:

1. Every message receives an immutable `expiresAt` calculated from the active
   retention policy when it is created.
2. Changing the policy affects new messages by default. System Admin may have an
   explicit action to apply the new policy to existing messages; never silently
   extend history.
3. A scheduled cleanup job deletes expired message bodies and attachments in small
   batches using an index on `expiresAt`.
4. Expired messages must disappear from mobile history and the admin chat viewer.
5. Conversation metadata such as the last-message timestamp may be retained for a
   short configurable operational period, but message content must not remain
   indefinitely.
6. Moderation evidence should be copied into a separately permissioned case/evidence
   record before deletion if the admin explicitly preserves a message for a report.
7. Cleanup must be idempotent, observable, and safe to resume after a restart.

Use a Railway scheduled job, NestJS scheduler, or existing worker mechanism for
cleanup. Do not rely on a player opening the app to perform deletion.

## 4. Database model TODO

Add a dedicated chat domain to Prisma. Do not place chat messages in notifications,
friends, or feedback tables.

### `ChatConfiguration`

Singleton policy row with the fields described above, plus `createdAt` and
`updatedAt`. All updates must be audited with the existing admin audit mechanism.

### `ChatConversation`

Direct-chat container:

- `id` UUID;
- `type` enum, initially `DIRECT_FRIEND`;
- `lastMessageAt`;
- `lastMessageId` nullable;
- `createdAt`, `updatedAt`;
- `archivedAt` nullable;
- unique canonical participant pair or a deterministic pair key.

Use a canonical pair key such as the lexicographically sorted user IDs so two
friends can never accidentally receive two direct conversations.

### `ChatParticipant`

Participant state:

- `conversationId`;
- `userId`;
- `lastReadSequence` or `lastReadMessageId`;
- `mutedUntil` nullable;
- `joinedAt`;
- unique `(conversationId, userId)`.

### `ChatMessage`

Server-authoritative message record:

- `id` UUID;
- `conversationId`;
- `senderId`;
- monotonic conversation `sequence`;
- `clientMessageId` for idempotent retries;
- `body`;
- `createdAt`;
- `expiresAt`;
- `editedAt` nullable;
- `deletedAt` nullable;
- `deletedBy` nullable;
- `moderationState` such as `VISIBLE`, `FLAGGED`, `REMOVED`;
- optional `metadata` JSON for safe non-content data only.

Recommended constraints and indexes:

- unique `(senderId, clientMessageId)`;
- unique `(conversationId, sequence)`;
- index `(conversationId, createdAt desc)`;
- index `(expiresAt)`;
- index `(senderId, createdAt)`;
- index `(moderationState, createdAt)` for admin review.

Do not trust a client-provided timestamp or sequence number.

### Optional attachments

If attachments are required later, add `ChatAttachment` with object-storage keys,
content type, byte size, checksum, scan status, and `expiresAt`. Never store raw
files in PostgreSQL or accept arbitrary public URLs. Attachment cleanup must follow
message retention.

### Moderation and audit records

Use dedicated records or the existing moderation domain for:

- player chat restrictions;
- message reports;
- moderator decisions;
- preserved evidence;
- immutable admin audit events.

## 5. Backend HTTP API TODO

Add a dedicated `src/modules/chats/` module with controller, service, DTOs,
transactions, retention worker, and admin controller.

### Player endpoints

```text
GET    /chats/configuration
GET    /chats/conversations?cursor=&limit=
POST   /chats/conversations              // get-or-create direct friend chat
GET    /chats/conversations/:id/messages?before=&after=&limit=
POST   /chats/conversations/:id/messages // reliable HTTP fallback/retry
PATCH  /chats/conversations/:id/read
PATCH  /chats/conversations/:id/mute
POST   /chats/conversations/:id/report
```

Rules for player endpoints:

- only accepted friends may create or access a direct conversation;
- both participants must be rechecked on every read and send;
- blocked, banned, suspended, or restricted players cannot send;
- return cursor-based pagination, never unbounded history;
- return normalized server messages with `sequence`, `createdAt`, `expiresAt`, and
  delivery state;
- use a consistent error code for `CHAT_DISABLED`, `NOT_FRIENDS`, `CHAT_RESTRICTED`,
  `MESSAGE_TOO_LONG`, `RATE_LIMITED`, and `MESSAGE_EXPIRED`;
- HTTP message creation must use the same transaction and idempotency rules as the
  WebSocket command.

### System Admin endpoints

```text
GET    /system-admin/api/chats/configuration
PATCH  /system-admin/api/chats/configuration
GET    /system-admin/api/chats/conversations?search=&status=&userId=&cursor=
GET    /system-admin/api/chats/conversations/:id/messages?before=&limit=
PATCH  /system-admin/api/chats/conversations/:id/status
POST   /system-admin/api/chats/messages/:id/remove
POST   /system-admin/api/chats/conversations/:id/restrict
POST   /system-admin/api/chats/conversations/:id/unrestrict
POST   /system-admin/api/chats/messages/:id/preserve
GET    /system-admin/api/chats/reports
GET    /system-admin/api/chats/retention/status
POST   /system-admin/api/chats/retention/run
```

Admin endpoints require the existing System Admin guard and granular permissions.
Every destructive or privacy-sensitive action needs a reason and an audit event.

## 6. WebSocket protocol TODO

Use the existing envelope:

```json
{
  "event": "chat.message.created",
  "data": {}
}
```

### Client commands

```text
chat.subscribe                  { conversationId }
chat.unsubscribe                { conversationId }
chat.message.send               { conversationId, clientMessageId, body }
chat.typing.start               { conversationId }
chat.typing.stop                { conversationId }
chat.read                       { conversationId, sequence }
chat.presence.subscribe         { userId }
```

### Server events

```text
chat.ready                      { conversationId, retentionDays }
chat.message.accepted           { message }       // sender acknowledgement
chat.message.created            { message }       // recipient/live delivery
chat.message.removed            { messageId, sequence }
chat.typing.changed             { conversationId, userId, typing }
chat.read.changed               { conversationId, userId, sequence }
presence.snapshot               { userId, state, lastSeenAt }
presence.changed                { userId, state, lastSeenAt }
chat.error                     { code, message, clientMessageId? }
```

Socket behavior:

- authorize conversation subscription before adding it to socket state;
- authorize every send, not only the initial subscription;
- persist first, then broadcast the accepted message;
- return the same message ID and sequence on duplicate `clientMessageId` retries;
- broadcast a message to both connected participants, but never to unrelated
  subscribed sockets;
- typing events are ephemeral, throttled, and automatically expire after roughly
  five seconds;
- read events update `ChatParticipant` and may be coalesced;
- send `pong` for connection health and close unauthorized/stale sessions safely;
- on reconnect, Flutter must use HTTP history to repair any missed events.

## 7. Notification behavior

Reuse the existing durable notification inbox and FCM adapter.

When a message is accepted:

1. Persist the chat message.
2. Create one durable notification for the recipient unless the recipient is the
   active sender/recipient chat session and has notifications muted for that chat.
3. Send FCM only as a delivery adapter when the recipient is offline or backgrounded.
4. Include a deep-link payload containing `conversationId` and `messageId`.
5. Deduplicate by a deterministic key such as `chat-message:{messageId}:{userId}`.
6. Never place the full message body in a notification if privacy settings or policy
   prohibit previews; support a configurable generic preview.
7. Tapping the notification opens the friend chat and fetches authoritative history.

Do not create a separate notification-only chat database. The inbox and FCM push
should point to the persisted chat message.

## 8. Flutter TODO

### Screens and navigation

- Add a Chats entry to the Friends area and, if appropriate, an unread chat badge.
- Add a conversation list screen with friend avatar, name, online state, last message
  preview, unread count, muted state, and retention indicator.
- Add a direct chat screen with message bubbles, timestamps, delivery/read state,
  typing indicator, online status, retry state, and an empty-state design.
- Add a chat entry from the friend profile and friends list.
- Open the exact conversation when a chat notification is tapped.

### Flutter state and data layer

- Add `RailwayChatService` for HTTP list/history/send/read/mute/report calls.
- Extend the existing realtime client/service rather than creating a second socket
  connection per chat screen.
- Maintain one authenticated app-level socket connection where possible.
- Add a chat repository/provider that owns conversation cache, message pagination,
  unread counts, pending messages, and connection state.
- Deduplicate by server `messageId` and `sequence`.
- Store pending outbound messages with `clientMessageId` until accepted or failed.
- Reconnect with exponential backoff and reload the affected conversation using HTTP.
- Pause typing and presence updates when the app is backgrounded.
- Do not persist expired message bodies locally beyond the configured retention
  window; purge cached expired messages on startup and on every conversation load.

### User interactions

- Send on button and keyboard action.
- Optimistic bubble with pending indicator, then replace it with the server message.
- Retry failed messages without creating duplicates.
- Long press message for copy/report, subject to policy.
- Long press conversation for mute/archive.
- Show a clear disabled/restricted state instead of a broken composer.
- Show retention text such as `Messages are kept for 7 days` using the server value.

## 9. System Admin Chats page TODO

Add a separate `Chats` navigation item and route, not a hidden section inside Friends
or Notifications.

### Configuration tab

Provide controls for:

- enable/disable player chat;
- retention days with validation and impact warning;
- max message length;
- per-minute and per-day rate limits;
- typing and read receipts;
- push notifications and preview policy;
- links and content policy;
- default maintenance message;
- manual retention cleanup and last-run status.

Show an explicit warning that shortening retention permanently removes older content
after cleanup. Save changes through the backend and show the effective server policy.

### Conversations tab

Provide:

- searchable conversation list by username, display name, player ID, or message ID;
- filters for active, reported, restricted, muted, and expiring conversations;
- participant online state and last active time;
- last message timestamp and unread/report indicators;
- paginated message viewer;
- retention expiry indicators;
- live refresh via admin socket if available, otherwise bounded polling;
- links to Player 360 for both participants.

### Moderation tab

Provide:

- reported messages and conversations;
- message removal with reason;
- preserve evidence with expiry or case reference;
- restrict chat for a player for a duration or permanently;
- mute one conversation;
- block/restrict both sides when required by an existing player moderation action;
- resolve/dismiss reports;
- immutable moderator notes and audit history.

Do not allow administrators to silently edit a player’s message. Removal should show
`Message removed by moderation` and preserve the audit trail.

## 10. Chat rules and safety

Initial player rules:

- chat is available only between accepted friends;
- blocking or removing a friend immediately prevents new messages;
- existing history remains subject to retention and moderation access rules;
- suspended/banned players cannot send or receive new chat messages;
- enforce message length, flood limits, duplicate-message limits, and payload size;
- sanitize/control URLs and reject unsupported control characters;
- use the existing content-filtering capability where suitable, but keep the server
  authoritative for enforcement;
- rate-limit reports so reporting cannot become a harassment tool;
- preserve the raw moderation evidence only under explicit admin action;
- never expose email, IP, device, token, or session data in player chat payloads;
- use least-privilege admin roles for viewing content and taking moderation action.

Recommended report categories:

- harassment or bullying;
- hate or threats;
- sexual or unsafe content;
- spam or scam;
- cheating solicitation;
- inappropriate link;
- other.

## 11. Presence and typing rules

- Reuse the existing presence concepts and authenticated WebSocket connection.
- Treat a user as online only while an authenticated socket or recent presence
  heartbeat is active; use a short TTL and a small grace period for mobile network
  transitions.
- Keep typing events out of PostgreSQL.
- Send typing at most once every few hundred milliseconds and stop after inactivity;
  the server should expire it automatically.
- Do not send FCM for typing or presence changes.
- Do not expose exact last-seen timestamps if a player’s privacy setting disables it.

## 12. Reliability and observability

Add metrics and structured logs for:

- messages accepted, rejected, rate-limited, removed, and expired;
- WebSocket connections, reconnects, authentication failures, and active sockets;
- message persistence latency and broadcast latency;
- FCM chat notification success/failure;
- retention cleanup duration, rows removed, and failures;
- duplicate client message retries;
- report volume and moderation resolution time.

Use correlation IDs across HTTP, WebSocket, notification, and admin actions. Never
log message bodies, access tokens, FCM tokens, or private attachments.

## 13. Implementation order

### Phase 1 — Durable direct chat

- Prisma chat models and migration.
- Chat configuration and System Admin configuration page.
- Friend authorization, rate limits, idempotent HTTP send/history.
- Flutter conversation list and chat screen with HTTP only.
- Retention cleanup job.

### Phase 2 — Live chat

- Extend the existing `/ws` gateway with chat subscriptions and message events.
- Flutter socket state, optimistic messages, acknowledgements, and reconnect repair.
- Typing indicators, online presence, read receipts, and unread counts.

### Phase 3 — Notifications and admin operations

- Durable inbox + FCM deep links for offline/background recipients.
- System Admin conversation viewer and Player 360 links.
- Chat restrictions, message reports, removal, evidence preservation, and audit logs.

### Phase 4 — Hardening

- Redis pub/sub and presence before multiple Railway replicas.
- Abuse/content controls, metrics, load tests, cleanup verification, and privacy review.
- Device/network testing for Xiaomi, Android background limits, reconnects, and token
  refresh behavior.

## 14. Acceptance criteria

- Two accepted friends can open one canonical direct conversation.
- A message sent over WebSocket is persisted once and delivered to the other user.
- A disconnected recipient receives the message from HTTP history and, when enabled,
  a durable inbox item/FCM push.
- Duplicate retries do not duplicate messages or notifications.
- Typing and online state are live but never stored as message history.
- Read state survives reconnects and device changes.
- A blocked/unfriended player cannot create or send in the old conversation.
- The configured retention period is visible to players and enforced by cleanup.
- Expired messages disappear from mobile and System Admin views.
- System Admin can configure policy, inspect conversations, moderate messages, apply
  restrictions, and see an audit trail.
- No chat content, tokens, or private device data appears in logs.
- The feature continues to function with the socket unavailable through HTTP fallback.

