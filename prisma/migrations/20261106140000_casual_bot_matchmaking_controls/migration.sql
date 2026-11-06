ALTER TABLE "GameConfig"
  ADD COLUMN "casualBotFallbackEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "casualBotFallbackDelaySeconds" INTEGER NOT NULL DEFAULT 20;

ALTER TABLE "MatchmakingTicket"
  ADD COLUMN "botFallbackDelaySeconds" INTEGER NOT NULL DEFAULT 20;

ALTER TABLE "MatchmakingTicket"
  ADD CONSTRAINT "MatchmakingTicket_botFallbackDelaySeconds_check"
  CHECK ("botFallbackDelaySeconds" >= 0 AND "botFallbackDelaySeconds" <= 300);
