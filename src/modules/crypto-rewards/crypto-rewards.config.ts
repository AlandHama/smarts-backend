export const CRYPTO_REWARD_CURRENCIES = ["USDTSOL", "USDCSOL"] as const
export type CryptoRewardCurrency = (typeof CRYPTO_REWARD_CURRENCIES)[number]

export const CRYPTO_REWARD_NETWORK = "SOLANA" as const

function positiveInt(name: string, fallback: number, max = Number.MAX_SAFE_INTEGER) {
  const value = Number(process.env[name])
  return Number.isInteger(value) && value > 0 && value <= max ? value : fallback
}

function nonNegativeInt(name: string, fallback: number, max = Number.MAX_SAFE_INTEGER) {
  const value = Number(process.env[name])
  return Number.isInteger(value) && value >= 0 && value <= max ? value : fallback
}

function positiveDecimal(name: string, fallback: string) {
  const value = process.env[name]?.trim()
  return value && /^\d+(?:\.\d{1,6})?$/.test(value) && Number(value) > 0 ? value : fallback
}

function nonNegativeDecimal(name: string, fallback: string) {
  const value = process.env[name]?.trim()
  return value && /^\d+(?:\.\d{1,6})?$/.test(value) && Number(value) >= 0 ? value : fallback
}

function nonNegativeBigInt(name: string, fallback: bigint) {
  const value = process.env[name]?.trim()
  if (!value || !/^\d+$/.test(value)) return fallback
  try {
    const parsed = BigInt(value)
    return parsed >= 0n ? parsed : fallback
  } catch {
    return fallback
  }
}

function booleanEnv(name: string, fallback: boolean) {
  const value = process.env[name]?.trim().toLowerCase()
  if (value === "true") return true
  if (value === "false") return false
  return fallback
}

export function getCryptoRewardsConfig() {
  const environment = process.env.NOWPAYMENTS_ENVIRONMENT?.trim().toLowerCase() === "production" ? "production" : "sandbox"
  return {
    enabled: booleanEnv("CRYPTO_REWARDS_ENABLED", false),
    providerEnabled: booleanEnv("NOWPAYMENTS_ENABLED", false),
    providerEnvironment: environment,
    providerBaseUrl: process.env.NOWPAYMENTS_API_BASE_URL?.trim() || (environment === "production" ? "https://api.nowpayments.io/v1" : "https://api.sandbox.nowpayments.io/v1"),
    apiKey: process.env.NOWPAYMENTS_API_KEY?.trim() || "",
    ipnSecret: process.env.NOWPAYMENTS_IPN_SECRET?.trim() || "",
    ipnCallbackUrl: process.env.CRYPTO_REWARDS_IPN_CALLBACK_URL?.trim() || process.env.NOWPAYMENTS_IPN_PUBLIC_URL?.trim() || "",
    supportedCurrencies: [...CRYPTO_REWARD_CURRENCIES],
    networkCode: CRYPTO_REWARD_NETWORK,
    requestTimeoutMs: positiveInt("NOWPAYMENTS_REQUEST_TIMEOUT_MS", 10_000, 60_000),
    maxRetries: nonNegativeInt("NOWPAYMENTS_MAX_RETRIES", 2, 5),
    quoteTtlSeconds: positiveInt("CRYPTO_REWARDS_QUOTE_TTL_SECONDS", 300, 3600),
    maxQuoteDriftBps: positiveInt("CRYPTO_REWARDS_MAX_QUOTE_DRIFT_BPS", 500, 10_000),
    minGld: nonNegativeBigInt("CRYPTO_REWARDS_MIN_GLD", 100n),
    maxGldPerRequest: nonNegativeBigInt("CRYPTO_REWARDS_MAX_GLD_PER_REQUEST", 100_000n),
    dailyGldLimit: nonNegativeBigInt("CRYPTO_REWARDS_DAILY_GLD_LIMIT", 200_000n),
    maxPendingPerUser: positiveInt("CRYPTO_REWARDS_MAX_PENDING_PER_USER", 1, 20),
    holdExpiryHours: positiveInt("CRYPTO_REWARDS_HOLD_EXPIRY_HOURS", 72, 720),
    platformFeeBps: nonNegativeInt("CRYPTO_REWARDS_PLATFORM_FEE_BPS", 0, 10_000),
    requireAdminApproval: booleanEnv("CRYPTO_REWARDS_REQUIRE_ADMIN_APPROVAL", true),
    requirePayoutVerification: booleanEnv("NOWPAYMENTS_REQUIRE_PAYOUT_VERIFICATION", true),
    pollIntervalMs: positiveInt("CRYPTO_REWARDS_POLL_INTERVAL_MS", 30_000, 300_000),
    pollMaxBackoffMs: positiveInt("CRYPTO_REWARDS_POLL_MAX_BACKOFF_MS", 900_000, 3_600_000),
    defaultUsdtSolGldPerUnit: positiveDecimal("CRYPTO_REWARDS_USDT_SOL_GLD_PER_UNIT", "0"),
    defaultUsdcSolGldPerUnit: positiveDecimal("CRYPTO_REWARDS_USDC_SOL_GLD_PER_UNIT", "0"),
    minProviderReserveUsd: nonNegativeDecimal("CRYPTO_REWARDS_MIN_PROCESSING_RESERVE_USD", "0"),
  }
}

export function isCryptoRewardCurrency(value: string): value is CryptoRewardCurrency {
  return (CRYPTO_REWARD_CURRENCIES as readonly string[]).includes(value.trim().toUpperCase())
}
