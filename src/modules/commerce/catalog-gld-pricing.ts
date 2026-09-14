export type CatalogGldPricingMode = "FIXED" | "AUTO"

function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function usdToMicros(value: unknown) {
  if (typeof value === "string") {
    const match = value.trim().match(/^(\d+)(?:\.(\d{0,6}))?$/)
    if (!match) return null
    const micros = BigInt(match[1]) * 1_000_000n + BigInt((match[2] ?? "").padEnd(6, "0") || "0")
    return micros > 0n ? micros : null
  }
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return BigInt(Math.ceil(value * 1_000_000))
  return null
}

function ceilDivide(numerator: bigint, denominator: bigint) {
  return denominator > 0n ? (numerator + denominator - 1n) / denominator : 0n
}

function positiveInteger(value: unknown) {
  if (typeof value === "string" && /^\d+$/.test(value) && BigInt(value) > 0n) return BigInt(value)
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return BigInt(value)
  return null
}

export function catalogGldPricingMode(metadata: unknown): CatalogGldPricingMode {
  return record(metadata).gldPricingMode === "AUTO" ? "AUTO" : "FIXED"
}

export function catalogGldPrice(input: { catalogMetadata: unknown; assetMetadata: unknown; currentGldValueUsdMicros: bigint; storedGldPrice?: bigint | null }) {
  const catalog = record(input.catalogMetadata)
  const mode = catalogGldPricingMode(catalog)
  if (mode === "FIXED") return positiveInteger(catalog.gldCustomPrice) ?? input.storedGldPrice ?? null
  const asset = record(input.assetMetadata)
  const cost = usdToMicros(asset.paidRewardCostUsd) ?? positiveInteger(asset.paidRewardCostUsdMicros) ?? positiveInteger(asset.usdCostMicros) ?? positiveInteger(asset.costUsdMicros) ?? positiveInteger(asset.rewardCostUsdMicros) ?? positiveInteger(asset.usdValueMicros) ?? usdToMicros(asset.usdCost)
  if (cost === null || input.currentGldValueUsdMicros <= 0n) return null
  const base = ceilDivide(cost, input.currentGldValueUsdMicros)
  const rawProfit = asset.paidRewardProfitPercent
  const profitPercent = typeof rawProfit === "number" && Number.isInteger(rawProfit) && rawProfit >= 0 ? rawProfit : typeof rawProfit === "string" && /^\d+$/.test(rawProfit) ? Number(rawProfit) : 0
  return ceilDivide(base * (10_000n + BigInt(profitPercent) * 100n), 10_000n)
}
