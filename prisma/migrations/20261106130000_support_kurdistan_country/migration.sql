-- KU is SMARTS' internal two-letter code for the custom Kurdistan option.
-- It is not an ISO 3166 country code, but the leaderboard system requires a
-- stable two-letter key for every selectable mobile country.
UPDATE "PlayerProfile" AS p
SET "countryCode" = 'KU'
FROM "PlayerStorageItem" AS s
WHERE s."userId" = p."userId"
  AND s."key" = 'player_country'
  AND LOWER(TRIM(s."value")) = 'kurdistan';
