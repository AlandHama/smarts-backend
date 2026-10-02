# Friend-chat voice messages

Implement short voice messages in private and group friend chats. Keep the feature simple, lightweight, and compatible with the existing chat sockets, HTTP history, and Railway Object Storage bucket.

## Player experience

- Add a microphone button beside the chat composer.
- Press and hold to record.
- Show recording duration, waveform/level indicator, and a cancel gesture.
- Release to send the voice message.
- Swipe/cancel or tap cancel to discard it.
- Disable sending when microphone permission is denied.
- Show a playable voice-message bubble in the conversation with:
  - Play/pause button
  - Duration
  - Playback progress
  - Sender avatar/name using the existing single/group chat message layout
- Allow only one voice message to play at a time.
- In group chats, show the sender identity exactly like other group messages.

## Audio format and limits

- Record Opus audio in an `.ogg` or platform-supported container.
- Target 16–24 kbps voice quality to keep files small.
- Maximum duration: 60 seconds, configurable later if needed.
- Reject empty, corrupt, oversized, or unsupported files server-side.
- Store only audio metadata in PostgreSQL; never store audio bytes in the database.

## Storage

Use the existing Railway Object Storage bucket with a dedicated prefix:

```text
chat-voice/{conversationId}/{messageId}.ogg
```

- Keep the bucket private.
- Upload using a short-lived presigned URL.
- Download/play using a short-lived signed URL.
- Apply the existing chat retention policy, defaulting to 7 days.
- Delete expired objects and database metadata with the existing cleanup worker.
- Do not expose permanent public bucket URLs.

## Backend changes

Add a voice message type to the existing chat message model or message metadata:

- `type: VOICE`
- `storageFileId` or object key
- `durationMs`
- `byteSize`
- `mimeType`
- `expiresAt`

Add authenticated endpoints for:

```text
POST /chat/conversations/:id/voice/presign
POST /chat/conversations/:id/messages/voice
GET  /chat/messages/:id/voice-url
```

The server must verify that the sender belongs to the conversation, validate the uploaded object, enforce limits, and create the message transactionally. Use the existing socket event for the newly-created message so all participants see it immediately. HTTP history must return the same voice metadata for offline loading.

## Mobile Flutter changes

- Add recording permission handling for Android and iOS.
- Use the existing chat screen and composer; do not create a separate voice-chat screen.
- Add a hold-to-record microphone control.
- Upload through the backend presigned-upload flow.
- Render `VOICE` messages with a reusable voice bubble widget.
- Cache recently played audio locally when practical.
- Refresh signed URLs when they expire.
- Show upload, failed, retry, and expired-message states.
- Stop playback when leaving the chat or starting another voice message.

## Notifications and previews

- Push notification title: sender name or group name.
- Push/body text: `Sent a voice message`.
- Chat-list last-message preview: `Voice message`.
- Never expose the storage URL in notifications, chat previews, logs, or analytics.

## Security and abuse controls

- Require authenticated conversation membership for upload and playback.
- Validate MIME type, file signature, duration, and byte size on the backend.
- Apply rate limits per player and conversation.
- Scan or reject suspicious files where supported by the storage pipeline.
- Respect blocked users, muted conversations, deleted accounts, and moderation rules.
- Record sender, conversation, file, and deletion events in the existing audit path.

## Acceptance criteria

- A player can hold, record, release, and send a voice message.
- The recipient receives it live through the socket and sees it after reopening chat.
- Group members see the correct sender identity and can play it.
- Playback works from chat history after an app restart.
- Notifications and chat previews say `Sent a voice message`, never show a URL.
- Expired messages cannot be played and their objects are deleted after retention cleanup.
- Failed uploads can be retried without duplicate chat messages.
