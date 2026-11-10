# SMARTS Mobile System Administration Mode

## Status

Final implementation specification. Phases 1, 2, and 3 are implemented in the mobile app and backend.

## Objective

Add a secure system-administration mode inside the SMARTS Flutter app. An authorized administrator can discover the entry point by holding the existing Profile **Sign out** control, authenticate with the existing system-admin backend, and use a mobile-friendly administration workspace.

The workspace must feel like SMARTS, but it must be clearly separated from the player experience. It must expose the same operational areas already available in the system-admin web application: analytics, players, economy, GLD, rewards, notifications, support, game operations, configuration, content, audits, fraud, and infrastructure telemetry.

The mobile mode is an operational console, not a second player account. Entering it must never replace the player session or silently log the administrator in as a player.

## Scope

This specification covers:

- The hidden entry gesture and admin login flow.
- Admin session storage, refresh, expiration, persistence, and exit behavior.
- The mobile admin shell, navigation, visual language, responsive layouts, and localization.
- Mobile equivalents of every current system-admin web area.
- API mapping to the existing NestJS system-admin routes.
- Security, authorization, auditability, errors, offline behavior, accessibility, testing, and rollout.

This specification does not authorize:

- Changing the existing backend authorization model.
- Storing an administrator password on the device.
- Giving ordinary players access to system-admin data.
- Replacing the current system-admin website.
- Implementing Phase 2 or Phase 3 before the corresponding phase is approved.

## Three-phase delivery boundary

The original system-admin scope is deliberately split so each release is safe and independently usable.

### Phase 1 — Secure entry, session isolation, shell, and read-only overview

Phase 1 is complete when the mobile app provides:

- A long-press-only discovery path on Profile → Sign out while normal tap behavior remains unchanged.
- A localized administrator login sheet using the existing `POST /system-admin/api/auth/login` contract.
- Dedicated secure admin token storage and a separate admin API client using the existing refresh contract.
- No replacement, mutation, or clearing of the player session when entering or leaving admin mode.
- Persistent admin session restoration after app restarts, token refresh/expiration handling, exit, and local admin sign-out. The Control Center does not impose an inactivity lock or require a separate unlock step by default.
- A distinct SMARTS Control Center shell with admin identity, admin badge, drawer, overview navigation, refresh, and responsive cards.
- A server-authoritative, read-only Overview page backed by `GET /system-admin/api/overview`.
- Localized English, Arabic, Kurdish, and Turkish Phase 1 strings.
- No financial mutation, player mutation, configuration, support, fraud, analytics, game-operation, or other write controls exposed in Phase 1.

Phase 1 implementation files are limited to the mobile admin feature, its secure transport/session wiring, the profile entry point, and generated/localized strings. No new backend endpoint or database migration is required because the existing admin login, refresh, guard, and overview routes already satisfy this phase.

### Phase 2 — Read-only operational workspaces

Phase 2 is complete. The mobile Control Center now provides permission-gated, read-only pages for analytics, system resources, operations, players, Player 360, sessions, friends/presence, chats, audits, matches, Match 360, notifications, support, fraud review, and game-operation inspection. It uses the existing guarded NestJS routes, server-side aggregates, bounded list requests, filters, report selectors, telemetry process sorting, and refresh states. Phase 3 mutations are kept in a separate controlled workspace.

Phase 2 implementation uses the existing backend contracts; no database migration or new authorization path is required. The backend specification is updated here so the mobile and backend repositories share the same delivery boundary.

### Phase 3 — Controlled administration and mutations

Phase 3 is complete. The mobile Control Center now exposes an explicit, allow-listed mutation catalog grouped by the same operational domains as the web console: players and storage, progression, economy and wallets, GLD, leaderboards and ranking, game configuration and game-operation policy, content, daily operations, analytics automation, notifications, AdMob, paid/crypto rewards, commerce, referrals, support, chats, fraud, missions, streaks, settlement integrity, and cooperative operations.

Every mutation is sent through the existing guarded NestJS route family. The mobile UI requires target identifiers where applicable, validates JSON before submission, requires a human reason, shows a non-dismissible final confirmation, and disables duplicate submission. Mobile writes carry a stable `Idempotency-Key`; the backend interceptor reserves the key in the existing `IdempotencyKey` table, rejects a conflicting reuse, replays a completed response, and releases failed attempts for retry. A supplemental `POST /system-admin/api/mobile/mutation-audit` record stores the action, target, reason, source, path, sensitivity, and idempotency key without storing passwords, tokens, provider secrets, or private answer keys.

