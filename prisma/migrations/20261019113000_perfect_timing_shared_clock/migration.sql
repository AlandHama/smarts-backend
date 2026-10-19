-- Perfect Timing now uses one configurable match clock and independent
-- challenge cursors instead of synchronized rounds.
UPDATE "GameConfig" config
SET "settings" = jsonb_set(
      jsonb_set(config."settings", '{perfectTimingPolicy,matchDurationMs}', '35000'::jsonb),
      '{perfectTimingPolicy,challengeCount}', '100'::jsonb
    ),
    "maxMatchDurationSeconds" = 35,
    "updatedAt" = CURRENT_TIMESTAMP
FROM "GameDefinition" definition
WHERE config."gameDefinitionId" = definition."id"
  AND definition."key" = 'perfect_timing'
  AND config."active" = true;
