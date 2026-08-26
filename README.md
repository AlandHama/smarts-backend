# NestJs Backend For Smarts

A NestJS 11 API on Prisma 7 and Postgres, with Nexa-style UUID authentication,
session-backed access tokens, and refresh-token rotation.

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

## License

MIT