Phase 3 controls remain server-authorized: the allow-list is only a client navigation boundary and `SystemAdminGuard`, DTO validation, existing service authorization, and transaction-level audits remain authoritative. Secrets and file uploads are not accepted by the generic JSON mutation editor; those operations stay available through their existing dedicated web workflows.

## Existing system contracts

The backend already exposes a controller at `/system-admin`.

- `POST /system-admin/api/auth/login` accepts `{ identifier, password }`.
- `POST /system-admin/api/auth/refresh` rotates an admin refresh token.
- Admin data routes use the existing bearer access token.
- Protected routes use `SystemAdminGuard`, which requires the server-side authenticated principal to have `isSystemAdmin === true`.
- The client must treat the server response as authoritative. A local flag, email address, or hidden gesture must never grant access.

The system-admin website already defines the information architecture. The mobile app should reuse that domain model and endpoint behavior rather than inventing a separate administration backend.

## Entry and authentication flow

### Discoverable entry point

The normal Profile **Sign out** action must keep its current behavior when tapped normally.

When the control is held for approximately 1.2–1.5 seconds:

1. Show a short haptic confirmation and open the **System administrator access** sheet.
2. Do not sign the player out.
3. Do not display an admin affordance in the normal player navigation.
4. Cancel the gesture if the finger leaves the target before the hold duration.
5. Make the hold duration accessible and testable without relying on a precise frame timing.

The hold gesture is only a discovery mechanism. It is not a security boundary.

### Admin login sheet

Use the current SMARTS dialog language: dark navy/purple surface, rounded corners, gold or violet accent, clear icon, concise labels, and a visible loading state.

Fields:

- Email or administrator identifier.
- Password, obscured by default, with a show/hide affordance.

Actions:

- **Sign in to Control Center**.
- **Cancel**.

Do not offer a “remember password” option. If a future “keep this device unlocked” option is added, it must store only a revocable token in platform secure storage, never credentials, and must be disabled by default.

The dialog must show a generic authentication error such as “The administrator credentials could not be verified.” It must not reveal whether an email exists, whether the account is disabled, or which credential was incorrect.

Submit behavior:

1. Disable duplicate submission.
2. Call `POST /system-admin/api/auth/login` with `identifier` and `password`.
3. Store the returned admin tokens separately from player tokens.
4. Clear the password field immediately after the request completes.
5. Load the admin bootstrap data and open the admin shell only after authorization succeeds.
6. Keep the existing player session intact.

### Admin session separation

Use a dedicated admin auth scope in the mobile app:

- `AdminAuthRepository` or equivalent.
- Separate access and refresh token storage keys, for example `smarts.admin.access` and `smarts.admin.refresh`.
- Separate refresh and logout handling from player authentication.
- Separate API client headers/interceptors so an admin token cannot accidentally be sent to player-only endpoints and a player token cannot be sent to admin endpoints.
- Separate admin session state from `MainScreen` player state.

The app must never overwrite the player token when entering admin mode. Exiting admin mode returns to the same player screen and player session that was active before authentication.

### Persistence and exit

The admin shell must provide:

- **Exit admin mode**: returns to the player app without signing the player out.
- **Sign out admin**: clears admin access and refresh tokens, cached admin data, notification previews, and local admin navigation state.

After a successful login, persist the dedicated admin access and refresh tokens in platform secure storage and restore the session when the app is reopened. The mobile client must validate the restored session through the guarded backend before showing admin data. A revoked or expired session is cleared and requires a fresh login. The default admin access-token lifetime is 30 days and remains configurable through the backend environment; the refresh token remains revocable by the server.

## Mobile admin shell

### Shell structure

Do not reuse the six-item player bottom navigation while admin mode is active. The admin surface needs more than six destinations and must not visually imply that analytics, wallet mutation, or account bans are player features.

Use a responsive `AdminShell` with:

- A top app bar labeled **SMARTS Control Center**.
- An **ADMIN** badge and the signed-in administrator identifier.
- Unread admin-notification count.
- Exit control.
- A compact menu button on phones.
- A left rail or drawer on large phones, tablets, and landscape layouts.
- A breadcrumb or section title for deep pages.
- A page-level refresh action where data is live or cached.

