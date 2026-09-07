-- The initial server-content fixture covered only trivia and math. Matchmaking
-- intentionally accepts a queue intent before pairing, so every game must
-- have active content by the time the worker creates a playable match.
-- Seed a small, safe bootstrap set for every registered game key.
-- This is idempotent and does not replace content already managed by admins.
WITH required_games (game_key, category, prompt) AS (
  VALUES
    ('trivia', 'Trivia', 'Which option is correct?'),
    ('math', 'Math', 'Which answer solves the problem?'),
    ('flick_master', 'Flick Master', 'Which direction should the target move?'),
    ('high_low', 'High Low', 'Which value is higher?'),
    ('stacking', 'Stacking', 'Which piece should be placed next?'),
    ('similarities', 'Similarities', 'Which item belongs to the same group?'),
    ('follow_the_lead', 'Follow the Lead', 'Which action matches the lead?'),
    ('memorize_cards', 'Memorize Cards', 'Which card matches the remembered pattern?'),
    ('bird_watching', 'Bird Watching', 'Which choice matches the observed pattern?')
),
missing_games AS (
  SELECT required.game_key, required.category, required.prompt, definition.id AS game_definition_id
  FROM required_games required
  JOIN "GameDefinition" definition ON definition."key" = required.game_key
  WHERE definition."active" = true
    AND NOT EXISTS (
      SELECT 1
      FROM "GameContentItem" existing
      WHERE existing."gameDefinitionId" = definition.id
        AND existing."active" = true
    )
),
seed AS (
  SELECT
    missing.game_definition_id,
    missing.category,
    missing.prompt,
    generate_series(1, 10) AS position
  FROM missing_games missing
)
INSERT INTO "GameContentItem" (
  "gameDefinitionId", "version", "contentType", "prompt", "options",
  "difficulty", "category", "answerHash", "answerIndex", "active",
  "createdAt", "updatedAt"
)
SELECT
  seed.game_definition_id,
  1,
  'multiple_choice',
  jsonb_build_object('en', seed.prompt || ' #' || seed.position::text),
  '["Option A", "Option B", "Option C", "Option D"]'::jsonb,
  1,
  seed.category,
  encode(digest('0:["Option A","Option B","Option C","Option D"]', 'sha256'), 'hex'),
  0,
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM seed;
