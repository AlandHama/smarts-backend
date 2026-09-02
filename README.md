# NestJs Backend For Smarts

A NestJS 11 API on Prisma 7 and Postgres, with Nexa-style UUID authentication,
session-backed access tokens, and refresh-token rotation.

It also includes a single-service system administrator console at
`/system-admin`. The console is bundled into Nest, uses the same access-token
and refresh-token session system, and provides a Material-style responsive UI
for user listing, registration, activation, banning, and deletion.

The console also manages progression definitions, tiers, rewards, currency
definitions, player wallet adjustments, ledger reversals, and reconciliation.
It includes leaderboard definitions, UTC season scheduling/closing, score-event
rebuilds, administrator corrections, and top-player panels for progression,
currency, and leaderboard sections.
Phase 5 adds server-owned game definitions, immutable game-policy versions,
server-issued challenge assignments, verified match events, atomic settlement,
rebuildable per-game statistics, and a post-commit outbox event.
The wallet is server-owned: balances are stored as integer `BIGINT` units and
every credit, debit, signup grant, and correction is an append-only ledger
transaction.

## Why this exists

The NestJS template on Railway declares three variables with empty values —
`RESEND_API_KEY`, `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` — and Railway turns
every empty value into a required field. Before the Deploy button will light up
you have to sign up for a third-party email service, get an API key, and invent
two JWT secrets, for a starter you have not seen run yet. Its `FRONTEND_URL`
also defaults to `localhost:3000`, which is wrong for every deployment. Fewer
than one in ten come up.

The authentication module follows the Nexa layering: `modules/auth` owns the
token and login flow, while `modules/admin/access/users` and
`modules/admin/access/sessions` own user and session persistence. It uses UUID
IDs throughout, bcrypt password hashes, active-session checks on every bearer
request, and one-time refresh-token rotation.

All authentication mutations are isolated in `transactions/` classes. User
creation, password changes, session creation, refresh rotation, logout, session
revocation, and activity timestamps run through Prisma transactions; services
coordinate those transactions and keep queries/read mapping separate.

## What's in here

| File | Why it exists |
|------|---------------|
| `src/main.ts` | Bootstrap: validation pipe, shutdown hooks, binds `PORT` |
| `src/prisma.service.ts` | Prisma client as an injectable, connected on module init |
| `src/modules/auth` | Login, registration, JWT strategy, tokens, sessions, and password changes |
| `src/modules/players` | Player profile, public profile, stats, and trusted progression methods |
| `src/modules/system-admin` | Protected system administrator API and bundled `/system-admin` web console |
| `src/notes.controller.ts` | `GET /notes`, `POST /notes` (authenticated) |
| `src/health.controller.ts` | `/` and `/health` — the latter runs `SELECT 1` |
| `railway.json` | Pre-deploy migration, health check, restart policy |
| `package-lock.json` | Committed dependency lockfile |

Four details worth knowing:

- **Migrations run in `preDeployCommand`**, after the build and before the new
  version takes traffic. The build has no database to connect to. `predeploy.sh`
  retries the migration only on Prisma's `P1001`, the error that means Postgres
  is not accepting connections yet — the state a project is in on its very first
  deploy. Railway does not retry a failed pre-deploy command on its own.
- **`whitelist: true` and `forbidNonWhitelisted: true`** reject properties the
  DTO does not declare, so clients cannot smuggle game-stat fields into profile
  updates.
- **`enableShutdownHooks()`.** Railway sends `SIGTERM` before replacing a
  container; without this, in-flight requests are cut off on every deploy.
- **The lockfile is committed.** Run `npm audit --audit-level=high` after
  dependency updates and before pushing a deployment.

## Endpoints

| Method | Path | Does |
|--------|------|------|
| GET | `/` | Lists the endpoints |
| GET | `/health` | Runs `SELECT 1`; reports degraded when Postgres is unreachable |
| GET | `/notes` | Last 100 notes, newest first (authenticated) |
| POST | `/notes` | Creates a note from `{"body": "..."}` (authenticated) |

Authentication endpoints are `POST /auth/register`, `POST /auth/login`,
`POST /auth/refresh` (also `/auth/token/refresh`), `POST /auth/token/validate`,
`GET /auth/me`, `POST /auth/logout`, `POST /auth/logout-all`, `GET /auth/sessions`, `DELETE /auth/sessions/:sessionId`,
and `POST /auth/password`. Send access tokens as
`Authorization: Bearer <accessToken>`.

Player endpoints are `GET /players/me`, `GET /players/:userId`, and
`PATCH /players/me`. Registration creates the player profile and statistics with
level 1, XP 0, and ELO 1000. XP, ELO, and statistics are returned as server
authority data and have no public write endpoints.

Economy endpoints are `GET /wallet`, `GET /wallet/transactions`, and
`GET /currencies`. Wallet writes are protected server operations and are
available to progression, match, purchase, and administration transactions;
the public API never accepts an arbitrary wallet ID or balance update.

Leaderboard endpoints are `GET /leaderboards`, `GET /leaderboards/:key`, and
`POST /leaderboards/:key/members`. The four initial boards are
`countryweekly`, `countrymonthly`, `players_weekly`, and `players_monthly`.
Ranks use `RANK()` over the current UTC season: equal scores share a rank, and
`updatedAt` then `memberKey` only determines deterministic display order.
Score changes are server commands recorded in `LeaderboardScoreEvent`; mobile
must never submit a replacement total.