On phones, the menu opens as a full-height grouped drawer. On tablets and landscape, keep the rail visible while the content page uses the remaining width. Avoid horizontal scrolling for primary controls.

### Visual language

Keep the SMARTS identity while making the mode unmistakable:

- Near-black/navy background with indigo panels.
- Purple/violet primary actions.
- Gold for economy and GLD values.
- Cyan for telemetry and healthy system status.
- Mint/green for successful operations.
- Amber for pending or caution states.
- Red only for destructive, blocked, fraudulent, or failed states.
- Rounded cards, compact metric tiles, restrained gradients, and readable typography.
- Use icons and labels together; do not rely on color alone.

Admin pages should be denser than player pages, but never turn into a desktop table squeezed into a phone. Convert tables into stacked cards, horizontal metric strips, expandable rows, and bottom sheets.

### Navigation groups

The following groups map to the existing system-admin website. Every listed area must be reachable from the mobile admin shell.

#### Command center

- Overview
- Analytics and reports
- Operations
- System resources

#### People and activity

- Players
- Player 360
- Sessions
- Friends and presence
- Chats
- Player audit history
- Matches
- Match 360

#### Economy and rewards

- Progressions
- Economy and currencies
- GLD economy
- Transactions
- Leaderboards
- Ranking
- Commerce
- Social gifts
- Paid rewards
- Crypto rewards
- Referrals

#### Content and live operations

- Game configuration
- Google authentication configuration
- App configuration
- Reward policies
- AdMob
- Notifications
- Missions and achievements
- Streaks
- Win streaks
- Daily challenge
- Daily hints
- Storage
- Feedback

#### Support and risk

- Support center
- Fraud and risk

#### Game operations

- Cooperative matches
- Gem Blitz
- Tile Rush
- Word Dash
- Domino

## Page specifications

The following pages are the mobile equivalents of the current system-admin views. Each page should retain the existing backend meaning and actions.

### Overview

Show a prioritized operational snapshot rather than every metric at once:

- Active players, new players, guest players, and suspended players.
- Matches in progress, completed matches, failed settlements, and matchmaking queue health.
- Daily GLD issued, GLD reserved, company profit, player reward requests, and crypto payout backlog.
- Daily revenue/profit trend.
- Pending admin notifications, suspicious-user count, open support cases, and failed jobs.
- Compact health status for API, database, storage, AdMob, and crypto provider.

Use swipeable metric cards and short charts. Every card opens the relevant detailed page.

### Analytics and reports

Support:

- Date range, country, game, mode, platform, guest/account, and cohort filters.
- KPI cards and charts.
- Player explorer.
- Data-quality report.
- Metric definitions.
- Saved reports.
- Scheduled reports.
- Analytics alerts and acknowledgement.
- CSV export and export-job status.

On mobile, use a filter sheet and collapsible chart sections. Large datasets must paginate or aggregate on the server. Never download an unbounded event table into the device.

### Operations

Show recent operational events, failed jobs, pending settlements, retryable actions, and deployment/runtime warnings. Each row must show timestamp, severity, entity, status, and request/correlation ID when available.

Provide safe retry actions only where the backend already exposes an idempotent retry. Require confirmation and a reason for manual retries.

### System resources

Show the existing live resource telemetry:

- Process memory and total memory.
- CPU usage.
- Network traffic.
- Database/storage health.
- Process list sorted by memory from highest to lowest.
- Recent resource samples and timestamps.
- Log-rate or dropped-log warning when provided by the backend.

Use a compact sparkline and a process card list. The page must make clear that values are server telemetry, not device memory.

### Players

Provide search, status filtering, pagination, and guest/account filters. Each row/card should include:

- Profile picture when available, otherwise the normal SMARTS avatar fallback.
- Display name, identifier, and guest indicator.
- Status.
- Level/XP and ELO.
- Session count or last seen.
- Created date.
- Quick actions: open Player 360, suspend/restore, and overflow actions.

Do not expose sensitive values in list cards. Load full details only after opening Player 360.

### Player 360

Use a large profile header with avatar, account state, guest badge, locale/country, joined date, and last seen. Organize details into tabs or expandable cards:

- Identity and profile.
- Progression and cognitive skills.
- Wallet and ledger summary.
- Sessions and devices.
- Friends, presence, and requests.
- Matches and rematches.
- Referrals.
- Storage items and uploaded files.
- Immutable audit history.

