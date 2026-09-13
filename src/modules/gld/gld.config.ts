const DEFAULTS = {
  initialPriceUsdMicros: 50_000n,
  minPriceUsdMicros: 5_000n,
  maxPriceUsdMicros: 1_000_000n,
  smoothingFactorBps: 500,
  maxIncreaseBps: 250,
  maxDecreaseBps: 250,
  playerRewardAllocationBps: 4_000,
  reserveAllocationBps: 2_000,
  companyAllocationBps: 4_000,
  recognitionHaircutBps: 8_000,
  adCostsUsdMicros: 0n,
  minimumDailyEmission: 0n,
  maximumDailyEmission: 1_000_000_000n,
  maxDailyGrowthBps: 1_500,
  maxDailyDropBps: 2_000,
  adDailyGldCap: 25n,
  adMaxValidatedAds: 20,
  adMaxRewardPerClaim: 10n,
  adHealthMultiplierBps: { VERY_HEALTHY: 10_000, HEALTHY: 10_000, CAUTION: 8_000, RESTRICTED: 5_000, CRITICAL: 2_000 },
  adCurve: [
    { from: 1, to: 5, multiplierBps: 10_000 },
    { from: 6, to: 10, multiplierBps: 7_500 },
    { from: 11, to: 15, multiplierBps: 5_000 },
    { from: 16, to: 20, multiplierBps: 2_500 },
  ],
  giftBurnBps: 10_000,
}

function bigintEnv(name: string, fallback: bigint) {
  const value = process.env[name]?.trim()
  if (!value) return fallback
  try {
    const parsed = BigInt(value)
    return parsed >= 0n ? parsed : fallback
  } catch {
    return fallback
  }
}

function bpsEnv(name: string, fallback: number) {
  const parsed = Number(process.env[name])
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 10_000 ? parsed : fallback
}

function curveEnv() {
  const fallback = DEFAULTS.adCurve
  try {
    const parsed = JSON.parse(process.env.GLD_AD_REWARD_CURVE_JSON ?? "") as unknown
    if (!Array.isArray(parsed)) return fallback
    const rows = parsed.map((item) => {
      const row = item as Record<string, unknown>
      return { from: Number(row.from), to: Number(row.to), multiplierBps: Number(row.multiplierBps) }
    })
    return rows.every((row) => Number.isInteger(row.from) && Number.isInteger(row.to) && row.from >= 1 && row.to >= row.from && Number.isInteger(row.multiplierBps) && row.multiplierBps >= 0 && row.multiplierBps <= 10_000) ? rows : fallback
  } catch {
    return fallback
  }
}

export function getGldConfig() {
  const allocations = {
    playerRewardAllocationBps: bpsEnv("GLD_PLAYER_REWARD_ALLOCATION_BPS", DEFAULTS.playerRewardAllocationBps),
    reserveAllocationBps: bpsEnv("GLD_RESERVE_ALLOCATION_BPS", DEFAULTS.reserveAllocationBps),
    companyAllocationBps: bpsEnv("GLD_COMPANY_ALLOCATION_BPS", DEFAULTS.companyAllocationBps),
  }
  const allocationTotal = Object.values(allocations).reduce((sum, value) => sum + value, 0)
  if (allocationTotal !== 10_000) {
    throw new Error("GLD allocation BPS must total exactly 10000")
  }
  return {
    initialPriceUsdMicros: bigintEnv("GLD_INITIAL_PRICE_USD_MICROS", DEFAULTS.initialPriceUsdMicros),
    minPriceUsdMicros: bigintEnv("GLD_MIN_PRICE_USD_MICROS", DEFAULTS.minPriceUsdMicros),
    maxPriceUsdMicros: bigintEnv("GLD_MAX_PRICE_USD_MICROS", DEFAULTS.maxPriceUsdMicros),
    smoothingFactorBps: bpsEnv("GLD_SMOOTHING_FACTOR_BPS", DEFAULTS.smoothingFactorBps),
    maxIncreaseBps: bpsEnv("GLD_MAX_PRICE_INCREASE_BPS", DEFAULTS.maxIncreaseBps),
    maxDecreaseBps: bpsEnv("GLD_MAX_PRICE_DECREASE_BPS", DEFAULTS.maxDecreaseBps),
    ...allocations,
    recognitionHaircutBps: bpsEnv("GLD_RECOGNITION_HAIRCUT_BPS", DEFAULTS.recognitionHaircutBps),
    adCostsUsdMicros: bigintEnv("GLD_DAILY_AD_COSTS_USD_MICROS", DEFAULTS.adCostsUsdMicros),
    minimumDailyEmission: bigintEnv("GLD_MIN_DAILY_EMISSION", DEFAULTS.minimumDailyEmission),
    maximumDailyEmission: bigintEnv("GLD_MAX_DAILY_EMISSION", DEFAULTS.maximumDailyEmission),
    maxDailyGrowthBps: bpsEnv("GLD_MAX_DAILY_EMISSION_GROWTH_BPS", DEFAULTS.maxDailyGrowthBps),
    maxDailyDropBps: bpsEnv("GLD_MAX_DAILY_EMISSION_DROP_BPS", DEFAULTS.maxDailyDropBps),
    adDailyGldCap: bigintEnv("GLD_AD_DAILY_CAP", DEFAULTS.adDailyGldCap),
    adMaxValidatedAds: Math.max(1, Number(process.env.GLD_AD_MAX_VALIDATED_ADS) || DEFAULTS.adMaxValidatedAds),
    adMaxRewardPerClaim: bigintEnv("GLD_AD_MAX_REWARD_PER_CLAIM", DEFAULTS.adMaxRewardPerClaim),
    adHealthMultiplierBps: DEFAULTS.adHealthMultiplierBps,
    adCurve: curveEnv(),
    giftBurnBps: bpsEnv("GLD_DIGITAL_GIFT_BURN_BPS", DEFAULTS.giftBurnBps),
  }
}
