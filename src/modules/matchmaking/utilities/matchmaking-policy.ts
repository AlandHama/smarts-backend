export function environmentSeconds(name: string, fallback: number, minimum: number, maximum: number) {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value >= minimum && value <= maximum ? Math.floor(value) : fallback
}

export function queueTtlSeconds() { return environmentSeconds("MATCHMAKING_QUEUE_TTL_SECONDS", 30, 10, 300) }
export function queueHeartbeatTimeoutSeconds() { return environmentSeconds("MATCHMAKING_HEARTBEAT_TIMEOUT_SECONDS", 45, 15, 600) }
export function botFallbackSeconds() { return environmentSeconds("MATCHMAKING_BOT_FALLBACK_SECONDS", 20, 10, 300) }
export function matchmakerBatchSize() { return environmentSeconds("MATCHMAKING_BATCH_SIZE", 20, 1, 100) }
export function friendInviteTtlSeconds() { return environmentSeconds("MATCHMAKING_FRIEND_INVITE_TTL_SECONDS", 120, 30, 3600) }