Available actions must include only backend-supported actions: edit profile, update status, reset password, adjust progression, reset cognitive stats, rebuild stats, inspect wallet, credit/debit/reverse with confirmation, manage friends, unlink Google identity, manage storage, and delete/disable account where permitted.

### Sessions

Show active and historical sessions with device/platform, IP or coarse location if the backend supplies it, created/last seen time, and revocation state. Allow revoking an individual session after confirmation.

### Friends, presence, and chats

Show relationship state, pending requests, blocked users, online/last-seen state, and support/live-chat context. Keep player messaging content privacy-conscious and paginate it. Do not place destructive relationship actions behind a swipe with no confirmation.

### Player audits

Show append-only events with actor, action, entity, timestamp, request ID, and before/after summary. The mobile page may filter and inspect records but must not edit or delete audit entries.

### Matches and Match 360

Matches must support filters for game, mode, status, player, date, and settlement state. Match 360 should show participants, rounds, event timeline, result, rewards, rematch, and settlement/audit information. Game-specific private answer keys or anti-cheat secrets must never be returned to the mobile admin client unless the existing admin web contract explicitly permits it.

### Progressions

Show progression definitions, tiers, thresholds, rewards, ordering, and active state. Support the existing create/update/delete operations. User-specific award and reset actions require a reason, confirmation, and audit entry.

### Economy and currencies

Show currencies, balances, policy values, transaction totals, and ledger health. Currency definitions and policy edits require a review sheet showing current and proposed values before saving.

### GLD economy

Show:

- Reserve balance and reserve ratio.
- Circulating GLD.
- Player GLD returned to the economy.
- Company profit allocation.
- Ad revenue and reward margin.
- Daily caps, validated ads, reward limits, and policy settings.
- Reconciliation/history and backing entries.
- Price simulation without mutating live state.

Keep simulations visually separate from live mutations. Every live backing, reconciliation, recalculation, or policy change requires explicit confirmation.

### Transactions

Support transaction search, filters, detail view, ledger entries, reversals, and export where available. Never present a client-side balance calculation as authoritative; display server-confirmed balances and transaction IDs.

### Leaderboards and ranking

Show season state, country/player/friend views, reset times, top players, and rebuild status. The mobile admin view should make country contributions distinct from a player’s all-country total. Rebuild and score-application operations require confirmation and progress feedback.

### Commerce, social gifts, and inventory

Expose catalogs, items, assets, redeem codes, purchases, entitlements, grants, revocations, and social gifts. Show item art using the same image URL rules as the player app. Grant/revoke actions must show the target, item, quantity, reason, and resulting server response before completion.

### Paid rewards and crypto rewards

Separate pending, approved, submitted, verified, rejected, and failed states. Show provider health, request history, reconciliation status, wallet/address details as permitted, and fraud flags. Approve, submit, verify, and reject actions must be step-up confirmed and idempotent.

### Referrals

Show referral configuration, player overrides, referral links/codes, attributed signups, qualification state, and reward status. Changes must display the effective configuration and whether existing referrals are affected.

### Game configuration

Show game/mode settings, enabled state, bot matchmaking settings, wait times, reward policies, and content configuration. Save changes through a review sheet with current value, new value, affected games/modes, and effective time.

### Game-specific operations

Each game page must retain the relevant web actions and present them as mobile cards:

- **Cooperative matches:** lobby and cooperative-match operations.
- **Gem Blitz:** policy, rollback, and operations.
- **Tile Rush:** policy, rollback, operations, analytics, replay, retry settlement, and review.
- **Word Dash:** policy, rollback, operations, analytics, replay, and retry settlement.
- **Domino:** policy, rollback, operations, analytics, replay, retry settlement, and finalize settlement.

Game pages must show game, mode, match ID, players, turn/round state, settlement state, timestamps, and server error details. Rollback and settlement actions require confirmation and an audit reason.

### Google authentication, app configuration, reward policies, and AdMob

Provide read/update screens for:

- Google authentication settings.
- General app configuration and feature flags.
- Ad reward policies and limits.
- AdMob connection state, sync, and disconnect.

Secrets must be masked. Never return or persist provider credentials in Flutter logs, analytics, screenshots, or local caches.

### Storage, feedback, notifications, and fraud

