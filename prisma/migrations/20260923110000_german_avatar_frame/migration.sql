-- Add the premium German Crest frame after the original ten-frame release.
INSERT INTO "AssetDefinition" ("id", "key", "name", "description", "assetType", "ownershipPolicy", "active", "metadata", "createdAt", "updatedAt")
VALUES (
  gen_random_uuid(),
  'avatar-frame:german',
  'German Crest',
  'A bold black, red, and gold animated frame.',
  'COSMETIC',
  'STACKABLE',
  true,
  '{"cosmeticType":"avatar_frame","frameKey":"german","animation":"shimmer"}',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("key") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "metadata" = EXCLUDED."metadata",
  "updatedAt" = CURRENT_TIMESTAMP;

WITH store AS (
  INSERT INTO "Catalog" ("id", "key", "name", "description", "active", "createdAt", "updatedAt")
  VALUES (gen_random_uuid(), 'main', 'Main Store', 'Rewards and cosmetic avatar frames.', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  ON CONFLICT ("key") DO UPDATE SET "updatedAt" = CURRENT_TIMESTAMP
  RETURNING "id"
), chosen_store AS (
  SELECT "id" FROM store
  UNION ALL
  SELECT "id" FROM "Catalog" WHERE "key" = 'main' AND NOT EXISTS (SELECT 1 FROM store)
)
INSERT INTO "CatalogItem" ("id", "catalogId", "key", "name", "description", "assetDefinitionId", "purchasable", "active", "createdAt", "updatedAt")
SELECT gen_random_uuid(), chosen_store."id", 'avatar-frame:german', 'German Crest',
       'Animated black, red, and gold avatar frame.', asset."id", true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM chosen_store
JOIN "AssetDefinition" asset ON asset."key" = 'avatar-frame:german'
ON CONFLICT ("catalogId", "key") DO NOTHING;

INSERT INTO "CatalogPrice" ("id", "catalogItemId", "currencyId", "amount", "active", "createdAt", "updatedAt")
SELECT gen_random_uuid(), item."id", currency."id", 300, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "CatalogItem" item
JOIN "CurrencyDefinition" currency ON currency."code" = 'GLD'
WHERE item."key" = 'avatar-frame:german'
ON CONFLICT ("catalogItemId", "currencyId") DO NOTHING;
