-- Phase 1 recovery for the production database where the migration created
-- its objects and then failed while seeding SupportCategory.updatedAt.
-- Run this only after checking that migration
-- 20261002100000_support_center_phase1 is the failed migration.

DO $$
BEGIN
  IF to_regclass('public."SupportConfiguration"') IS NULL
     OR to_regclass('public."SupportCategory"') IS NULL
     OR to_regclass('public."SupportTicket"') IS NULL
     OR to_regclass('public."SupportTicketMessage"') IS NULL THEN
    RAISE EXCEPTION 'Phase 1 support tables are incomplete; do not mark the migration applied';
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
