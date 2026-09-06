-- Seed the first playable server-content fixture for a clean Railway install.
-- This is intentionally static, safe display content; answerIndex and
-- answerHash remain server-only and are never returned by match reads.
WITH seed (game_key, prompt, options, difficulty, category, answer_index, answer_hash) AS (
  VALUES
    ('trivia', '{"en":"What is the capital of France?"}'::jsonb, '["London","Berlin","Paris","Madrid"]'::jsonb, 1, 'Geography', 2, '5f76b2c7b586e4efa9983138d0080a80a11d4792fc04450c28fa65e85e6dd04f'),
    ('trivia', '{"en":"Which planet is known as the Red Planet?"}'::jsonb, '["Venus","Mars","Jupiter","Saturn"]'::jsonb, 1, 'Science', 1, '45ec99eca9d0f00d2d5ac2d36a2d8ae2c7cd341e3c72aaf440822f79fef7c6dc'),
    ('trivia', '{"en":"What is the largest ocean on Earth?"}'::jsonb, '["Atlantic Ocean","Indian Ocean","Arctic Ocean","Pacific Ocean"]'::jsonb, 2, 'Geography', 3, '62c4a5658a28c5c86789ac00236c46672243a58f31901fbad4e5928434b13de1'),
    ('trivia', '{"en":"Who wrote Romeo and Juliet?"}'::jsonb, '["Charles Dickens","William Shakespeare","Jane Austen","Mark Twain"]'::jsonb, 2, 'Literature', 1, 'b8509bc3db787fd2d928f5026cb6e68abb65ce878a391e1ed35ab52e86474db2'),
    ('trivia', '{"en":"What is the chemical symbol for gold?"}'::jsonb, '["Go","Gd","Au","Ag"]'::jsonb, 2, 'Science', 2, '2015e55177ae0fffb8e1da2cde373c858587632d6b2843b5024891a3b0789cae'),
    ('trivia', '{"en":"How many continents are there?"}'::jsonb, '["5","6","7","8"]'::jsonb, 1, 'Geography', 2, '9f69d15945a63edb7b1ed9e78a6e8c8a4d32e7d84176a11f1e2bf458659c8008'),
    ('trivia', '{"en":"Which gas do plants absorb from the atmosphere?"}'::jsonb, '["Oxygen","Nitrogen","Carbon Dioxide","Hydrogen"]'::jsonb, 2, 'Science', 2, '63e6c6ed74bc96a50d42f596b0bf79d029ba8c7c64e38eff055180e96af1a056'),
    ('trivia', '{"en":"Which country is home to the kangaroo?"}'::jsonb, '["New Zealand","Australia","South Africa","Brazil"]'::jsonb, 1, 'Geography', 1, 'cf760681ba41b4af42d71dc74fbda75d430898059cbcb5c22f5209e2423a798a'),
    ('trivia', '{"en":"Which programming language is Flutter written in?"}'::jsonb, '["Java","Dart","Kotlin","Swift"]'::jsonb, 2, 'Technology', 1, 'd9f627a97164dcca7b53df5acc689500fd03413ca6a4895c3451d56833e4ec55'),
    ('trivia', '{"en":"What is the capital of Japan?"}'::jsonb, '["Seoul","Beijing","Tokyo","Bangkok"]'::jsonb, 1, 'Geography', 2, '0072d8411e411c2bbb87d7f06c32ba480d814a4b1bb6c557ddcb28a02106aec1'),
    ('math', '{"en":"What is 2 + 2?"}'::jsonb, '["3","4","5","6"]'::jsonb, 1, 'Arithmetic', 1, '42d57e5917425b7174ab32ab17414d87fea5d1a87a75e7cc4c845eb5b5720fe2'),
    ('math', '{"en":"What is 15 x 3?"}'::jsonb, '["35","40","45","50"]'::jsonb, 1, 'Arithmetic', 2, '91bf8b9c7c0a41305b0865b11bbe608ab3f75d2fc24e2110813e050ada21f724'),
    ('math', '{"en":"What is the square root of 64?"}'::jsonb, '["6","7","8","9"]'::jsonb, 1, 'Arithmetic', 2, '3c095d5b6278d0f53254783375f4328166f615b8873aafa88e96e4f7d23ee039'),
    ('math', '{"en":"What is 100 divided by 4?"}'::jsonb, '["20","25","30","35"]'::jsonb, 1, 'Arithmetic', 1, 'f85599ee7d7f3a9dc29e4dba6dc61ed10fdea9d7a345cb932dfa2152d820d3c5'),
    ('math', '{"en":"What is 9 x 9?"}'::jsonb, '["72","81","90","99"]'::jsonb, 1, 'Arithmetic', 1, '31e1d945e492a76531f6e27111e366e7eafadad92736bbe5dde089d66eabd483'),
    ('math', '{"en":"What is 48 divided by 6?"}'::jsonb, '["6","7","8","9"]'::jsonb, 1, 'Arithmetic', 2, '3c095d5b6278d0f53254783375f4328166f615b8873aafa88e96e4f7d23ee039'),
    ('math', '{"en":"What is 7 squared?"}'::jsonb, '["14","21","42","49"]'::jsonb, 1, 'Arithmetic', 3, 'bb096c0078ed5540c7a3b7936cc678067c8a2e5e261304483eb2d3a6df9e31a9'),
    ('math', '{"en":"What is 125 minus 50?"}'::jsonb, '["65","70","75","80"]'::jsonb, 1, 'Arithmetic', 2, 'd073c5d39ea867303b12d6a8f7298afa1abf9c8360f2679b070258dce9c80faf'),
    ('math', '{"en":"What is 3 to the power of 3?"}'::jsonb, '["9","18","27","30"]'::jsonb, 1, 'Arithmetic', 2, '05f9ad6da59f6d8f725c7e2803a2db6cc605eba038885d651127e9aa9afb0517'),
    ('math', '{"en":"What is half of 80?"}'::jsonb, '["20","30","40","50"]'::jsonb, 1, 'Arithmetic', 2, 'ef563bcece6fc39d0b9da7cc95393b52d2d9d436dc2496406171ee4f2de748f8')
)
INSERT INTO "GameContentItem" (
  "gameDefinitionId", "version", "contentType", "prompt", "options",
  "difficulty", "category", "answerHash", "answerIndex", "active",
  "createdAt", "updatedAt"
)
SELECT
  definition."id",
  1,
  'multiple_choice',
  seed.prompt,
  seed.options,
  seed.difficulty,
  seed.category,
  seed.answer_hash,
  seed.answer_index,
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM seed
JOIN "GameDefinition" definition ON definition."key" = seed.game_key
WHERE definition."active" = true
  AND NOT EXISTS (
    SELECT 1
    FROM "GameContentItem" existing
    WHERE existing."gameDefinitionId" = definition."id"
      AND existing."active" = true
  );
