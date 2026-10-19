-- Keep the square Bomb Path board within the requested mobile ceiling.
-- Existing matches keep their captured policy; this only affects new matches.
UPDATE "GameConfig" config
SET "settings" = jsonb_set(
      COALESCE(config."settings", '{}'::jsonb),
      '{bombPathPolicy,gridSizeLate}',
      '7'::jsonb,
      true
    ),
    "updatedAt" = CURRENT_TIMESTAMP
FROM "GameDefinition" definition
WHERE config."gameDefinitionId" = definition."id"
  AND definition."key" = 'bomb_path'
  AND (config."settings" #>> '{bombPathPolicy,gridSizeLate}')::int > 7;
