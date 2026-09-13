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
  }
}
