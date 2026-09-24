ALTER TABLE "PlayerProfile" ADD COLUMN IF NOT EXISTS "nameEffectKey" VARCHAR(80);

INSERT INTO "AssetDefinition" ("id", "key", "name", "description", "assetType", "ownershipPolicy", "active", "metadata", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid(), 'name-effect:mint-glow', 'Mint Glow', 'A clean pulse of mint light.', 'COSMETIC', 'STACKABLE', true, '{"cosmeticType":"name_effect","nameEffectKey":"mint-glow","animation":"pulse"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'name-effect:skyline', 'Skyline', 'A cool blue shimmer for quick players.', 'COSMETIC', 'STACKABLE', true, '{"cosmeticType":"name_effect","nameEffectKey":"skyline","animation":"shimmer"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'name-effect:neon-cyan', 'Neon Cyan', 'Electric cyan that moves across your name.', 'COSMETIC', 'STACKABLE', true, '{"cosmeticType":"name_effect","nameEffectKey":"neon-cyan","animation":"shimmer"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'name-effect:sunset-flare', 'Sunset Flare', 'A warm orange and pink moving glow.', 'COSMETIC', 'STACKABLE', true, '{"cosmeticType":"name_effect","nameEffectKey":"sunset-flare","animation":"fire"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'name-effect:emerald-arc', 'Emerald Arc', 'A confident emerald pulse.', 'COSMETIC', 'STACKABLE', true, '{"cosmeticType":"name_effect","nameEffectKey":"emerald-arc","animation":"pulse"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'name-effect:ruby-royal', 'Ruby Royal', 'A red luxury gradient for rivals.', 'COSMETIC', 'STACKABLE', true, '{"cosmeticType":"name_effect","nameEffectKey":"ruby-royal","animation":"sparkle"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'name-effect:royal-gold', 'Royal Gold', 'A premium gold shimmer.', 'COSMETIC', 'STACKABLE', true, '{"cosmeticType":"name_effect","nameEffectKey":"royal-gold","animation":"sparkle"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'name-effect:holographic', 'Holographic', 'A shifting rainbow hologram.', 'COSMETIC', 'STACKABLE', true, '{"cosmeticType":"name_effect","nameEffectKey":"holographic","animation":"rainbow"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'name-effect:galaxy-prism', 'Galaxy Prism', 'Deep-space colors with a prism sweep.', 'COSMETIC', 'STACKABLE', true, '{"cosmeticType":"name_effect","nameEffectKey":"galaxy-prism","animation":"rainbow"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'name-effect:glitch-luxe', 'Glitch Luxe', 'A sharp animated cyber effect.', 'COSMETIC', 'STACKABLE', true, '{"cosmeticType":"name_effect","nameEffectKey":"glitch-luxe","animation":"glitch"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO UPDATE SET "name" = EXCLUDED."name", "description" = EXCLUDED."description", "metadata" = EXCLUDED."metadata", "updatedAt" = CURRENT_TIMESTAMP;

WITH store AS (
  INSERT INTO "Catalog" ("id", "key", "name", "description", "active", "createdAt", "updatedAt")
  VALUES (gen_random_uuid(), 'main', 'Main Store', 'Rewards and name cosmetics.', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  ON CONFLICT ("key") DO UPDATE SET "updatedAt" = CURRENT_TIMESTAMP
  RETURNING "id"
), chosen_store AS (
  SELECT "id" FROM store
  UNION ALL
  SELECT "id" FROM "Catalog" WHERE "key" = 'main' AND NOT EXISTS (SELECT 1 FROM store)
), effects(key, name) AS (VALUES
  ('name-effect:mint-glow', 'Mint Glow'), ('name-effect:skyline', 'Skyline'), ('name-effect:neon-cyan', 'Neon Cyan'),
  ('name-effect:sunset-flare', 'Sunset Flare'), ('name-effect:emerald-arc', 'Emerald Arc'), ('name-effect:ruby-royal', 'Ruby Royal'),
  ('name-effect:royal-gold', 'Royal Gold'), ('name-effect:holographic', 'Holographic'), ('name-effect:galaxy-prism', 'Galaxy Prism'), ('name-effect:glitch-luxe', 'Glitch Luxe')
)
INSERT INTO "CatalogItem" ("id", "catalogId", "key", "name", "description", "assetDefinitionId", "purchasable", "active", "createdAt", "updatedAt")
SELECT gen_random_uuid(), chosen_store."id", effects.key, effects.name, 'Animated player-name cosmetic.', asset."id", true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM chosen_store CROSS JOIN effects JOIN "AssetDefinition" asset ON asset."key" = effects.key
ON CONFLICT ("catalogId", "key") DO UPDATE SET "name" = EXCLUDED."name", "assetDefinitionId" = EXCLUDED."assetDefinitionId", "active" = true, "purchasable" = true, "updatedAt" = CURRENT_TIMESTAMP;

WITH effects(key, price) AS (VALUES
  ('name-effect:mint-glow', 5), ('name-effect:skyline', 10), ('name-effect:neon-cyan', 10),
  ('name-effect:sunset-flare', 50), ('name-effect:emerald-arc', 50), ('name-effect:ruby-royal', 50),
  ('name-effect:royal-gold', 150), ('name-effect:holographic', 150), ('name-effect:galaxy-prism', 200), ('name-effect:glitch-luxe', 200)
)
INSERT INTO "CatalogPrice" ("id", "catalogItemId", "currencyId", "amount", "active", "createdAt", "updatedAt")
SELECT gen_random_uuid(), item."id", currency."id", effects.price, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "CatalogItem" item JOIN effects ON effects.key = item."key" CROSS JOIN "CurrencyDefinition" currency
WHERE currency."code" = 'GLD'
ON CONFLICT ("catalogItemId", "currencyId") DO UPDATE SET "amount" = EXCLUDED."amount", "active" = true, "updatedAt" = CURRENT_TIMESTAMP;
