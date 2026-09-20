ALTER TABLE "RankingMatchConfig" ADD COLUMN "entryFeeGldMicros" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "MatchmakingTicket" ADD COLUMN "rankingEntryFeeMicros" BIGINT;
ALTER TABLE "RankingMatch" ADD COLUMN "entryFeeGldMicros" BIGINT NOT NULL DEFAULT 0;

UPDATE "RankingMatchConfig"
SET "entryFeeGldMicros" = "entryFeeGld" * 1000000;

UPDATE "RankingMatch"
SET "entryFeeGldMicros" = "entryFeeGld" * 1000000;
