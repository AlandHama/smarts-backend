ALTER TYPE "MatchEventType" ADD VALUE IF NOT EXISTS 'EMOTE';

INSERT INTO "AssetDefinition" ("id", "key", "name", "description", "assetType", "ownershipPolicy", "active", "metadata", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid(), 'emote:laugh', 'Laugh', 'A bright victory laugh.', 'COSMETIC', 'STACKABLE', true, '{"cosmeticType":"emote","emoteKey":"laugh","icon":"😂","rarity":"free","free":true}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'emote:clap', 'Clap', 'Give a player some applause.', 'COSMETIC', 'STACKABLE', true, '{"cosmeticType":"emote","emoteKey":"clap","icon":"👏","rarity":"free","free":true}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'emote:fire', 'Fire', 'That play was on fire.', 'COSMETIC', 'STACKABLE', true, '{"cosmeticType":"emote","emoteKey":"fire","icon":"🔥","rarity":"free","free":true}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'emote:cool', 'Cool', 'A classic cool reaction.', 'COSMETIC', 'STACKABLE', true, '{"cosmeticType":"emote","emoteKey":"cool","icon":"😎","rarity":"free","free":true}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'emote:skull', 'Skull', 'That move was deadly.', 'COSMETIC', 'STACKABLE', true, '{"cosmeticType":"emote","emoteKey":"skull","icon":"💀","rarity":"free","free":true}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'emote:heart', 'Heart', 'Send a little love.', 'COSMETIC', 'STACKABLE', true, '{"cosmeticType":"emote","emoteKey":"heart","icon":"💖","rarity":"common"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'emote:gg', 'Good game', 'Respect the match.', 'COSMETIC', 'STACKABLE', true, '{"cosmeticType":"emote","emoteKey":"gg","icon":"🤝","rarity":"common"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'emote:wow', 'Wow', 'For an unbelievable play.', 'COSMETIC', 'STACKABLE', true, '{"cosmeticType":"emote","emoteKey":"wow","icon":"🤯","rarity":"common"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'emote:cry', 'Tears', 'A dramatic reaction.', 'COSMETIC', 'STACKABLE', true, '{"cosmeticType":"emote","emoteKey":"cry","icon":"😭","rarity":"common"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'emote:angry', 'Rage', 'Bring the heat.', 'COSMETIC', 'STACKABLE', true, '{"cosmeticType":"emote","emoteKey":"angry","icon":"😤","rarity":"common"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'emote:party', 'Party', 'Celebrate in style.', 'COSMETIC', 'STACKABLE', true, '{"cosmeticType":"emote","emoteKey":"party","icon":"🥳","rarity":"rare"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'emote:crown', 'Crown', 'A royal reaction.', 'COSMETIC', 'STACKABLE', true, '{"cosmeticType":"emote","emoteKey":"crown","icon":"👑","rarity":"rare"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'emote:rocket', 'Rocket', 'Launch into the next round.', 'COSMETIC', 'STACKABLE', true, '{"cosmeticType":"emote","emoteKey":"rocket","icon":"🚀","rarity":"rare"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'emote:ghost', 'Ghost', 'A spooky disappearing act.', 'COSMETIC', 'STACKABLE', true, '{"cosmeticType":"emote","emoteKey":"ghost","icon":"👻","rarity":"rare"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'emote:hundred', 'Hundred', 'Perfect energy.', 'COSMETIC', 'STACKABLE', true, '{"cosmeticType":"emote","emoteKey":"hundred","icon":"💯","rarity":"rare"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'emote:sparkles', 'Sparkles', 'Add a little magic.', 'COSMETIC', 'STACKABLE', true, '{"cosmeticType":"emote","emoteKey":"sparkles","icon":"✨","rarity":"epic"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'emote:mind-blown', 'Mind blown', 'For a genius answer.', 'COSMETIC', 'STACKABLE', true, '{"cosmeticType":"emote","emoteKey":"mind-blown","icon":"🤩","rarity":"epic"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'emote:salute', 'Salute', 'Respect the opponent.', 'COSMETIC', 'STACKABLE', true, '{"cosmeticType":"emote","emoteKey":"salute","icon":"🫡","rarity":"epic"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'emote:sleepy', 'Sleepy', 'A very patient player.', 'COSMETIC', 'STACKABLE', true, '{"cosmeticType":"emote","emoteKey":"sleepy","icon":"😴","rarity":"epic"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'emote:sweat', 'Sweat', 'That was too close.', 'COSMETIC', 'STACKABLE', true, '{"cosmeticType":"emote","emoteKey":"sweat","icon":"😅","rarity":"epic"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'emote:poop', 'Oops', 'A playful miss.', 'COSMETIC', 'STACKABLE', true, '{"cosmeticType":"emote","emoteKey":"poop","icon":"💩","rarity":"epic"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'emote:pray', 'Pray', 'Trust the next answer.', 'COSMETIC', 'STACKABLE', true, '{"cosmeticType":"emote","emoteKey":"pray","icon":"🙏","rarity":"epic"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'emote:star-struck', 'Star struck', 'A legendary moment.', 'COSMETIC', 'STACKABLE', true, '{"cosmeticType":"emote","emoteKey":"star-struck","icon":"🤩","rarity":"legendary"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'emote:eyes', 'Eyes', 'Everyone is watching.', 'COSMETIC', 'STACKABLE', true, '{"cosmeticType":"emote","emoteKey":"eyes","icon":"👀","rarity":"legendary"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'emote:trophy', 'Trophy', 'Claim the spotlight.', 'COSMETIC', 'STACKABLE', true, '{"cosmeticType":"emote","emoteKey":"trophy","icon":"🏆","rarity":"legendary"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'emote:diamond', 'Diamond', 'A brilliant reaction.', 'COSMETIC', 'STACKABLE', true, '{"cosmeticType":"emote","emoteKey":"diamond","icon":"💎","rarity":"legendary"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'emote:lightning', 'Lightning', 'Instant impact.', 'COSMETIC', 'STACKABLE', true, '{"cosmeticType":"emote","emoteKey":"lightning","icon":"⚡","rarity":"legendary"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'emote:rainbow', 'Rainbow', 'A colorful celebration.', 'COSMETIC', 'STACKABLE', true, '{"cosmeticType":"emote","emoteKey":"rainbow","icon":"🌈","rarity":"legendary"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'emote:dragon', 'Dragon', 'Unleash a mythic reaction.', 'COSMETIC', 'STACKABLE', true, '{"cosmeticType":"emote","emoteKey":"dragon","icon":"🐉","rarity":"legendary"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'emote:galaxy', 'Galaxy', 'The ultimate cosmic emote.', 'COSMETIC', 'STACKABLE', true, '{"cosmeticType":"emote","emoteKey":"galaxy","icon":"🌌","rarity":"legendary"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO UPDATE SET "name" = EXCLUDED."name", "description" = EXCLUDED."description", "metadata" = EXCLUDED."metadata", "active" = true, "updatedAt" = CURRENT_TIMESTAMP;

WITH store AS (SELECT "id" FROM "Catalog" WHERE "key" = 'main' LIMIT 1), emotes(key, name, price) AS (VALUES
  ('emote:laugh','Laugh',0),('emote:clap','Clap',0),('emote:fire','Fire',0),('emote:cool','Cool',0),('emote:skull','Skull',0),('emote:heart','Heart',5),('emote:gg','Good game',5),('emote:wow','Wow',10),('emote:cry','Tears',10),('emote:angry','Rage',10),('emote:party','Party',15),('emote:crown','Crown',20),('emote:rocket','Rocket',20),('emote:ghost','Ghost',25),('emote:hundred','Hundred',25),('emote:sparkles','Sparkles',30),('emote:mind-blown','Mind blown',35),('emote:salute','Salute',40),('emote:sleepy','Sleepy',40),('emote:sweat','Sweat',45),('emote:poop','Oops',50),('emote:pray','Pray',50),('emote:star-struck','Star struck',60),('emote:eyes','Eyes',60),('emote:trophy','Trophy',75),('emote:diamond','Diamond',100),('emote:lightning','Lightning',100),('emote:rainbow','Rainbow',125),('emote:dragon','Dragon',150),('emote:galaxy','Galaxy',200)
), items AS (
  INSERT INTO "CatalogItem" ("id","catalogId","key","name","description","assetDefinitionId","purchasable","active","createdAt","updatedAt")
  SELECT gen_random_uuid(), store."id", emotes.key, emotes.name, 'Use this reaction during a match.', asset."id", true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM store CROSS JOIN emotes JOIN "AssetDefinition" asset ON asset."key" = emotes.key
  ON CONFLICT ("catalogId","key") DO UPDATE SET "name" = EXCLUDED."name", "assetDefinitionId" = EXCLUDED."assetDefinitionId", "active" = true, "purchasable" = true, "updatedAt" = CURRENT_TIMESTAMP
  RETURNING "id","key"
)
INSERT INTO "CatalogPrice" ("id","catalogItemId","currencyId","amount","active","createdAt","updatedAt")
SELECT gen_random_uuid(), item."id", currency."id", emotes.price, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "CatalogItem" item JOIN items ON items."id" = item."id" JOIN emotes ON emotes.key = item."key" CROSS JOIN "CurrencyDefinition" currency
WHERE currency."code" = 'GLD'
ON CONFLICT ("catalogItemId","currencyId") DO UPDATE SET "amount" = EXCLUDED."amount", "active" = true, "updatedAt" = CURRENT_TIMESTAMP;