- **Storage:** inspect storage records, file metadata, URLs where allowed, upload/delete operations, and storage health.
- **Feedback:** list, filter, inspect, update status, and respond/resolve where supported.
- **Notifications:** show admin alerts, broadcasts, read/unread state, resolution state, and push status. Support sending a broadcast only after audience, language, and content confirmation.
- **Fraud and risk:** show suspicious users, signals, reward anomalies, ad abuse, duplicate accounts, and review state. Do not show raw fraud heuristics to an unprivileged administrator.

### Missions, achievements, streaks, daily challenge, and daily hints

Provide the existing configuration and operational controls for:

- Missions and achievements.
- Streaks and win streaks.
- Daily challenge configuration, generation, challenge inspection, and publish.
- Daily hint pool/list, localized content, active state, and delivery/archive state.

Daily hint management must follow the current pool design: administrators manage a list of multilingual hints; the server selects a daily hint. The mobile admin page must not require creating a separate date record for every day unless the backend contract explicitly returns one.

### Support center

Show support tickets/live chats, requester, language, status, assignee, priority, timestamps, unread state, and conversation history. Allow an agent/admin to assign, reassign, reply, resolve, and reopen only where the existing support contract allows it. Push notification behavior for new requests belongs to the backend/mobile notification implementation and must not be assumed to be solved by polling alone.

## Backend API mapping

The future mobile repository should wrap the existing routes below. Route names are grouped for readability; all protected routes require the system-admin bearer token.

| Mobile area | Existing route family |
|---|---|
| Authentication | `POST /system-admin/api/auth/login`, `POST /system-admin/api/auth/refresh` |
| Overview and telemetry | `GET /system-admin/api/overview`, `GET /system-admin/api/system/resources` |
| Analytics | `GET /system-admin/api/analytics`, `GET /analytics/export.csv`, `GET /analytics/reports/:key`, player explorer, data quality, definitions, saved reports, scheduled reports, alerts, alert acknowledgement, export jobs |
| Daily challenge | `GET/PATCH /api/daily-challenge/configuration`, challenge list/detail, generate, publish |
| Daily hints | `GET/POST/PATCH/DELETE /api/daily-hints` |
| App and ads | `GET/PUT /api/app-config`, AdMob connect/callback/status/sync/disconnect |
| GLD | `GET /api/gld`, recalculate, history, simulate, backing, revenue/materialize, reconcile, controls, ad reward policies |
| Operations and audits | `GET /api/operations`, `/api/audit`, `/api/player-audits` |
| Users | user/admin creation, sessions, users, Player 360, player audits, profile, storage, files, password reset, status, deletion |
| Progression | progression definitions, tiers, rewards, user award/reset, top players |
| Economy | currencies, transactions, transaction detail, wallet detail, credit/debit/reverse |
| Competition | leaderboards, seasons, score application, rebuilds, top players, ranking |
| Notifications | push status, broadcasts, admin notifications, read/resolve, broadcast send |
| Content and reward policy | Google auth config, game content, JSON import, reward policies, ad reward claims, paid reward requests |
| Crypto | config, requests, provider health, request state changes, approval/submission/verification/reconciliation |
| Commerce | catalogs, assets, redeem codes, items, purchases, inventory, entitlements, grants/revokes |
| Social | gifts, friends, feedback, referrals, referral configuration/overrides |
| Files and storage | upload, file URL, delete, storage listing |
| Game administration | cooperative, Gem Blitz, Tile Rush, Word Dash, and Domino policy/rollback/operations; supported games additionally expose analytics, replay, review, retry, or finalize settlement routes |

The implementation must verify exact DTOs and response shapes from the backend before coding. Do not infer a route response from a web component’s local type. If the mobile UI needs a cross-page aggregate, prefer a server-side aggregate/bootstrap endpoint over issuing dozens of unbounded requests from a phone.

## Mobile architecture proposal

Add a separate admin feature boundary rather than embedding admin state throughout the player screens:

- `AdminAuthState` for login, restore, refresh, exit, and sign-out.
- `AdminApiClient` or a scoped client that adds the admin bearer token.
- `AdminRepository` grouped by domain: overview, analytics, users, economy, rewards, content, support, and games.
- `AdminShell` with a strongly typed section/navigation model.
- Per-page providers/controllers with explicit loading, stale, error, and permission states.
- Shared admin widgets: metric tile, status pill, dense list card, filter sheet, confirmation sheet, audit preview, empty state, retry state, and chart container.

Do not place admin API calls directly in `build()` methods. Cancel or ignore responses after a page is disposed. Do not show a snackbar or dialog using a deactivated `BuildContext`; surface action results through page-owned state or a mounted check.

