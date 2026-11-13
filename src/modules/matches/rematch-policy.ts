/**
 * Daily casual rematch allowance for one player pair.
 *
 * The original match is not a rematch, so a player may play that match and
 * then request up to ten rematches with the same opponent during the rolling
 * 24-hour window.
 */
export const MAX_DAILY_REMATCHES_PER_OPPONENT = 10

/** Total pair matches allowed when creating a casual match directly. */
export const MAX_DAILY_CASUAL_PAIR_MATCHES = MAX_DAILY_REMATCHES_PER_OPPONENT + 1
