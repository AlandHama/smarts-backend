export interface AuthConfig {
  accessSecret: string
  refreshSecret: string
  accessExpiresIn: string
  refreshExpiresIn: string
  accessExpiresInSeconds: number
  refreshExpiresInSeconds: number
}

function durationToSeconds(value: string): number {
  if (/^\d+$/.test(value)) return Number(value)
  const match = value.trim().match(/^(\d+)\s*(s|m|h|d)$/i)
  if (!match) throw new Error(`Invalid JWT duration: ${value}`)
  const amount = Number(match[1])
  const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 }
  return amount * multipliers[match[2].toLowerCase()]
}

export function getAuthConfig(): AuthConfig {
  const environmentSuffix =
    (process.env.ENVIRONMENT ?? process.env.NODE_ENV ?? "development").toLowerCase() === "production"
      ? "PRODUCTION"
      : "DEVELOPMENT"
  const sharedSecret =
    process.env.JWT_SECRET ??
    process.env[`TOKEN_SECRET_${environmentSuffix}`] ??
    process.env.TOKEN_SECRET
  const developmentFallback = environmentSuffix === "PRODUCTION" ? undefined : "local-development-only-secret-change-me"
  const accessSecret = process.env.JWT_ACCESS_SECRET ?? sharedSecret ?? developmentFallback
  const refreshSecret = process.env.JWT_REFRESH_SECRET ?? sharedSecret ?? developmentFallback

  if (environmentSuffix === "PRODUCTION" && (!accessSecret || !refreshSecret)) {
    throw new Error("JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be set separately in production")
  }
  if (!accessSecret || !refreshSecret) {
    throw new Error("JWT authentication secrets are not configured")
  }

  const accessExpiresIn =
    process.env.JWT_ACCESS_EXPIRES_IN ??
    process.env[`ACCESS_TOKEN_EXPIRES_IN_${environmentSuffix}`] ??
    process.env.ACCESS_TOKEN_EXPIRES_IN ??
    "15m"
  const refreshExpiresIn =
    process.env.JWT_REFRESH_EXPIRES_IN ??
    process.env[`REFRESH_TOKEN_EXPIRES_IN_${environmentSuffix}`] ??
    process.env.REFRESH_TOKEN_EXPIRES_IN ??
    "30d"

  return {
    accessSecret,
    refreshSecret,
    accessExpiresIn,
    refreshExpiresIn,
    accessExpiresInSeconds: durationToSeconds(accessExpiresIn),
    refreshExpiresInSeconds: durationToSeconds(refreshExpiresIn),
  }
}