## Security requirements

The following are mandatory:

1. The backend remains the authority for admin access. The client must handle `401` and `403` distinctly.
2. Store tokens only in platform secure storage. Never store passwords.
3. Keep admin tokens separate from player tokens and never include them in player analytics.
4. Redact authorization headers, passwords, provider secrets, crypto addresses where sensitive, and personal data from logs.
5. Refresh at most once after a `401`; if refresh fails, clear admin state and require login.
6. Restore the dedicated admin session after an app restart and show a login prompt only when the stored session is missing, expired, revoked, or invalid.
7. Require an explicit confirmation and reason for bans, deletes, wallet mutations, GLD actions, reward approvals, crypto actions, rollbacks, settlement retries, config changes, broadcasts, and file deletion.
8. Show the target, current value, proposed value, and expected impact before a destructive or financial action.
9. Use server-side idempotency for money, reward, settlement, and retry operations. Disable duplicate taps while pending.
10. Every mutation must produce an audit record containing administrator ID, target, action, reason, request ID, and before/after values where supported.
11. Do not assume the hidden hold gesture provides secrecy. Add server roles/permissions if the backend later supports more than one administrator class.
12. Consider `FLAG_SECURE`/equivalent screen-capture protection for sensitive admin pages, subject to product approval.

## Loading, errors, and offline behavior

- Use skeleton cards for first load and preserve the last safe view while refreshing.
- Label stale data with the last successful update time.
- Provide retry at page and request level.
- On offline mode, allow read-only display of explicitly cached, non-sensitive summaries only; do not queue financial or destructive mutations silently.
- On `401`, refresh once, then return to the admin login flow only if the refresh token is invalid or revoked.
- On `403`, show “You do not have permission for this area” and hide mutation controls.
- On `409`, show the server conflict and reload the authoritative record.
- On rate limiting, show a retry-after message and avoid aggressive polling.
- Poll live telemetry at a conservative interval and stop polling when the page is not visible.

## Localization and accessibility

All new strings must use the existing localization system for English, Arabic, Kurdish, and Turkish.

- Support RTL layout and verify drawer, charts, tables, icons, and back navigation in RTL.
- Localize dates, numbers, currencies, percentages, and relative times.
- Use semantic labels for charts and action icons.
- Maintain sufficient contrast for status colors.
- Provide minimum touch targets of 44–48 logical pixels.
- Do not encode meaning using color alone.
- Support large text without clipping titles such as “System resources” or “Paid reward requests”.

## Phase 1 acceptance criteria

Phase 1 is considered complete only when:

- Normal tap on Profile → Sign out keeps the existing player sign-out flow.
- Holding Profile → Sign out opens the localized admin login sheet without signing out the player.
- The login request uses `identifier` and `password` at `/system-admin/api/auth/login`.
- Incorrect credentials show a generic error and never expose admin content.
- Admin access and player access use separate secure token stores and separate API clients.
- The admin refresh path uses `/system-admin/api/auth/refresh` and retries a protected overview read once after a valid refresh.
- A successful login loads the server overview before showing the authenticated shell.
- Entering, restoring, exiting, or signing out admin mode never replaces or clears the player session.
- Closing and reopening the app preserves the admin session without requiring another login while the backend session remains valid.
- The shell provides the admin identity, ADMIN badge, exit, refresh, drawer, and responsive read-only overview cards.
- The overview reads server-owned counts from `GET /system-admin/api/overview` and exposes no Phase 2/3 mutation controls.
- English, Arabic, Kurdish, and Turkish strings are generated and used by the Phase 1 UI.
- Static analysis reports no Phase 1 errors, and the focused Railway API client test passes.

## Phase 2 acceptance criteria

Phase 2 is considered complete only when:

