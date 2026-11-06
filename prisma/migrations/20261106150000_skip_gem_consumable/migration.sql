-- Server-owned Skip Gem consumable. One gem passes one generic question.
INSERT INTO "AssetDefinition" ("id", "key", "name", "description", "assetType", "ownershipPolicy", "active", "metadata", "createdAt", "updatedAt")
VALUES (
  gen_random_uuid(),
  'consumable:skip_gem',
  'Skip Gem',
  'Pass one question instantly during an eligible match.',
  'CONSUMABLE',
  'STACKABLE',
  true,
  '{"cosmeticType":"skip_gem","consumableType":"skip_gem","icon":"💎","use":"skip_question"}'::jsonb,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("key") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "assetType" = 'CONSUMABLE',
  "ownershipPolicy" = 'STACKABLE',
  "active" = true,
  "metadata" = EXCLUDED."metadata",
  "updatedAt" = CURRENT_TIMESTAMP;

WITH packages ("key", "name", "description", "quantity", "price") AS (VALUES
  ('skip-gem-10', '10 Skip Gems', '10 instant question skips.', 10, 2),
  ('skip-gem-20', '20 Skip Gems', '20 instant question skips.', 20, 3),
  ('skip-gem-35', '35 Skip Gems', '35 instant question skips.', 35, 5),
  ('skip-gem-50', '50 Skip Gems', '50 instant question skips.', 50, 7),
  ('skip-gem-75', '75 Skip Gems', '75 instant question skips.', 75, 10),
  ('skip-gem-100', '100 Skip Gems', '100 instant question skips.', 100, 13),
  ('skip-gem-150', '150 Skip Gems', '150 instant question skips.', 150, 18),
  ('skip-gem-250', '250 Skip Gems', '250 instant question skips.', 250, 28)
), store AS (
  SELECT "id" FROM "Catalog" WHERE "key" = 'main' LIMIT 1
)
INSERT INTO "CatalogItem" ("id", "catalogId", "key", "name", "description", "assetDefinitionId", "purchasable", "active", "metadata", "createdAt", "updatedAt")
SELECT gen_random_uuid(), store."id", packages."key", packages."name", packages."description", NULL, true, true,
  jsonb_build_object('cosmeticType', 'skip_gem', 'consumableType', 'skip_gem', 'packageQuantity', packages."quantity", 'icon', '💎'),
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM store CROSS JOIN packages
ON CONFLICT ("catalogId", "key") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "assetDefinitionId" = NULL,
  "purchasable" = true,
  "active" = true,
  "metadata" = EXCLUDED."metadata",
  "updatedAt" = CURRENT_TIMESTAMP;

WITH packages ("key", "quantity", "price") AS (VALUES
  ('skip-gem-10', 10, 2), ('skip-gem-20', 20, 3), ('skip-gem-35', 35, 5), ('skip-gem-50', 50, 7),
  ('skip-gem-75', 75, 10), ('skip-gem-100', 100, 13), ('skip-gem-150', 150, 18), ('skip-gem-250', 250, 28)
)
INSERT INTO "CatalogPrice" ("id", "catalogItemId", "currencyId", "amount", "active", "createdAt", "updatedAt")
SELECT gen_random_uuid(), item."id", currency."id", packages."price", true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "CatalogItem" item
JOIN "Catalog" catalog ON catalog."id" = item."catalogId" AND catalog."key" = 'main'
JOIN packages ON packages."key" = item."key"
JOIN "CurrencyDefinition" currency ON currency."code" = 'GLD'
ON CONFLICT ("catalogItemId", "currencyId") DO UPDATE SET
  "amount" = EXCLUDED."amount", "active" = true, "updatedAt" = CURRENT_TIMESTAMP;

DELETE FROM "CatalogReward" reward
USING "CatalogItem" item, "Catalog" catalog
WHERE reward."catalogItemId" = item."id"
  AND item."catalogId" = catalog."id"
  AND catalog."key" = 'main'
  AND item."key" LIKE 'skip-gem-%';

WITH packages ("key", "quantity") AS (VALUES
  ('skip-gem-10', 10), ('skip-gem-20', 20), ('skip-gem-35', 35), ('skip-gem-50', 50),
  ('skip-gem-75', 75), ('skip-gem-100', 100), ('skip-gem-150', 150), ('skip-gem-250', 250)
)
INSERT INTO "CatalogReward" ("id", "catalogItemId", "rewardType", "assetDefinitionId", "quantity", "sortOrder", "metadata", "createdAt")
SELECT gen_random_uuid(), item."id", 'ASSET', asset."id", packages."quantity", 0,
  jsonb_build_object('consumableType', 'skip_gem'), CURRENT_TIMESTAMP
FROM "CatalogItem" item
JOIN "Catalog" catalog ON catalog."id" = item."catalogId" AND catalog."key" = 'main'
JOIN packages ON packages."key" = item."key"
JOIN "AssetDefinition" asset ON asset."key" = 'consumable:skip_gem';