Game endpoints are `GET /game-definitions`, `GET /game-definitions/:key`,
`GET /game-definitions/:key/content`, `POST /matches`,
`GET /matches/:matchId`, `POST /matches/:matchId/events`,
`POST /matches/:matchId/complete`, and `GET /matches/:matchId/settlement`.
Answer events require a server-issued assignment token; arbitrary client score
updates are rejected. Matches without verified answers enter `REVIEW` and do
not receive competitive rewards.

The system administrator console is available at `/system-admin`. Its API
requires a JWT from a user with `isSystemAdmin = true` and exposes overview
counts, paginated/searchable users, player registration, status changes, and
permanent deletion. Banning or deactivating a user terminates all active
sessions in the same transaction; deleting a user cascades their profile,
stats, and sessions. The current administrator cannot ban or delete itself,
and the last active administrator cannot be deleted.
The Game config section edits scoring, timing, ELO caps, reward formulas,
progression/currency references, and ranking multipliers. Each save creates a
new version, so in-progress matches continue using their original policy.

Interactive Swagger documentation is available at `/docs` when the app is
running. The raw OpenAPI document is available at `/docs-json`.

## Run locally

```bash
npm ci
export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/mydb"
npx prisma migrate dev
npm run dev
```

## Configuration

| Variable | Required | Purpose |
|----------|----------|---------|
| `DATABASE_URL` | yes | Postgres connection string |
| `PORT` | no | Defaults to 8080 |
| `JWT_SECRET` | fallback | Shared signing secret fallback; prefer separate secrets in production |
| `JWT_ACCESS_SECRET` | production | HMAC secret for access tokens |
| `JWT_REFRESH_SECRET` | production | HMAC secret for refresh tokens |
| `JWT_ACCESS_EXPIRES_IN` | no | Defaults to `15m` |
| `JWT_REFRESH_EXPIRES_IN` | no | Defaults to `30d` |
| `SYSTEM_ADMIN_USERNAME` | no | On first boot or first valid configured login, creates or promotes this username to system admin when paired with the password |
| `SYSTEM_ADMIN_PASSWORD` | no | Initial system-admin password; never overwrites an existing account password |
| `SYSTEM_ADMIN_RESET_PASSWORD` | no | Set to `true` for one recovery deploy to replace the configured admin account password, then remove it |
| `SYSTEM_ADMIN_EMAIL` | no | Initial system-admin email; defaults to a local placeholder |
| `SYSTEM_ADMIN_DISPLAY_NAME` | no | Initial system-admin display name |
| `SIGNUP_MCN_AMOUNT` | no | Server-side MCN signup grant in integer units; defaults to `1500` |
| `S3_ENDPOINT` | Phase 7 | S3-compatible endpoint, for example `https://t3.storageapi.dev` |
| `S3_REGION` | Phase 7 | S3-compatible region, for example `auto` |
| `S3_BUCKET` | Phase 7 | Bucket used for player and commerce files |
| `S3_ACCESS_KEY_ID` | Phase 7 | Storage access key; configure only in Railway variables |
| `S3_SECRET_ACCESS_KEY` | Phase 7 | Storage secret; configure only in Railway variables |
| `S3_PUBLIC_BASE_URL` | optional | Only use if the bucket is intentionally public; private buckets are supported |
| `PUBLIC_API_URL` | recommended | Absolute Railway API URL used for stable public media links, for example `https://api-production-xxxx.up.railway.app` |
| `AD_REWARD_WEBHOOK_SECRET` | Phase 9B | Private HMAC secret used to verify ad-provider callbacks; configure only in Railway Variables |

Phase 7 storage uses organized object keys such as `player-avatar/{userId}/{uuid}.png`,
`commerce-asset/admin/{uuid}.png`, and `catalog-item/admin/{uuid}.png`. Private
files are returned through 15-minute signed download URLs. Configure the
S3-compatible credentials in Railway under Variables; do not commit them to
GitHub. The mobile storage contract is `GET/POST /players/me/storage`, file
uploads are `POST /players/me/files`, and feedback is `GET
/feedback/categories/:entity` plus `POST /feedback`.

Phase 8 social APIs are `GET /friends`, `GET /friends/incoming`,
`GET /friends/outgoing`, `GET /friends/lookup`, and the request, accept,
decline, cancel, remove, block, and unblock routes under `/friends`. Presence
is server-owned: the mobile client sends `POST /presence/heartbeat`, reads
`GET /presence/me`, and may read a friend's coarse presence through
`GET /players/:userId/presence`. Online state is derived from the most recent
server timestamp, not from player storage or a client-supplied time. The
default online window is five minutes and can be changed with
`PRESENCE_ONLINE_WINDOW_SECONDS` (30–3600 seconds).

Phase 9B replaces Firebase reward/config authority. The mobile client reads the
safe projection from `GET /configuration/public`; it must not calculate or
credit rewards. Before showing a rewarded ad, call authenticated
`POST /ad-rewards/impressions` and pass the returned claim token as provider
custom data. The provider callback calls `POST /ad-rewards/claims` with the
claim id, provider event id, claim token, and an HMAC-SHA256
`x-ad-reward-signature` over `claimId:providerEventId:adFormat:claimToken`.
The server resolves the player region and policy, enforces cooldown/daily caps,
and credits the wallet exactly once. Configure the policy from the system-admin
`Reward policies` page; leave the webhook secret out of the database and mobile
app. Durable in-app notifications are available at `GET /notifications` and
`POST /notifications/:id/read`, while purchase and reward events are processed
from the transactional outbox.

## License

MIT