- The admin session remains isolated from the player session and all data requests use the dedicated admin client.
- Overview, analytics, resources, operations, players, Player 360, sessions, friends/presence, chats, audits, matches, Match 360, notifications, support, fraud, and game operations are reachable from the mobile admin shell.
- Each page reads from the existing authenticated NestJS system-admin endpoint family and handles loading, refresh, empty, error, 401, and 403 states.
- Analytics exposes report filters, KPI values, trend samples, quality checks, definitions, player explorer, saved/scheduled reports, and alert history without mutation controls.
- System resources displays server memory, CPU, network, health samples, and processes sorted by resident memory.
- Players show bounded search/status results, guest state, level/ELO, last-seen/session context, and profile pictures where the server supplies them.
- Player 360 and Match 360 open only after selecting a server-provided UUID and display the returned server-owned details without private answer-key fabrication.
- Sessions, friends, chats, audits, notifications, support, and fraud are read-only and bounded; no reply, assignment, ban, resolve, delete, broadcast, or rule action is exposed.
- Game operations covers cooperative, Gem Blitz, Tile Rush, Word Dash, Domino, Bomb Path, and Perfect Timing read-only policy/operations data using the existing guarded controllers.
- The Phase 3 Control Center is reachable as an enabled, grouped mutation workspace; every exposed command maps to an allow-listed existing backend route and no arbitrary method or URL can be entered.
- Static analysis reports no Phase 2 compile errors and the focused admin transport tests remain green.

## Final acceptance criteria (after Phase 3)

The implementation is complete only when:

- Holding Profile → Sign out opens the admin login flow, while a normal tap retains normal sign-out behavior.
- Correct admin credentials enter the Control Center without replacing the player session.
- Incorrect credentials do not disclose account details and do not expose admin content.
- Admin access and player access use separate tokens, clients, state, and logout paths.
- Token refresh, expiration, persistence, exit, and admin sign-out all behave correctly.
- The admin shell is clearly distinct from the player shell and works on portrait, landscape, and tablet layouts.
- Every system-admin web area listed in this document has a mobile destination or a documented permission-gated empty state.
- Existing backend routes are used with server-authoritative responses.
- All financial, destructive, configuration, reward, and settlement actions have confirmation, idempotency, and audit handling.
- Mutation requests from mobile use a database-backed idempotency reservation and completed-response replay; duplicate keys with a different request hash are rejected.
- Every mobile mutation has a required operator reason and a supplemental mobile-origin audit record; sensitive request bodies are never written to that record.
- Player pictures, guest indicators, country/locale, and sensitive data follow the same privacy rules as the web console.
- Admin notifications, support requests, fraud alerts, and pending rewards are visible without excessive polling.
- All strings are localized and RTL-safe.
- No admin credentials or tokens appear in logs, analytics, crash reports, or screenshots.

## Testing plan

### Unit tests

- Hold gesture timing, cancellation, and normal tap behavior.
- Admin token storage and separation from player tokens.
- Refresh-once behavior and expiration cleanup.
- Navigation permissions and section grouping.
- Confirmation requirements for sensitive actions.
- Number/date/currency formatting and RTL labels.

### Widget tests

- Admin login sheet validation and loading state.
- Admin shell drawer/rail and responsive layouts.
- Overview metric cards and stale state.
- Filter sheets, dense rows, confirmation sheets, and error states.
- Restored admin state after an app restart and expired/revoked-session handling.
- Exit admin mode preserving the player screen.

### Integration and contract tests

- Login, refresh, `401`, `403`, `409`, rate limit, and network failure flows.
- A representative read and mutation from every navigation group.
- No player token sent to `/system-admin/*` and no admin token sent to player-only routes.
- Pagination and server-side filters for players, matches, audits, transactions, notifications, and analytics.
- Idempotency for reward, wallet, crypto, rollback, and settlement operations.

### Security tests

- Non-admin credentials cannot enter the shell.
- A forged local admin flag does not unlock content.
- Tokens are not present in ordinary logs or analytics payloads.
- Admin state is cleared on explicit admin sign-out and failed refresh.
- Admin access is cleared when the backend rejects the stored session.
- Destructive actions cannot be triggered twice by repeated taps.

## Rollout plan

Use a server-controlled feature flag, disabled by default in production. Enable it only for a small administrator allowlist first.

Suggested phases:

1. Internal development build with mock data and a non-production admin account.
2. Production read-only access for one administrator.
3. Read-only access for the administrator group.
4. Carefully enable low-risk mutations.
5. Enable financial, reward, crypto, settlement, and destructive operations only after audit and idempotency verification.

The mobile admin feature must remain removable or disableable through configuration without requiring a player-app release.

## Current implementation boundary

The current code implements all three phases. Phase 3 adds the mobile allow-listed mutation workspace, the backend mobile-origin audit endpoint, and database-backed idempotency enforcement using the existing `IdempotencyKey` model; it adds no database migration. The existing guarded routes, DTO validation, service authorization, transaction audits, and web console remain unchanged as the authoritative control plane.
