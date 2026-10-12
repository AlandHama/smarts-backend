export const CRYPTO_REWARD_ASSETS = [
  { code: "BTC", symbol: "BTC", name: "Bitcoin", networkCode: "BITCOIN", networkLabel: "Bitcoin", addressKind: "BITCOIN", category: "POPULAR" },
  { code: "ETH", symbol: "ETH", name: "Ethereum", networkCode: "ETHEREUM", networkLabel: "Ethereum", addressKind: "EVM", category: "POPULAR" },
  { code: "LTC", symbol: "LTC", name: "Litecoin", networkCode: "LITECOIN", networkLabel: "Litecoin", addressKind: "LITECOIN", category: "POPULAR" },
  { code: "TRX", symbol: "TRX", name: "TRON", networkCode: "TRON", networkLabel: "TRON", addressKind: "TRON", category: "POPULAR" },
  { code: "TON", symbol: "TON", name: "Toncoin", networkCode: "TON", networkLabel: "TON", addressKind: "TON", category: "POPULAR" },
  { code: "BNBBSC", symbol: "BNB", name: "BNB", networkCode: "BSC", networkLabel: "BNB Smart Chain", addressKind: "EVM", category: "POPULAR" },
  { code: "SOL", symbol: "SOL", name: "Solana", networkCode: "SOLANA", networkLabel: "Solana", addressKind: "SOLANA", category: "POPULAR" },
  { code: "XRP", symbol: "XRP", name: "XRP", networkCode: "XRP", networkLabel: "XRP Ledger", addressKind: "GENERIC", category: "POPULAR" },
  { code: "BCH", symbol: "BCH", name: "Bitcoin Cash", networkCode: "BITCOIN_CASH", networkLabel: "Bitcoin Cash", addressKind: "BITCOIN", category: "POPULAR" },
  { code: "DOGE", symbol: "DOGE", name: "Dogecoin", networkCode: "DOGECOIN", networkLabel: "Dogecoin", addressKind: "BITCOIN", category: "POPULAR" },
  { code: "ADA", symbol: "ADA", name: "Cardano", networkCode: "CARDANO", networkLabel: "Cardano", addressKind: "GENERIC", category: "POPULAR" },
  { code: "DOT", symbol: "DOT", name: "Polkadot", networkCode: "POLKADOT", networkLabel: "Polkadot", addressKind: "GENERIC", category: "POPULAR" },
  { code: "XMR", symbol: "XMR", name: "Monero", networkCode: "MONERO", networkLabel: "Monero", addressKind: "GENERIC", category: "POPULAR" },
  { code: "DASH", symbol: "DASH", name: "Dash", networkCode: "DASH", networkLabel: "Dash", addressKind: "GENERIC", category: "POPULAR" },
  { code: "XLM", symbol: "XLM", name: "Stellar", networkCode: "STELLAR", networkLabel: "Stellar", addressKind: "GENERIC", category: "POPULAR" },
  { code: "MATICMAINNET", symbol: "POL", name: "Polygon", networkCode: "POLYGON", networkLabel: "Polygon", addressKind: "EVM", category: "POPULAR" },
  { code: "USDTSOL", symbol: "USDT", name: "Tether USD", networkCode: "SOLANA", networkLabel: "Solana", addressKind: "SOLANA", category: "STABLECOINS" },
  { code: "USDCSOL", symbol: "USDC", name: "USD Coin", networkCode: "SOLANA", networkLabel: "Solana", addressKind: "SOLANA", category: "STABLECOINS" },
  { code: "USDTMATIC", symbol: "USDT", name: "Tether USD", networkCode: "POLYGON", networkLabel: "Polygon", addressKind: "EVM", category: "STABLECOINS" },
  { code: "USDCMATIC", symbol: "USDC", name: "USD Coin", networkCode: "POLYGON", networkLabel: "Polygon", addressKind: "EVM", category: "STABLECOINS" },
  { code: "USDTTRC20", symbol: "USDT", name: "Tether USD", networkCode: "TRON", networkLabel: "TRON", addressKind: "TRON", category: "STABLECOINS" },
  { code: "USDDTRC20", symbol: "USDD", name: "USDD", networkCode: "TRON", networkLabel: "TRON", addressKind: "TRON", category: "STABLECOINS" },
  { code: "TUSDTRC20", symbol: "TUSD", name: "TrueUSD", networkCode: "TRON", networkLabel: "TRON", addressKind: "TRON", category: "STABLECOINS" },
  { code: "USDTERC20", symbol: "USDT", name: "Tether USD", networkCode: "ETHEREUM", networkLabel: "Ethereum", addressKind: "EVM", category: "STABLECOINS" },
  { code: "USDC", symbol: "USDC", name: "USD Coin", networkCode: "ETHEREUM", networkLabel: "Ethereum", addressKind: "EVM", category: "STABLECOINS" },
  { code: "USDTBSC", symbol: "USDT", name: "Tether USD", networkCode: "BSC", networkLabel: "BNB Smart Chain", addressKind: "EVM", category: "STABLECOINS" },
  { code: "USDP", symbol: "USDP", name: "Pax Dollar", networkCode: "ETHEREUM", networkLabel: "Ethereum", addressKind: "EVM", category: "STABLECOINS" },
  { code: "DAI", symbol: "DAI", name: "Dai", networkCode: "ETHEREUM", networkLabel: "Ethereum", addressKind: "EVM", category: "STABLECOINS" },
  { code: "BUSD", symbol: "BUSD", name: "Binance USD", networkCode: "BSC", networkLabel: "BNB Smart Chain", addressKind: "EVM", category: "STABLECOINS" },
  { code: "PYUSD", symbol: "PYUSD", name: "PayPal USD", networkCode: "ETHEREUM", networkLabel: "Ethereum", addressKind: "EVM", category: "STABLECOINS" },
  { code: "EURT", symbol: "EURT", name: "Euro Tether", networkCode: "ETHEREUM", networkLabel: "Ethereum", addressKind: "EVM", category: "STABLECOINS" },
  { code: "ARB", symbol: "ARB", name: "Arbitrum", networkCode: "ARBITRUM", networkLabel: "Arbitrum", addressKind: "EVM", category: "OTHER" },
  { code: "AVAX", symbol: "AVAX", name: "Avalanche", networkCode: "AVALANCHE_C", networkLabel: "Avalanche C-Chain", addressKind: "EVM", category: "OTHER" },
  { code: "SHIB", symbol: "SHIB", name: "Shiba Inu", networkCode: "ETHEREUM", networkLabel: "Ethereum", addressKind: "EVM", category: "OTHER" },
  { code: "DGB", symbol: "DGB", name: "DigiByte", networkCode: "DIGIBYTE", networkLabel: "DigiByte", addressKind: "GENERIC", category: "OTHER" },
  { code: "VET", symbol: "VET", name: "VeChain", networkCode: "VECHAIN", networkLabel: "VeChain", addressKind: "EVM", category: "OTHER" },
  { code: "UNI", symbol: "UNI", name: "Uniswap", networkCode: "ETHEREUM", networkLabel: "Ethereum", addressKind: "EVM", category: "OTHER" },
  { code: "ZEC", symbol: "ZEC", name: "Zcash", networkCode: "ZCASH", networkLabel: "Zcash", addressKind: "GENERIC", category: "OTHER" },
  { code: "XVG", symbol: "XVG", name: "Verge", networkCode: "VERGE", networkLabel: "Verge", addressKind: "GENERIC", category: "OTHER" },
  { code: "ZBCSOL", symbol: "ZBCN", name: "Zebec Network", networkCode: "SOLANA", networkLabel: "Solana", addressKind: "SOLANA", category: "OTHER" },
] as const

