-- The initial cognitive implementation treated the first match as a full
-- assessment. Reset those rows so the bounded evidence model starts fairly.
UPDATE "PlayerCognitiveStats"
SET "calculation" = 50,
    "speed" = 50,
    "accuracy" = 50,
    "judgement" = 50,
    "observation" = 50,
    "memory" = 50,
    "matchesEvaluated" = 0,
    "updatedAt" = CURRENT_TIMESTAMP;
