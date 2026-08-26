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
  const fallbackSecret =
    process.env.JWT_SECRET ??
    process.env.JWT_ACCESS_SECRET ??
    process.env[`TOKEN_SECRET_${environmentSuffix}`] ??
    process.env.TOKEN_SECRET ??
    (environmentSuffix === "PRODUCTION" ? undefined : "local-development-only-secret-change-me")

  if (!fallbackSecret) {
    throw new Error("JWT_SECRET (or JWT_ACCESS_SECRET) must be set in production")
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
    accessSecret: process.env.JWT_ACCESS_SECRET ?? fallbackSecret,
    refreshSecret: process.env.JWT_REFRESH_SECRET ?? fallbackSecret,
    accessExpiresIn,
    refreshExpiresIn,
    accessExpiresInSeconds: durationToSeconds(accessExpiresIn),
    refreshExpiresInSeconds: durationToSeconds(refreshExpiresIn),
  }
}