export type CryptoRewardAsset = (typeof CRYPTO_REWARD_ASSETS)[number]
export type CryptoRewardCurrency = CryptoRewardAsset["code"]
export const CRYPTO_REWARD_CURRENCIES = CRYPTO_REWARD_ASSETS.map((asset) => asset.code) as readonly CryptoRewardCurrency[]
export const CRYPTO_REWARD_NETWORK = "SOLANA" as const

function positiveInt(name: string, fallback: number, max = Number.MAX_SAFE_INTEGER) { const value = Number(process.env[name]); return Number.isInteger(value) && value > 0 && value <= max ? value : fallback }
function nonNegativeInt(name: string, fallback: number, max = Number.MAX_SAFE_INTEGER) { const value = Number(process.env[name]); return Number.isInteger(value) && value >= 0 && value <= max ? value : fallback }
function positiveDecimal(name: string, fallback: string) { const value = process.env[name]?.trim(); return value && /^\d+(?:\.\d{1,6})?$/.test(value) && Number(value) > 0 ? value : fallback }
function nonNegativeDecimal(name: string, fallback: string) { const value = process.env[name]?.trim(); return value && /^\d+(?:\.\d{1,6})?$/.test(value) && Number(value) >= 0 ? value : fallback }
function nonNegativeBigInt(name: string, fallback: bigint) { const value = process.env[name]?.trim(); if (!value || !/^\d+$/.test(value)) return fallback; try { const parsed = BigInt(value); return parsed >= 0n ? parsed : fallback } catch { return fallback } }
function booleanEnv(name: string, fallback: boolean) { const value = process.env[name]?.trim().toLowerCase(); if (value === "true") return true; if (value === "false") return false; return fallback }
function envAssetRates() { try { const parsed = JSON.parse(process.env.CRYPTO_REWARDS_ASSET_RATES_JSON || "{}"); if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {}; return Object.fromEntries(Object.entries(parsed).filter(([code, value]) => isCryptoRewardCurrency(code) && typeof value === "string" && /^\d+(?:\.\d{1,6})?$/.test(value) && Number(value) > 0)) } catch { return {} } }

