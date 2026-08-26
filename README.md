# NestJs Backend For Smarts

A NestJS 11 API on Prisma 7 and Postgres, with nothing to fill in before it
deploys.

## Why this exists

The NestJS template on Railway declares three variables with empty values —
`RESEND_API_KEY`, `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` — and Railway turns
every empty value into a required field. Before the Deploy button will light up
you have to sign up for a third-party email service, get an API key, and invent
two JWT secrets, for a starter you have not seen run yet. Its `FRONTEND_URL`
also defaults to `localhost:3000`, which is wrong for every deployment. Fewer
than one in ten come up.

This one deploys with no questions. It has no auth and no email, because a
generic starter that ships neither should not be asking for their secrets — add
`@nestjs/jwt` and a mail provider when you actually need them, and the variables
with them.

## What's in here

| File | Why it exists |
|------|---------------|
| `src/main.ts` | Bootstrap: validation pipe, shutdown hooks, binds `PORT` |
| `src/prisma.service.ts` | Prisma client as an injectable, connected on module init |
| `src/notes.controller.ts` | `GET /notes`, `POST /notes` |
| `src/health.controller.ts` | `/` and `/health` — the latter runs `SELECT 1` |
| `railway.json` | Pre-deploy migration, health check, restart policy |
| `package-lock.json` | Committed, audited clean |

Four details worth knowing:

- **Migrations run in `preDeployCommand`**, after the build and before the new
  version takes traffic. The build has no database to connect to. `predeploy.sh`
  retries the migration only on Prisma's `P1001`, the error that means Postgres
  is not accepting connections yet — the state a project is in on its very first
  deploy. Railway does not retry a failed pre-deploy command on its own.
- **`whitelist: true` on the validation pipe** strips properties the DTO does not
  declare, so a request cannot smuggle extra fields into a create call.
- **`enableShutdownHooks()`.** Railway sends `SIGTERM` before replacing a
  container; without this, in-flight requests are cut off on every deploy.
- **The lockfile is audited clean.** `@nestjs/cli` pulls a vulnerable
  `brace-expansion` through its webpack plugin, and Railway refuses to build when
  the committed lockfile carries a HIGH advisory, so `package.json` overrides it
  forward. Check with `npm audit --audit-level=high` before pushing.

## Endpoints

| Method | Path | Does |
|--------|------|------|
| GET | `/` | Lists the endpoints |
| GET | `/health` | Runs `SELECT 1`; reports degraded when Postgres is unreachable |
| GET | `/notes` | Last 100 notes, newest first |
| POST | `/notes` | Creates a note from `{"body": "..."}` |

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

## License

MIT
