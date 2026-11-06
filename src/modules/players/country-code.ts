const COUNTRY_NAME_ALIASES: Record<string, string> = {
  "czech republic": "CZ",
  "ivory coast": "CI",
  "republic of the congo": "CG",
  "democratic republic of the congo": "CD",
  "south korea": "KR",
  "swaziland": "SZ",
  "vatican city": "VA",
}

function foldCountryName(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

const countryCodesByName = new Map<string, string>()
const regionNames = new Intl.DisplayNames(["en"], { type: "region" })
for (let first = 65; first <= 90; first += 1) {
  for (let second = 65; second <= 90; second += 1) {
    const code = String.fromCharCode(first, second)
    const name = regionNames.of(code)
    if (name && name !== "Unknown Region") countryCodesByName.set(foldCountryName(name), code)
  }
}
for (const [name, code] of Object.entries(COUNTRY_NAME_ALIASES)) countryCodesByName.set(foldCountryName(name), code)

/** Converts legacy display names and profile values to ISO alpha-2 codes. */
export function normalizeCountryCode(value: string | null | undefined): string | null {
  const input = value?.trim() ?? ""
  if (!input) return null
  if (/^[A-Za-z]{2}$/.test(input)) return input.toUpperCase()
  return countryCodesByName.get(foldCountryName(input)) ?? null
}
