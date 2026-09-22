-- Ten server-owned avatar-frame assets. The migration also adds starter
-- listings to the main catalog; administrators can edit or remove them.
INSERT INTO "AssetDefinition" ("id", "key", "name", "description", "assetType", "ownershipPolicy", "active", "metadata", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid(), 'avatar-frame:aurora', 'Aurora Ring', 'A soft northern-light pulse.', 'COSMETIC', 'STACKABLE', true, '{"cosmeticType":"avatar_frame","frameKey":"aurora","animation":"pulse"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'avatar-frame:solar-flare', 'Solar Flare', 'Warm gold light with a moving flare.', 'COSMETIC', 'STACKABLE', true, '{"cosmeticType":"avatar_frame","frameKey":"solar-flare","animation":"orbit"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'avatar-frame:ocean-wave', 'Ocean Wave', 'A cool animated wave frame.', 'COSMETIC', 'STACKABLE', true, '{"cosmeticType":"avatar_frame","frameKey":"ocean-wave","animation":"shimmer"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'avatar-frame:neon-violet', 'Neon Violet', 'Electric violet for quick thinkers.', 'COSMETIC', 'STACKABLE', true, '{"cosmeticType":"avatar_frame","frameKey":"neon-violet","animation":"pulse"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'avatar-frame:emerald-leaf', 'Emerald Leaf', 'A lively green botanical glow.', 'COSMETIC', 'STACKABLE', true, '{"cosmeticType":"avatar_frame","frameKey":"emerald-leaf","animation":"orbit"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'avatar-frame:ruby-crown', 'Ruby Crown', 'A competitive red crown effect.', 'COSMETIC', 'STACKABLE', true, '{"cosmeticType":"avatar_frame","frameKey":"ruby-crown","animation":"sparkle"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'avatar-frame:ice-crystal', 'Ice Crystal', 'A crisp crystalline frame.', 'COSMETIC', 'STACKABLE', true, '{"cosmeticType":"avatar_frame","frameKey":"ice-crystal","animation":"spin"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'avatar-frame:golden-comet', 'Golden Comet', 'A bright trail around your avatar.', 'COSMETIC', 'STACKABLE', true, '{"cosmeticType":"avatar_frame","frameKey":"golden-comet","animation":"orbit"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'avatar-frame:midnight-stars', 'Midnight Stars', 'Deep space with subtle stars.', 'COSMETIC', 'STACKABLE', true, '{"cosmeticType":"avatar_frame","frameKey":"midnight-stars","animation":"sparkle"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'avatar-frame:candy-pop', 'Candy Pop', 'A playful pink and blue loop.', 'COSMETIC', 'STACKABLE', true, '{"cosmeticType":"avatar_frame","frameKey":"candy-pop","animation":"shimmer"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

-- Put the presets in the normal main store as purchasable cosmetic listings.
-- Administrators can edit prices, imagery, and availability after deployment.
WITH store AS (
  INSERT INTO "Catalog" ("id", "key", "name", "description", "active", "createdAt", "updatedAt")
  VALUES (gen_random_uuid(), 'main', 'Main Store', 'Rewards and cosmetic avatar frames.', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  ON CONFLICT ("key") DO UPDATE SET "updatedAt" = CURRENT_TIMESTAMP
  RETURNING "id"
), frame_rows AS (
  SELECT * FROM (VALUES
    ('avatar-frame:aurora', 'Aurora Ring'),
    ('avatar-frame:solar-flare', 'Solar Flare'),
    ('avatar-frame:ocean-wave', 'Ocean Wave'),
    ('avatar-frame:neon-violet', 'Neon Violet'),
    ('avatar-frame:emerald-leaf', 'Emerald Leaf'),
    ('avatar-frame:ruby-crown', 'Ruby Crown'),
    ('avatar-frame:ice-crystal', 'Ice Crystal'),
    ('avatar-frame:golden-comet', 'Golden Comet'),
    ('avatar-frame:midnight-stars', 'Midnight Stars'),
    ('avatar-frame:candy-pop', 'Candy Pop')
  ) AS values(key, name)
), chosen_store AS (
  SELECT "id" FROM store
  UNION ALL
  SELECT "id" FROM "Catalog" WHERE "key" = 'main' AND NOT EXISTS (SELECT 1 FROM store)
)
INSERT INTO "CatalogItem" ("id", "catalogId", "key", "name", "description", "assetDefinitionId", "purchasable", "active", "createdAt", "updatedAt")
SELECT gen_random_uuid(), chosen_store."id", frame_rows.key, frame_rows.name,
       'Animated avatar frame cosmetic.', asset."id", true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM chosen_store
CROSS JOIN frame_rows
JOIN "AssetDefinition" asset ON asset."key" = frame_rows.key
ON CONFLICT ("catalogId", "key") DO NOTHING;

INSERT INTO "CatalogPrice" ("id", "catalogItemId", "currencyId", "amount", "active", "createdAt", "updatedAt")
SELECT gen_random_uuid(), item."id", currency."id", 100, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "CatalogItem" item
JOIN "CurrencyDefinition" currency ON currency."code" = 'GLD'
WHERE item."key" LIKE 'avatar-frame:%'
ON CONFLICT ("catalogItemId", "currencyId") DO NOTHING;
