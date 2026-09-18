-- Math matches must expose arithmetic expressions only. Older bootstrap data
-- used prose prompts (and the all-games fallback used "Challenge #N"), which
-- made the math UI show a generic challenge label instead of an expression.

UPDATE "GameContentItem" item
SET "active" = false,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE item."gameDefinitionId" = (
  SELECT "id" FROM "GameDefinition" WHERE "key" = 'math' LIMIT 1
)
AND item."active" = true
AND (
  COALESCE(item."prompt"->>'en', item."prompt"->>'en-US', item."prompt"->>'ar', item."prompt"->>'ckb', '') !~ '^[[:space:]]*-?[0-9]+[[:space:]]*[+*×÷/-][[:space:]]*-?[0-9]+[[:space:]]*$'
  OR COALESCE(jsonb_typeof(item."options"), '') <> 'array'
  OR CASE
    WHEN jsonb_typeof(item."options") = 'array' THEN jsonb_array_length(item."options") <> 4
    ELSE true
  END
  OR CASE
    WHEN jsonb_typeof(item."options") = 'array' THEN EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text(item."options") AS option(value)
      WHERE value !~ '^[[:space:]]*-?[0-9]+[[:space:]]*$'
    )
    ELSE true
  END
);

WITH math_game AS (
  SELECT "id"
  FROM "GameDefinition"
  WHERE "key" = 'math'
  LIMIT 1
),
active_count AS (
  SELECT COUNT(*)::integer AS count
  FROM "GameContentItem" item
  JOIN math_game ON math_game."id" = item."gameDefinitionId"
  WHERE item."active" = true
),
latest_version AS (
  SELECT COALESCE(MAX(item."version"), 0)::integer AS version
  FROM "GameContentItem" item
  JOIN math_game ON math_game."id" = item."gameDefinitionId"
),
operands AS (
  SELECT
    question_no,
    MOD(question_no, 3) AS operation,
    CASE MOD(question_no, 3)
      WHEN 0 THEN (MOD(question_no * 7, 90) + 1)
      WHEN 1 THEN (MOD(question_no * 13, 90) + 20)
      ELSE (MOD(question_no * 3, 12) + 1)
    END AS left_value,
    CASE MOD(question_no, 3)
      WHEN 0 THEN (MOD(question_no * 11, 50) + 1)
      WHEN 1 THEN (MOD(question_no * 5, 19) + 1)
      ELSE (MOD(question_no * 5, 12) + 1)
    END AS right_value
  FROM generate_series(1, 50) AS series(question_no)
),
expressions AS (
  SELECT
    question_no,
    left_value,
    right_value,
    CASE operation
      WHEN 0 THEN left_value + right_value
      WHEN 1 THEN left_value - right_value
      ELSE left_value * right_value
    END AS answer,
    CASE operation
      WHEN 0 THEN left_value::text || ' + ' || right_value::text
      WHEN 1 THEN left_value::text || ' - ' || right_value::text
      ELSE left_value::text || ' * ' || right_value::text
    END AS expression
  FROM operands
)
INSERT INTO "GameContentItem" (
  "gameDefinitionId", "version", "contentType", "prompt", "options",
  "difficulty", "category", "answerHash", "answerIndex", "active",
  "createdAt", "updatedAt"
)
SELECT
  math_game."id",
  latest_version.version + expressions.question_no,
  'multiple_choice',
  jsonb_build_object('en', expressions.expression),
  jsonb_build_array(expressions.answer, expressions.answer + 1, expressions.answer + 2, expressions.answer + 3),
  CASE
    WHEN expressions.answer <= 20 THEN 1
    WHEN expressions.answer <= 50 THEN 2
    WHEN expressions.answer <= 100 THEN 3
    WHEN expressions.answer <= 200 THEN 4
    ELSE 5
  END,
  'Arithmetic',
  encode(digest(format('0:[%s,%s,%s,%s]', expressions.answer, expressions.answer + 1, expressions.answer + 2, expressions.answer + 3), 'sha256'), 'hex'),
  0,
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM expressions
CROSS JOIN math_game
CROSS JOIN active_count
CROSS JOIN latest_version
WHERE expressions.question_no > active_count.count;
