#!/bin/sh
# Postgres and this API are created in the same moment when a project is deployed
# from the template, so the first migration can arrive before the database has
# started accepting connections. Railway does not retry a failed pre-deploy
# command - the deployment stops there and is reported as failed - so an
# unreachable database is waited out here.
#
# Only P1001 ("Can't reach database server") is retried. A migration that fails
# on its own contents is fatal on the first attempt: repeating it would delay the
# error without changing it.
set -e

max_attempts=12
delay=5
attempt=1

while :; do
  if output=$(npm run migrate 2>&1); then
    printf '%s\n' "$output"
    exit 0
  fi

  printf '%s\n' "$output" >&2

  # The first Phase 5 migration shipped with an invalid conflict target for
  # versioned GameConfig rows. PostgreSQL rolls that migration back, but
  # Prisma keeps its failed marker and refuses every later deploy until it is
  # explicitly resolved. Recover only this known, transactional failure; all
  # other migration-content errors remain fatal.
  if printf '%s' "$output" | grep -q '20260831200000_phase5_matches_game_configs_and_settlement' \
    && (printf '%s' "$output" | grep -q '42P10' || printf '%s' "$output" | grep -q 'P3009'); then
    echo "resolving the known rolled-back Phase 5 migration failure" >&2
    npx prisma migrate resolve --rolled-back 20260831200000_phase5_matches_game_configs_and_settlement
    attempt=$((attempt + 1))
    continue
  fi

  # Phase 1 support center was previously able to create its PostgreSQL
  # objects before failing while seeding SupportCategory.updatedAt. If that
  # partially-applied migration is encountered, complete its seed data and
  # record it as applied so later support migrations can proceed. The guards
  # below make this recovery safe: it only runs for the known enum collision
  # and refuses to mark the migration applied if the core tables are absent.
  if printf '%s' "$output" | grep -q '20261002100000_support_center_phase1' \
    && printf '%s' "$output" | grep -q '42710'; then
    echo "recovering the partially-applied support center Phase 1 migration" >&2
    npx prisma db execute --stdin <<'SQL'
DO $$
BEGIN
  IF to_regclass('public."SupportConfiguration"') IS NULL
     OR to_regclass('public."SupportCategory"') IS NULL
     OR to_regclass('public."SupportTicket"') IS NULL
     OR to_regclass('public."SupportTicketMessage"') IS NULL THEN
    RAISE EXCEPTION 'Phase 1 support tables are incomplete';
  END IF;
END
$$;

INSERT INTO "SupportConfiguration" ("updatedAt")
VALUES (CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "SupportCategory" ("key", "name", "description", "sortOrder", "updatedAt") VALUES
 ('ACCOUNT_LOGIN', 'Account & login', 'Sign-in, sessions, and account access.', 10, CURRENT_TIMESTAMP),
 ('MATCHMAKING_GAMEPLAY', 'Matchmaking & gameplay', 'Matches, game rules, and gameplay issues.', 20, CURRENT_TIMESTAMP),
 ('RESULT_REWARD', 'Results & rewards', 'Match results, XP, and rewards.', 30, CURRENT_TIMESTAMP),
 ('GLD', 'GLD wallet', 'Wallet balance and GLD transactions.', 40, CURRENT_TIMESTAMP),
 ('SOCIAL', 'Friends & social', 'Friends, gifts, and chat notifications.', 50, CURRENT_TIMESTAMP),
 ('STORE', 'Store & purchases', 'Purchases, inventory, and store items.', 60, CURRENT_TIMESTAMP),
 ('BUG', 'Report a bug', 'Something is not working as expected.', 70, CURRENT_TIMESTAMP),
 ('SAFETY', 'Safety & harassment', 'Safety, abuse, and player reports.', 80, CURRENT_TIMESTAMP),
 ('OTHER', 'Other', 'Anything else about SMARTS.', 90, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
SQL
    npx prisma migrate resolve --applied 20261002100000_support_center_phase1
    attempt=$((attempt + 1))
    continue
  fi

  if ! printf '%s' "$output" | grep -q 'P1001'; then
    exit 1
  fi

  if [ "$attempt" -ge "$max_attempts" ]; then
    echo "database still unreachable after $((max_attempts * delay))s" >&2
    exit 1
  fi

  echo "database is not accepting connections yet, attempt $attempt/$max_attempts, retrying in ${delay}s" >&2
  attempt=$((attempt + 1))
  sleep "$delay"
done
