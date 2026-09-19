-- Older mobile clients saved the public avatar URL only in player storage.
-- Promote those values into PlayerProfile so all public player endpoints and
-- matchmaking/friend payloads expose the same avatar.
UPDATE "PlayerProfile" AS profile
SET "avatarUrl" = storage.value,
    "updatedAt" = CURRENT_TIMESTAMP
FROM "PlayerStorageItem" AS storage
WHERE storage."userId" = profile."userId"
  AND storage.key = 'profile_url'
  AND storage.visibility = 'PUBLIC'
  AND storage.value <> '';
