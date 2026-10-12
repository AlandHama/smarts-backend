# SMARTS Facebook Login and Facebook Friend Sync

## Status

Implementation specification only. This document does not implement the feature.

Target repositories:

- Backend: `/home/aland/Documents/GitHub/nestjs-railway-starter`
- Flutter mobile app: `/home/aland/Documents/GitHub/smarts/smarts`

The implementation must reuse the existing SMARTS authentication, session, Prisma, friend, audit, fraud, and Railway API patterns. It must not create a second authentication system or a second friend system.

## Important Meta platform limitation

SMARTS cannot import a user's complete Facebook friend list. Meta's `user_friends` permission and `/me/friends` connection expose only friends who also use and authorized the same SMARTS Facebook app. Facebook friends who have not authorized SMARTS must not be created as SMARTS accounts, stored as identifiable friend records, or represented as confirmed SMARTS friendships.

The product requirement therefore becomes:

1. A player signs in with Facebook or links Facebook to an existing SMARTS account.
2. SMARTS requests `user_friends` with a clear explanation of the friend-sync feature.
3. The mobile app obtains the Facebook user access token and sends it to the SMARTS backend over TLS.
4. The backend verifies the token for the SMARTS Meta App ID, fetches the authorized SMARTS-visible Facebook friends, and matches them to SMARTS accounts by the same app-scoped Facebook user ID.
5. Matching SMARTS accounts are automatically added as accepted SMARTS friendships, subject to blocking, privacy, consent, and idempotency rules.
6. Facebook friends who are not SMARTS users are shown only as an optional invite opportunity where Meta permits it; they are not imported into the friend graph.

References:

- [Meta Facebook Login](https://developers.facebook.com/docs/facebook-login/)
- [Meta Graph API User/Friends reference](https://developers.facebook.com/docs/graph-api/reference/user/friends/)
- [Meta Facebook Login permissions](https://developers.facebook.com/docs/permissions/reference/)
- [Meta Facebook Login security](https://developers.facebook.com/docs/facebook-login/security/)
- [Meta app creation](https://developers.facebook.com/docs/development/create-an-app/)
- [Meta Platform Terms](https://developers.facebook.com/terms/)
- [Meta Platform Policies](https://developers.facebook.com/devpolicy/)

Meta documentation and App Dashboard requirements can change. Before implementation, confirm the currently displayed permission access level, review requirements, SDK compatibility, and policy wording in the SMARTS Meta app.

## Existing SMARTS integration points

### Backend

The existing backend already has:

- `src/modules/auth/auth.controller.ts`
  - `POST /auth/login`
  - `POST /auth/register`
  - `POST /auth/google`
  - `POST /auth/google/link`
  - `DELETE /auth/google/link`
- `src/modules/auth/services/google-auth.service.ts`
- Google identity transactions under `src/modules/auth/transactions/`
- Prisma `User`, `ExternalIdentity`, `Friendship`, `FriendRequest`, and `FriendBlock` models
- `src/modules/friends/friends.service.ts` and `friends.controller.ts`
- player audit and fraud services
- rotating SMARTS access/refresh sessions through `TokenService`

Facebook must follow the same response shape, session issuance, account-linking rules, audit trail, and error handling as Google. Facebook must not issue or accept SMARTS JWTs directly from the mobile client.

### Flutter mobile

The existing SMARTS app already has:

- `lib/infrastructure/railway/railway_auth_service.dart`
- `lib/presentation/widgets/google_account_link_tile.dart`
- `lib/infrastructure/railway/railway_friends_service.dart`
- friends repository/provider and friend UI flows
- `google_sign_in` as the existing social-login example
- centralized dependency injection and token storage

Facebook Login should be added beside the Google flow, using the same Railway API client and session coordinator. Do not place the Meta App Secret, client secret, or any backend credential in Flutter.

## Product behavior

### Sign-in

The login screen receives a `Continue with Facebook` action.

On success:

- Existing Facebook identity → sign in to its linked SMARTS user.
- No Facebook identity but a verified matching email exists → do not silently merge accounts. Require an authenticated/account-recovery confirmation flow before linking, or require the user to sign in to the existing SMARTS account and use Facebook account linking.
- No matching identity/account → create a SMARTS player using the verified Facebook profile data permitted by the granted scopes.
- Banned, inactive, deleted, or restricted SMARTS users remain blocked by the same account-status rules as password and Google login.
- Issue the normal SMARTS access/refresh token pair and session record.
- After session establishment, start friend synchronization asynchronously. Login must not fail merely because friend synchronization is unavailable.

### Link Facebook to an existing account

The profile/account-security area receives:

- Facebook link status
- Link Facebook action
- Unlink Facebook action, subject to account recovery safeguards
- Friend sync status and last successful sync time
- A clear explanation that only Facebook friends who also use SMARTS can be matched
- An option to disable automatic future Facebook friend synchronization

Linking must require an authenticated SMARTS session. A Facebook identity already linked to another SMARTS user must return a conflict and must never be transferred automatically.

### Automatic friend synchronization

After Facebook login or link, and on an explicit refresh:

1. The client requests the Facebook access token with `public_profile`, `email` where available, and `user_friends`.
2. The client sends the token to the backend’s Facebook sync endpoint.
3. The backend verifies the token and its audience before calling Graph API.
4. The backend requests only the fields needed for matching and display, such as Facebook app-scoped ID, display name, and profile picture where permitted.
5. The backend resolves returned Facebook IDs to SMARTS users through `ExternalIdentity(provider = FACEBOOK)`.
6. The backend creates a two-row accepted friendship for each eligible match in one idempotent transaction.
7. Existing friendships, blocked users, self matches, deleted users, and duplicate results are skipped safely.
8. The backend returns counts and non-sensitive status categories, not raw Facebook friend data or access tokens.

Friend sync must be bounded and rate-limited. It must not run on every foreground rebuild, every page open, or every API request. Suggested initial policy:

- Automatic sync after a new Facebook login/link.
- At most once per 6 hours per user unless the player explicitly taps Refresh.
- Explicit refresh rate limited to once per minute and protected by a server-side idempotency key.
- A background retry may retry transient Graph failures with exponential backoff, but must stop after a bounded number of attempts.

### Friend removal semantics

Do not remove a SMARTS friendship merely because a later Facebook response does not contain the friend. The Facebook list may be incomplete, permission may be missing, or the friend may be temporarily unavailable. Facebook-originated friendships should be marked with their source and remain until:

- the player explicitly removes the friend;
- either player blocks the other;
- both accounts unlink/revoke Facebook and the product policy says to remove Facebook-originated friendships; or
- an explicit, reviewed reconciliation policy confirms the relationship is no longer valid.

The first implementation should use additive synchronization only. This prevents accidental mass deletion of SMARTS friends.

## Meta setup checklist

Perform these steps in the Meta for Developers dashboard before implementation testing.

### 1. Create or select the Meta app

1. Open [Meta for Developers](https://developers.facebook.com/).
2. Create a new app using the current consumer/app category appropriate for SMARTS, or use an existing SMARTS app only after confirming it has no conflicting production products.
3. Record the Meta App ID.
4. Generate or record the Client Token.
5. Keep the App Secret only in Railway/backend secret storage. Never commit it or ship it in Flutter.
6. Set the app display name, contact email, privacy policy URL, terms URL, and app icon.
7. Keep the app in Development mode while integration is being tested. Add internal testers/developers through App Roles; they must authorize the app before appearing in development results.

### 2. Add Facebook Login

1. Add the Facebook Login product to the Meta app.
2. Configure the native Android and iOS platforms.
3. Configure the web product only if SMARTS will support browser login or a web OAuth fallback. Do not add arbitrary redirect URLs.
4. Enable only the permissions needed by the approved UX:
   - `public_profile`
   - `email`, if email-based account recovery/linking is required and the user grants it
   - `user_friends`, only for the SMARTS “find friends who also use SMARTS” feature
5. Do not request permissions for contacts, birthdays, user likes, groups, pages, or other data that the feature does not need.

### 3. Android platform configuration

In Meta App Dashboard → Settings → Basic → Add Platform → Android, configure every build identity that can call the app:

- Package name: exact SMARTS Android `applicationId`.
- Class name: the Flutter Android launcher activity required by the current Facebook SDK/plugin.
- Key hashes for:
  - local debug signing;
  - internal/release signing;
  - Google Play App Signing certificate;
  - any separate CI or flavor signing key.
- Google Play package/store details if requested by the dashboard.

The plan must record the final package name and hashes in the team’s secret/configuration inventory, but must not commit signing secrets. Test both the installed APK/AAB and the Play-signed build because key-hash mismatches commonly produce device-specific login failures.

Flutter Android setup must include the current Facebook SDK/plugin-required manifest metadata, app ID, client token, package visibility declarations if required by the SDK, and the correct activity/redirect handling. Use the plugin’s current official setup instructions rather than copying deprecated SDK snippets.

### 4. iOS platform configuration

In Meta App Dashboard → Settings → Basic → Add Platform → iOS, configure:

- exact bundle identifier for every flavor/environment;
- iPhone/iPad support as applicable;
- iOS app store ID after release;
- URL scheme `fb{META_APP_ID}`;
- Client Token and App ID in the app configuration;
- any current SDK-required LSApplicationQueriesSchemes entries;
- Facebook Login redirect/deep-link settings required by the current SDK.

The Flutter iOS project must configure the current AppDelegate/Info.plist/URL handling for the chosen Facebook Login plugin. Test cold-start callback handling, an installed Facebook app, no installed Facebook app, cancellation, and a previously authorized account.

### 5. Privacy, deletion, and live mode

Configure before requesting production access:

- Privacy Policy URL, describing Facebook identity data, friend matching, retention, and deletion.
- User Data Deletion callback URL or current Meta-required deletion mechanism.
- Data deletion instructions that delete Facebook identity records, stored Facebook tokens, sync metadata, and any Facebook-derived friend-link records according to the retention policy.
- Terms of Service URL and support/contact URL.
- Accurate app category, age/audience declaration, and data-safety disclosures.
- App Review submission for any permission or access level the current dashboard marks as requiring review.

The review submission must show:

- a fresh account and an existing-account link flow;
- the Facebook permission explanation screen;
- the exact screen where matched SMARTS friends appear;
- how a player disables sync and unlinks Facebook;
- the data deletion flow;
- that the app only displays friends who also authorized SMARTS.

Do not move to Live mode until the backend is deployed with production App ID/configuration and the deletion/privacy endpoints have been tested.

## Configuration contract

### Backend environment variables

Use the project’s existing configuration module and secret management. Proposed names:

```text
FACEBOOK_AUTH_ENABLED=false
FACEBOOK_APP_ID=
FACEBOOK_APP_SECRET=
FACEBOOK_GRAPH_API_VERSION=
FACEBOOK_TOKEN_DEBUG_ENABLED=true
FACEBOOK_FRIEND_SYNC_ENABLED=false
FACEBOOK_FRIEND_SYNC_MAX_PAGE_SIZE=100
FACEBOOK_FRIEND_SYNC_MIN_INTERVAL_SECONDS=21600
FACEBOOK_DATA_DELETION_CALLBACK_URL=
FACEBOOK_APP_SCOPED_ID_MODE=APP_SCOPED
```

Requirements:

- `FACEBOOK_APP_SECRET` exists only in Railway secret variables and local untracked development configuration.
- The Graph API version is pinned and upgraded deliberately, never silently inferred from a dependency.
- Production and development Meta App IDs must be separate or explicitly controlled by environment.
- `FACEBOOK_AUTH_ENABLED` and `FACEBOOK_FRIEND_SYNC_ENABLED` are independently kill-switchable.
- The backend must fail closed if the app ID, secret, or Graph version is missing.

### Mobile configuration

Expose only public values through the existing config endpoint or build configuration:

- Meta App ID
- Meta Client Token if required by the native SDK
- Facebook Login enabled flag
- friend sync enabled flag
- minimum supported SDK/build configuration

Never expose `FACEBOOK_APP_SECRET`, a server app access token, or a long-lived server credential to Flutter.

## Backend implementation plan

### Phase 1 — Provider configuration and schema

1. Add Facebook provider configuration through the same public/admin configuration pattern used for Google, without returning the App Secret.
2. Extend the external identity provider representation to support `facebook` while preserving the unique `(provider, providerSubject)` constraint.
3. Decide whether the existing provider field is a string or enum before migration; use one canonical uppercase/lowercase representation everywhere.
4. Add Facebook-specific metadata only where necessary:
   - provider subject/app-scoped Facebook ID;
   - email, display name, avatar URL snapshot;
   - granted scopes or permission status, if retained;
   - token expiry/revocation metadata only if a token is stored.
5. Add a `FacebookFriendSync` record for operational state, for example:
   - `id`, `userId`, `status`;
   - `lastStartedAt`, `lastCompletedAt`, `lastSuccessfulAt`;
   - `nextAllowedAt`, `friendCountSeen`, `matchedCount`, `createdCount`;
   - `lastErrorCode`, `lastErrorAt`;
   - provider/app ID and sync version.
6. Add a `FacebookFriendLink` or equivalent source record only if product requirements need provenance. It should reference the SMARTS user, the matched friend, the shared Facebook app-scoped ID when legally and operationally appropriate, timestamps, and active/revoked state.
7. Add indexes for provider subject, user, sync status, next eligible sync time, and source friendship lookup.
8. Do not store the complete Facebook friend response JSON. Do not store raw access tokens in audit events or analytics.

### Phase 2 — Secure token verification

Create a `FacebookAuthService` modeled after `GoogleAuthService`.

Required verification sequence:

1. Reject missing, malformed, oversized, or obviously expired client tokens.
2. Validate the token using Meta’s token-debugging/validation mechanism and the configured app credentials, or use the current documented server-side validation flow.
3. Verify:
   - token app ID equals configured SMARTS App ID;
   - token user ID is present;
   - token is not expired;
   - required scopes are present for the requested operation;
   - token is not revoked or invalid;
   - the Graph response belongs to the verified token subject.
4. Fetch the minimum profile fields needed for account identity.
5. Normalize email only for account recovery/linking and never treat an unverified/missing Facebook email as proof of ownership.
6. Never trust a Facebook user ID, name, email, or friend list supplied by Flutter without backend verification.
7. Redact tokens and Graph payloads from logs, Sentry, analytics, audit metadata, and exceptions.

Use short-lived in-memory request data where possible. If a later feature needs scheduled server-side sync, encrypt stored tokens with a managed key, store expiry/revocation state, and document why retention is necessary. The initial friend sync should complete using the client token and should not retain it.

### Phase 3 — Facebook login and account linking

Add the following backend surface, matching Google’s response DTOs:

```text
POST   /auth/facebook
GET    /auth/facebook/link
POST   /auth/facebook/link
DELETE /auth/facebook/link
POST   /auth/facebook/friends/sync
GET    /auth/facebook/friends/sync/status
POST   /auth/facebook/data-deletion
```

Suggested request shapes:

```json
{
  "accessToken": "<short-lived-client-token>",
  "syncFriends": true,
  "idempotencyKey": "<client-generated-unique-key>"
}
```

The login/link response must remain the normal SMARTS `LoginResponseDto` or link-status response. It may include a non-sensitive sync summary such as:

```json
{
  "requested": true,
  "matched": 3,
  "created": 2,
  "alreadyFriends": 1,
  "notOnSmarts": 0,
  "skippedBlocked": 0,
  "nextSyncAt": "2026-10-12T12:00:00.000Z"
}
```

The server must not return Facebook access tokens, raw Facebook IDs, or non-SMARTS friend names to the player.

Use transactions for identity linking and account creation. Enforce:

- one Facebook identity belongs to one SMARTS user;
- one SMARTS user cannot link multiple Facebook identities unless explicitly supported;
- an existing account is never silently merged solely because names match;
- email-based linking requires an authenticated session or an explicit recovery proof;
- login/link operations are idempotent;
- banned/inactive users cannot create a new route around account status.

### Phase 4 — Friend matching and automatic friendship

Implement a dedicated `FacebookFriendSyncService` rather than putting Graph calls inside `FriendsService`.

Algorithm:

1. Lock or deduplicate the current user’s sync job using a database idempotency key.
2. Validate the user’s Facebook identity and the supplied access token.
3. Check the `user_friends` grant. If absent, return a permission-specific result and do not call the friend endpoint.
4. Page through `/me/friends` using the pinned Graph API version and bounded page size.
5. Enforce maximum pages, maximum returned friends, response timeout, and total request budget.
6. Extract only the Facebook app-scoped IDs and permitted profile display data.
7. Query SMARTS external identities in batches.
8. Exclude the current player, inactive/banned/deleted users, blocked pairs, and users who opted out of automatic Facebook sync.
9. For each eligible match, call an idempotent friendship transaction that creates both directed `Friendship` rows or returns the existing relation.
10. Write one aggregate audit event for the sync, not one verbose event containing the full friend list.
11. Update sync status and return counts.

The sync must never create a pending friend request for a friend who has already authorized the same SMARTS Facebook app. It creates the automatic accepted friendship specified by this plan. Manual SMARTS friend requests continue to use the existing friend-request flow.

### Phase 5 — Data deletion and revocation

Implement Meta’s current deauthorization/data-deletion callback contract and verify its signature according to Meta’s documentation.

On a valid deletion/revocation request:

- identify the Facebook app-scoped subject without trusting unverified request data;
- revoke/delete the Facebook `ExternalIdentity` link;
- delete encrypted Facebook tokens if any;
- mark or delete Facebook friend-link provenance according to the retention policy;
- do not delete the SMARTS account unless the player separately requests account deletion;
- preserve only legally required audit records, with Facebook identifiers removed or irreversibly redacted;
- return the required Meta status/confirmation response.

Unlink from inside SMARTS should stop future automatic sync. The initial policy should retain existing SMARTS friendships unless the player explicitly removes them; document this clearly in the UI and privacy policy.

### Phase 6 — Observability and operations

Add structured counters and bounded logs:

- Facebook login success/failure by non-sensitive reason code;
- token validation failures;
- missing permission count;
- Graph timeout/rate-limit/error count;
- sync started/completed/failed;
- matched, newly added, already existing, blocked, and skipped counts;
- sync duration and page count;
- data deletion/revocation events.

Never log access tokens, App Secret, full Graph payloads, raw friend lists, or full Facebook IDs. Hash or truncate provider subjects in operational logs where correlation is necessary.

## Mobile implementation plan

### Phase 1 — Meta SDK integration

1. Select and pin a maintained Flutter Facebook Login package compatible with the current Android/iOS Meta SDKs, or add a small platform-channel wrapper around the official native SDKs if the package does not support the required token/permission behavior.
2. Do not choose a package solely because it supports an old Graph API version.
3. Add Android metadata, key-hash-compatible signing configuration, and iOS URL/deep-link configuration from the Meta setup checklist.
4. Keep the Facebook login client behind a `FacebookAuthGateway` interface so tests can use a fake token result.
5. Normalize cancellation as a non-error user action.
6. Surface permission denial separately from network/server failure.

### Phase 2 — Auth service and session flow

Extend `RailwayAuthService` with:

- `loginWithFacebook({required String accessToken, bool syncFriends = true})`;
- `facebookLinkStatus()`;
- `linkFacebook({required String accessToken, bool syncFriends = true})`;
- `unlinkFacebook()`;
- `syncFacebookFriends({required String accessToken, String? idempotencyKey})`;
- `facebookFriendSyncStatus()`.

After the backend returns the normal login response:

1. Save the SMARTS token pair through the existing token store.
2. Refresh the authenticated player context through the current coordinator.
3. Start friend sync through the authenticated Railway client if requested.
4. Do not block navigation to the authenticated shell on sync completion.
5. Refresh the existing friends provider after sync succeeds.

The client must not call Graph API with the SMARTS JWT. It must keep the Facebook access token separate and short-lived, use it only for the immediate sync request, and clear it from memory after the request.

### Phase 3 — Login and account settings UX

Add the Facebook button beside the existing Google action. The UI must explain:

> Continue with Facebook. If your Facebook friends also use SMARTS, we can connect you automatically. Facebook does not provide SMARTS with your complete friend list.

Add a Facebook account tile modeled after the existing Google account link tile:

- linked/unlinked/loading/error states;
- link/unlink confirmation;
- permission-denied explanation;
- last sync time and sync-now action;
- automatic friend sync toggle;
- retry action for transient failures;
- no raw provider IDs in the UI.

Add localized strings for English, Arabic, Kurdish, Turkish, Persian, and other supported SMARTS languages. Do not hardcode English-only auth or privacy text.

### Phase 4 — Friends UI

The existing friends provider remains the source of truth. After Facebook sync:

- reload accepted friends and presence through the existing repository;
- show a small “Connected via Facebook” provenance label only if the product wants it;
- never show friends who were returned by Facebook but are not SMARTS users;
- keep manual requests, blocks, removal, and matchmaking unchanged;
- show a sync explanation when Facebook returns an empty list.

Do not add a client-side Facebook friend cache as a second social graph. Cache only the backend-derived SMARTS friend response if the existing repository policy requires it.

## API and data contracts

### Link status

```json
{
  "provider": "facebook",
  "linked": true,
  "displayName": "Facebook display name",
  "avatarUrl": "https://...",
  "linkedAt": "2026-10-12T10:00:00.000Z",
  "autoSyncEnabled": true,
  "lastSyncAt": "2026-10-12T10:05:00.000Z",
  "nextSyncAt": "2026-10-12T16:05:00.000Z"
}
```

Do not expose `providerSubject` in normal mobile responses.

### Sync result states

Use stable machine-readable codes:

- `SYNC_COMPLETED`
- `SYNC_SKIPPED_RATE_LIMIT`
- `SYNC_PERMISSION_MISSING`
- `SYNC_TOKEN_INVALID`
- `SYNC_PROVIDER_UNAVAILABLE`
- `SYNC_PARTIAL`
- `SYNC_DISABLED`

The UI may localize these codes, while logs and analytics use the stable codes.

## Security and privacy requirements

- All backend-to-Meta and mobile-to-backend traffic uses HTTPS.
- The App Secret never reaches the app binary, Flutter config, logs, or client API responses.
- Verify Facebook tokens server-side against the exact App ID and configured Graph API version.
- Validate token expiration and granted scopes on every sync request.
- Do not use Facebook email as a password or as an automatic account takeover path.
- Do not silently merge accounts by display name or email alone.
- Enforce account status, blocks, and privacy settings before auto-friending.
- Apply rate limits per SMARTS user, IP/device identity, and provider subject.
- Use idempotency keys for login/link/sync retries.
- Minimize provider-derived storage and define retention/deletion behavior before production.
- Do not use Facebook friend data for advertising, unrelated analytics, or player profiling.
- Document that the friend list is limited to friends who also authorized SMARTS.
- Make automatic sync opt-out available and respect it immediately.

## Testing plan

### Backend unit tests

- valid Facebook token claims accepted;
- wrong App ID rejected;
- expired token rejected;
- missing `user_friends` permission returns the expected code;
- invalid Graph response rejected;
- identity create/login/link is idempotent;
- duplicate Facebook subject cannot link to another SMARTS account;
- email conflict requires authenticated linking/recovery;
- banned/inactive user rejected;
- current user excluded from matches;
- blocked user excluded;
- matching Facebook identities create both friendship directions exactly once;
- repeated sync creates no duplicate friendships;
- Graph pagination is bounded;
- Graph timeout/rate-limit does not fail login;
- data deletion removes provider data without deleting the SMARTS account;
- sync cooldown and explicit-refresh limits work;
- no token or raw friend payload reaches logs/audits.

### Mobile tests

- Facebook login success stores the normal SMARTS session;
- user cancellation does not show an error snackbar;
- Facebook permission denial has a clear retry path;
- login succeeds when friend sync fails;
- link/unlink states match backend status;
- sync result refreshes the existing friends provider;
- offline and timeout states preserve the authenticated session;
- Android callback works with and without the Facebook app installed;
- Android debug, release, and Play-signed key hashes are tested;
- iOS cold-start and warm-start URL callbacks are tested;
- no App Secret exists in the release artifact.

### End-to-end test accounts

Create Meta test users and SMARTS test accounts that cover:

1. two Facebook-authorized SMARTS users who are Facebook friends;
2. a SMARTS user with no Facebook-authorized friends;
3. a Facebook friend who has not authorized SMARTS;
4. a user who denies `user_friends`;
5. a user who unlinks/revokes Facebook;
6. blocked and banned-account combinations;
7. accounts with email conflicts;
8. Android and iOS production-signing configurations.

## Rollout sequence

### Stage 0 — Meta and legal readiness

- Complete App Dashboard configuration.
- Publish privacy policy and deletion instructions.
- Add Meta test users and internal testers.
- Confirm permission review requirements.
- Confirm production Android key hashes and iOS bundle IDs.

### Stage 1 — Backend dark launch

- Ship schema/configuration behind both feature flags disabled.
- Enable token verification for internal test users only.
- Exercise audit, rate limits, deletion, and Graph error paths.

### Stage 2 — Internal mobile testing

- Enable Facebook login for Meta roles and SMARTS allowlisted accounts.
- Test login, link, sync, unlink, cancellation, permission denial, and app reinstall.
- Verify only mutual SMARTS-authorized Facebook friends are connected.

### Stage 3 — App Review and staged production

- Submit the exact permission UX and friend-sync explanation.
- Enable production access only after review approval where required.
- Enable login first, then friend sync separately.
- Monitor sync errors, provider rate limits, account-link conflicts, and friendship creation rates.

### Stage 4 — General availability

- Gradually enable by percentage or allowlist.
- Keep independent kill switches for login and friend sync.
- Review deletion and revocation reports.
- Revalidate Meta SDK/API versions before every major release.

## Definition of done

- Facebook Login works on supported SMARTS Android and iOS release builds.
- Existing SMARTS users can link Facebook without creating a duplicate account.
- New Facebook users receive a normal SMARTS account and session.
- Facebook friends who also authorized SMARTS are automatically matched and added as SMARTS friends exactly once.
- Non-SMARTS Facebook friends are not imported or represented as confirmed SMARTS friends.
- The existing friends, chat, leaderboard, and matchmaking features consume the same backend `Friendship` records.
- Repeated login/sync is idempotent and rate-limited.
- Unlink/revocation/data deletion behavior is implemented and tested.
- App Secret and provider tokens are never exposed to the mobile app or logs.
- Meta privacy, data deletion, permission review, platform configuration, and production access checks are complete.
- Backend unit/integration tests and Flutter tests pass.
- Documentation and localized consent/privacy text are shipped.

