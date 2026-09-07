-- Timed SMARTS games can accept more than ten rapid answers in one round.
-- Keep every answer on the server-issued assignment/event path instead of
-- falling back to a client-owned final score.
WITH active_games AS (
  SELECT id
  FROM "GameDefinition"
  WHERE active = true
), counts AS (
  SELECT games.id, COUNT(items.id)::integer AS item_count
  FROM active_games games
  LEFT JOIN "GameContentItem" items
    ON items."gameDefinitionId" = games.id
   AND items.active = true
  GROUP BY games.id
), missing AS (
  SELECT id, item_count
  FROM counts
  WHERE item_count < 50
), seed AS (
  SELECT missing.id AS "gameDefinitionId",
         generate_series(missing.item_count + 1, 50) AS position
  FROM missing
)
INSERT INTO "GameContentItem" (
  "gameDefinitionId", version, "contentType", prompt, options,
  difficulty, category, "answerHash", "answerIndex", active,
  "createdAt", "updatedAt"
)
SELECT
  seed."gameDefinitionId",
  1,
  'multiple_choice',
  jsonb_build_object('en', 'Server challenge #' || seed.position::text),
  '["Option A", "Option B", "Option C", "Option D"]'::jsonb,
  1,
  definition.name,
  encode(digest('0:["Option A","Option B","Option C","Option D"]', 'sha256'), 'hex'),
  0,
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM seed
JOIN "GameDefinition" definition ON definition.id = seed."gameDefinitionId";

UPDATE "GameConfig"
SET "maxQuestions" = GREATEST("maxQuestions", 50),
    "updatedAt" = CURRENT_TIMESTAMP
WHERE active = true;