export function getCryptoRewardsConfig() {
  const environment = process.env.NOWPAYMENTS_ENVIRONMENT?.trim().toLowerCase() === "production" ? "production" : "sandbox"
  const configuredBaseUrl = process.env.NOWPAYMENTS_API_BASE_URL?.trim()
  const providerBaseUrl = configuredBaseUrl?.replace(/^https:\/\/api\.sandbox\.nowpayments\.io(?=\/|$)/, "https://api-sandbox.nowpayments.io") || (environment === "production" ? "https://api.nowpayments.io/v1" : "https://api-sandbox.nowpayments.io/v1")
  return {
    enabled: booleanEnv("CRYPTO_REWARDS_ENABLED", false), providerEnabled: booleanEnv("NOWPAYMENTS_ENABLED", false), providerEnvironment: environment, providerBaseUrl,
    apiKey: process.env.NOWPAYMENTS_API_KEY?.trim() || "", ipnSecret: process.env.NOWPAYMENTS_IPN_SECRET?.trim() || "", ipnCallbackUrl: process.env.CRYPTO_REWARDS_IPN_CALLBACK_URL?.trim() || process.env.NOWPAYMENTS_IPN_PUBLIC_URL?.trim() || "",
    supportedCurrencies: [...CRYPTO_REWARD_CURRENCIES], assets: CRYPTO_REWARD_ASSETS, assetRates: envAssetRates(), networkCode: CRYPTO_REWARD_NETWORK,
    requestTimeoutMs: positiveInt("NOWPAYMENTS_REQUEST_TIMEOUT_MS", 10_000, 60_000), maxRetries: nonNegativeInt("NOWPAYMENTS_MAX_RETRIES", 2, 5), quoteTtlSeconds: positiveInt("CRYPTO_REWARDS_QUOTE_TTL_SECONDS", 300, 3600), maxQuoteDriftBps: positiveInt("CRYPTO_REWARDS_MAX_QUOTE_DRIFT_BPS", 500, 10_000),
    minGld: nonNegativeBigInt("CRYPTO_REWARDS_MIN_GLD", 100n), maxGldPerRequest: nonNegativeBigInt("CRYPTO_REWARDS_MAX_GLD_PER_REQUEST", 100_000n), dailyGldLimit: nonNegativeBigInt("CRYPTO_REWARDS_DAILY_GLD_LIMIT", 200_000n), maxPendingPerUser: positiveInt("CRYPTO_REWARDS_MAX_PENDING_PER_USER", 1, 20), holdExpiryHours: positiveInt("CRYPTO_REWARDS_HOLD_EXPIRY_HOURS", 72, 720), platformFeeBps: nonNegativeInt("CRYPTO_REWARDS_PLATFORM_FEE_BPS", 0, 10_000), requireAdminApproval: booleanEnv("CRYPTO_REWARDS_REQUIRE_ADMIN_APPROVAL", true), requirePayoutVerification: booleanEnv("NOWPAYMENTS_REQUIRE_PAYOUT_VERIFICATION", true), pollIntervalMs: positiveInt("CRYPTO_REWARDS_POLL_INTERVAL_MS", 30_000, 300_000), pollMaxBackoffMs: positiveInt("CRYPTO_REWARDS_POLL_MAX_BACKOFF_MS", 900_000, 3_600_000),
    defaultUsdtSolGldPerUnit: positiveDecimal("CRYPTO_REWARDS_USDT_SOL_GLD_PER_UNIT", "0"), defaultUsdcSolGldPerUnit: positiveDecimal("CRYPTO_REWARDS_USDC_SOL_GLD_PER_UNIT", "0"), minProviderReserveUsd: nonNegativeDecimal("CRYPTO_REWARDS_MIN_PROCESSING_RESERVE_USD", "0"),
  }
}

export function getCryptoRewardAsset(value: string) { return CRYPTO_REWARD_ASSETS.find((asset) => asset.code === value.trim().toUpperCase()) }
export function isCryptoRewardCurrency(value: string): value is CryptoRewardCurrency { return Boolean(getCryptoRewardAsset(value)) }
