INSERT INTO "AssetDefinition" ("id", "key", "name", "description", "assetType", "ownershipPolicy", "active", "metadata", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid(), 'name-effect:celestial-crown', 'Celestial Crown', 'A radiant crown of starlight for elite players.', 'COSMETIC', 'STACKABLE', true, '{"cosmeticType":"name_effect","nameEffectKey":"celestial-crown","animation":"sparkle","rarity":"legendary","primary":"#fef08a","secondary":"#a78bfa","accent":"#67e8f9"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'name-effect:diamond-elite', 'Diamond Elite', 'A brilliant diamond shimmer with icy highlights.', 'COSMETIC', 'STACKABLE', true, '{"cosmeticType":"name_effect","nameEffectKey":"diamond-elite","animation":"shimmer","rarity":"legendary","primary":"#e0f2fe","secondary":"#93c5fd","accent":"#ffffff"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'name-effect:inferno-royal', 'Inferno Royal', 'A fierce ember trail wrapped in royal crimson.', 'COSMETIC', 'STACKABLE', true, '{"cosmeticType":"name_effect","nameEffectKey":"inferno-royal","animation":"fire","rarity":"legendary","primary":"#ffedd5","secondary":"#f97316","accent":"#ef4444"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'name-effect:aurora-legend', 'Aurora Legend', 'A northern-light ribbon reserved for legends.', 'COSMETIC', 'STACKABLE', true, '{"cosmeticType":"name_effect","nameEffectKey":"aurora-legend","animation":"rainbow","rarity":"legendary","primary":"#99f6e4","secondary":"#818cf8","accent":"#f0abfc"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'name-effect:plasma-emperor', 'Plasma Emperor', 'A charged violet plasma wave with cyan sparks.', 'COSMETIC', 'STACKABLE', true, '{"cosmeticType":"name_effect","nameEffectKey":"plasma-emperor","animation":"pulse","rarity":"legendary","primary":"#f0abfc","secondary":"#c084fc","accent":"#22d3ee"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'name-effect:obsidian-gold', 'Obsidian Gold', 'A dark-gold finish with a molten luxury glint.', 'COSMETIC', 'STACKABLE', true, '{"cosmeticType":"name_effect","nameEffectKey":"obsidian-gold","animation":"sparkle","rarity":"legendary","primary":"#fff7ae","secondary":"#f59e0b","accent":"#292524"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'name-effect:cosmic-opal', 'Cosmic Opal', 'A deep-space opal prism that shifts through color.', 'COSMETIC', 'STACKABLE', true, '{"cosmeticType":"name_effect","nameEffectKey":"cosmic-opal","animation":"rainbow","rarity":"legendary","primary":"#f5d0fe","secondary":"#67e8f9","accent":"#c4b5fd"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'name-effect:dragonfire', 'Dragonfire', 'A blazing gold-and-crimson effect with dragon energy.', 'COSMETIC', 'STACKABLE', true, '{"cosmeticType":"name_effect","nameEffectKey":"dragonfire","animation":"fire","rarity":"legendary","primary":"#facc15","secondary":"#ef4444","accent":"#7f1d1d"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'name-effect:quantum-prism', 'Quantum Prism', 'A rare prism burst from the edge of the leaderboard.', 'COSMETIC', 'STACKABLE', true, '{"cosmeticType":"name_effect","nameEffectKey":"quantum-prism","animation":"glitch","rarity":"legendary","primary":"#a7f3d0","secondary":"#f0abfc","accent":"#60a5fa"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'name-effect:imperial-violet', 'Imperial Violet', 'A regal violet aura finished with a royal-gold sweep.', 'COSMETIC', 'STACKABLE', true, '{"cosmeticType":"name_effect","nameEffectKey":"imperial-violet","animation":"shimmer","rarity":"legendary","primary":"#ddd6fe","secondary":"#7c3aed","accent":"#fbbf24"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "metadata" = EXCLUDED."metadata",
  "active" = true,
  "updatedAt" = CURRENT_TIMESTAMP;

WITH effects(key, name, description) AS (VALUES
  ('name-effect:celestial-crown', 'Celestial Crown', 'A radiant crown of starlight for elite players.'),
  ('name-effect:diamond-elite', 'Diamond Elite', 'A brilliant diamond shimmer with icy highlights.'),
  ('name-effect:inferno-royal', 'Inferno Royal', 'A fierce ember trail wrapped in royal crimson.'),
  ('name-effect:aurora-legend', 'Aurora Legend', 'A northern-light ribbon reserved for legends.'),
  ('name-effect:plasma-emperor', 'Plasma Emperor', 'A charged violet plasma wave with cyan sparks.'),
  ('name-effect:obsidian-gold', 'Obsidian Gold', 'A dark-gold finish with a molten luxury glint.'),
  ('name-effect:cosmic-opal', 'Cosmic Opal', 'A deep-space opal prism that shifts through color.'),
  ('name-effect:dragonfire', 'Dragonfire', 'A blazing gold-and-crimson effect with dragon energy.'),
  ('name-effect:quantum-prism', 'Quantum Prism', 'A rare prism burst from the edge of the leaderboard.'),
  ('name-effect:imperial-violet', 'Imperial Violet', 'A regal violet aura finished with a royal-gold sweep.')
), chosen_store AS (
  SELECT "id" FROM "Catalog" WHERE "key" = 'main' LIMIT 1
), catalog_items AS (
  INSERT INTO "CatalogItem" ("id", "catalogId", "key", "name", "description", "assetDefinitionId", "purchasable", "active", "createdAt", "updatedAt")
  SELECT gen_random_uuid(), chosen_store."id", effects.key, effects.name, effects.description, asset."id", true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM chosen_store CROSS JOIN effects
  JOIN "AssetDefinition" asset ON asset."key" = effects.key
  ON CONFLICT ("catalogId", "key") DO UPDATE SET
    "name" = EXCLUDED."name",
    "description" = EXCLUDED."description",
    "assetDefinitionId" = EXCLUDED."assetDefinitionId",
    "purchasable" = true,
    "active" = true,
    "updatedAt" = CURRENT_TIMESTAMP
  RETURNING "id", "key"
)
SELECT 1;

WITH prices(key, amount) AS (VALUES
  ('name-effect:celestial-crown', 50),
  ('name-effect:diamond-elite', 75),
  ('name-effect:inferno-royal', 75),
  ('name-effect:aurora-legend', 100),
  ('name-effect:plasma-emperor', 100),
  ('name-effect:obsidian-gold', 125),
  ('name-effect:cosmic-opal', 150),
  ('name-effect:dragonfire', 200),
  ('name-effect:quantum-prism', 250),
  ('name-effect:imperial-violet', 300)
)
INSERT INTO "CatalogPrice" ("id", "catalogItemId", "currencyId", "amount", "active", "createdAt", "updatedAt")
SELECT gen_random_uuid(), item."id", currency."id", prices.amount, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "CatalogItem" item
JOIN prices ON prices.key = item."key"
CROSS JOIN "CurrencyDefinition" currency
JOIN "Catalog" catalog ON catalog."id" = item."catalogId" AND catalog."key" = 'main'
WHERE currency."code" = 'GLD'
ON CONFLICT ("catalogItemId", "currencyId") DO UPDATE SET
  "amount" = EXCLUDED."amount",
  "active" = true,
  "updatedAt" = CURRENT_TIMESTAMP;
