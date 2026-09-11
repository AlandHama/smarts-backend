import { Injectable, Logger } from "@nestjs/common"
import { Prisma } from "@prisma/client"

import { PrismaService } from "../../prisma.service"

type NumericRow = Record<string, unknown>

/**
 * Read-only reporting over the authoritative Railway tables.
 *
 * SMARTS does not accept client-written analytics events. These reports are
 * therefore deliberately built from sessions, player audit events, accepted
 * match events, settled matches, ledgers, purchases, and projections.
 */
@Injectable()
export class SystemAdminAnalyticsService {
  private readonly logger = new Logger(SystemAdminAnalyticsService.name)

  constructor(private readonly prisma: PrismaService) {}

  async overview(requestedDays = 30) {
    const days = Math.min(Math.max(Number(requestedDays) || 30, 7), 365)
    const to = new Date()
    const from = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate() - (days - 1)))
    const retentionTo = new Date(to)

    const [trend, summary, answerSummary, matchSummary, commerceSummary, gameRows, progressionRows, retention, countries, devices, timeSummary, health] = await Promise.all([
      this.safeQuery("daily trend", this.trend(from, to), []),
      this.safeQuery("active-user summary", this.summary(from, to), []),
      this.safeQuery("answer summary", this.answerSummary(from, to), []),
      this.safeQuery("match summary", this.matchSummary(from, to), []),
      this.safeQuery("commerce summary", this.commerceSummary(from, to), []),
      this.safeQuery("game breakdown", this.gameBreakdown(from, to), []),
      this.safeQuery("progression breakdown", this.progressionBreakdown(from, to), []),
      this.safeQuery("retention", this.retention(from, retentionTo), []),
      this.safeQuery("country breakdown", this.countryBreakdown(from, to), []),
      this.safeQuery("device breakdown", this.deviceBreakdown(from, to), []),
      this.safeQuery("play-time summary", this.timeSummary(from, to), []),
      this.safeQuery("live health", this.health(), { onlinePlayers: 0, searchingTickets: 0, activeMatches: 0, failedOutbox: 0, openFeedback: 0 }),
    ])

    const averageDau = trend.length ? Math.round(trend.reduce((sum, row) => sum + this.number(row.dau), 0) / trend.length) : 0
    const latestDau = trend.length ? this.number(trend[trend.length - 1].dau) : 0
    const answers = this.number(answerSummary[0]?.answers)
    const correctAnswers = this.number(answerSummary[0]?.correct_answers)
    const periodMatches = this.number(matchSummary[0]?.created)
    const settledMatches = this.number(matchSummary[0]?.settled)
    const walletCredits = this.number(trend.reduce((sum, row) => sum + this.number(row.walletCredits), 0))
    const walletDebits = this.number(trend.reduce((sum, row) => sum + this.number(row.walletDebits), 0))
    const time = timeSummary[0] ?? {}
    const totalPlaySeconds = this.number(time.total_play_seconds)
    const averageDailyPlayHours = days ? Math.round((totalPlaySeconds / 3600 / days) * 100) / 100 : 0

    return this.serialize({
      period: { from, to, days, timezone: "UTC" },
      kpis: {
        dau: latestDau,
        averageDau,
        periodActiveUsers: this.number(summary[0]?.period_active_users),
        wau: this.number(summary[0]?.wau),
        mau: this.number(summary[0]?.mau),
        newPlayers: this.number(summary[0]?.new_players),
        matchesStarted: this.number(matchSummary[0]?.started),
        matchesCreated: periodMatches,
        matchesSettled: settledMatches,
        completionRate: periodMatches ? Math.round((settledMatches / periodMatches) * 1000) / 10 : 0,
        acceptedAnswers: answers,
        correctAnswers,
        accuracy: answers ? Math.round((correctAnswers / answers) * 1000) / 10 : 0,
        averageAnswerTimeMs: this.number(answerSummary[0]?.average_time_ms),
        xpAwarded: this.number(trend.reduce((sum, row) => sum + this.number(row.xpAwarded), 0)),
        walletCredits,
        walletDebits,
        completedPurchases: this.number(commerceSummary[0]?.completed_purchases),
        purchaseValue: this.number(commerceSummary[0]?.purchase_value),
        grantedAdClaims: this.number(commerceSummary[0]?.granted_ad_claims),
        fulfilledPaidRewards: this.number(commerceSummary[0]?.fulfilled_paid_rewards),
        totalPlayHours: Math.round((totalPlaySeconds / 3600) * 100) / 100,
        averageDailyPlayHours,
        averageSessionMinutes: Math.round((this.number(time.average_session_seconds) / 60) * 10) / 10,
      },
      trends: trend.map((row) => ({
        date: row.day,
        dau: this.number(row.dau),
        newPlayers: this.number(row.new_players),
        matchesCreated: this.number(row.matches_created),
        matchesSettled: this.number(row.matches_settled),
        answers: this.number(row.answers),
        correctAnswers: this.number(row.correct_answers),
        xpAwarded: this.number(row.xp_awarded),
        walletCredits: this.number(row.wallet_credits),
        walletDebits: this.number(row.wallet_debits),
        purchases: this.number(row.purchases),
        playHours: Math.round((this.number(row.play_seconds) / 3600) * 100) / 100,
        matchPlayHours: Math.round((this.number(row.match_play_seconds) / 3600) * 100) / 100,
      })),
      games: gameRows.map((row) => ({
        key: String(row.key),
        name: String(row.name),
        matches: this.number(row.matches),
        settled: this.number(row.settled),
        review: this.number(row.review),
        acceptedAnswers: this.number(row.accepted_answers),
        correctAnswers: this.number(row.correct_answers),
        accuracy: this.number(row.accepted_answers) ? Math.round((this.number(row.correct_answers) / this.number(row.accepted_answers)) * 1000) / 10 : 0,
        averageScore: this.number(row.average_score),
      })),
      retention: retention[0] ? {
        day1: this.retentionRate(retention[0], "day1"),
        day7: this.retentionRate(retention[0], "day7"),
        day30: this.retentionRate(retention[0], "day30"),
      } : { day1: this.emptyRetention(), day7: this.emptyRetention(), day30: this.emptyRetention() },
      progression: progressionRows.map((row) => ({
        key: String(row.key),
        name: String(row.name),
        players: this.number(row.players),
        averagePoints: this.number(row.average_points),
        highestStep: this.number(row.highest_step),
        periodDelta: this.number(row.period_delta),
      })),
      countries: countries.map((row) => ({ countryCode: String(row.country_code || "UN"), activeUsers: this.number(row.active_users), newPlayers: this.number(row.new_players) })),
      devices: devices.map((row) => ({ type: String(row.type), users: this.number(row.users), sessions: this.number(row.sessions) })),
      gameplay: {
        averageMatchDurationSeconds: this.number(matchSummary[0]?.average_duration_seconds),
        reviewMatches: this.number(matchSummary[0]?.review),
        cancelledMatches: this.number(matchSummary[0]?.cancelled),
        drawMatches: this.number(matchSummary[0]?.draws),
        botMatches: this.number(matchSummary[0]?.bot_matches),
      },
      playTime: {
        totalSeconds: totalPlaySeconds,
        totalHours: Math.round((totalPlaySeconds / 3600) * 100) / 100,
        averageDailyHours: averageDailyPlayHours,
        activeDays: this.number(time.active_days),
        sessions: this.number(time.sessions),
        players: this.number(time.players),
        averageSessionMinutes: Math.round((this.number(time.average_session_seconds) / 60) * 10) / 10,
        longestSessionMinutes: Math.round((this.number(time.longest_session_seconds) / 60) * 10) / 10,
        matchPlayHours: Math.round((this.number(time.match_play_seconds) / 3600) * 100) / 100,
      },
      economy: {
        adClaims: this.number(commerceSummary[0]?.ad_claims),
        rejectedAdClaims: this.number(commerceSummary[0]?.rejected_ad_claims),
        paidRewardRequests: this.number(commerceSummary[0]?.paid_reward_requests),
        refusedPaidRewards: this.number(commerceSummary[0]?.refused_paid_rewards),
      },
      health,
    })
  }

  private async trend(from: Date, to: Date) {
    return this.prisma.$queryRaw<Array<NumericRow>>(Prisma.sql`
      WITH days AS (
        SELECT generate_series(date_trunc('day', ${from}::timestamp), date_trunc('day', ${to}::timestamp), interval '1 day') AS day
      ), activity AS (
        SELECT "userId", "createdAt" AS occurred_at FROM "PlayerAuditEvent" WHERE "createdAt" >= ${from} AND "createdAt" <= ${to}
        UNION ALL SELECT "userId", "loginTimestamp" FROM "Session" WHERE "loginTimestamp" >= ${from} AND "loginTimestamp" <= ${to}
        UNION ALL SELECT p."userId", e."serverReceivedAt" FROM "MatchEvent" e JOIN "MatchParticipant" p ON p."id" = e."participantId" WHERE p."userId" IS NOT NULL AND e."serverReceivedAt" >= ${from} AND e."serverReceivedAt" <= ${to}
      ), daily_activity AS (
        SELECT date_trunc('day', occurred_at) AS day, count(DISTINCT "userId") AS dau FROM activity GROUP BY 1
      ), daily_new AS (
        SELECT date_trunc('day', "createdAt") AS day, count(*) AS new_players FROM "User" WHERE "createdAt" >= ${from} AND "createdAt" <= ${to} GROUP BY 1
      ), daily_matches AS (
        SELECT date_trunc('day', "createdAt") AS day, count(*) AS matches_created FROM "Match" WHERE "createdAt" >= ${from} AND "createdAt" <= ${to} GROUP BY 1
      ), daily_settled AS (
        SELECT date_trunc('day', COALESCE("settledAt", "endedAt")) AS day, count(*) AS matches_settled FROM "Match" WHERE "status" = 'SETTLED' AND COALESCE("settledAt", "endedAt") >= ${from} AND COALESCE("settledAt", "endedAt") <= ${to} GROUP BY 1
      ), daily_answers AS (
        SELECT date_trunc('day', "serverReceivedAt") AS day, count(*) AS answers, count(*) FILTER (WHERE payload->>'correct' = 'true') AS correct_answers FROM "MatchEvent" WHERE "eventType" = 'ANSWER' AND "accepted" = true AND "serverReceivedAt" >= ${from} AND "serverReceivedAt" <= ${to} GROUP BY 1
      ), daily_xp AS (
        SELECT date_trunc('day', "createdAt") AS day, COALESCE(sum("delta"), 0) AS xp_awarded FROM "ProgressionEvent" WHERE "delta" > 0 AND "createdAt" >= ${from} AND "createdAt" <= ${to} GROUP BY 1
      ), daily_wallet AS (
        SELECT date_trunc('day', "createdAt") AS day, COALESCE(sum("amount") FILTER (WHERE "direction" = 'CREDIT'), 0) AS wallet_credits, COALESCE(sum("amount") FILTER (WHERE "direction" = 'DEBIT'), 0) AS wallet_debits FROM "WalletTransaction" WHERE "createdAt" >= ${from} AND "createdAt" <= ${to} GROUP BY 1
      ), daily_purchases AS (
        SELECT date_trunc('day', COALESCE("completedAt", "createdAt")) AS day, count(*) FILTER (WHERE "status" = 'COMPLETED') AS purchases FROM "Purchase" WHERE COALESCE("completedAt", "createdAt") >= ${from} AND COALESCE("completedAt", "createdAt") <= ${to} GROUP BY 1
      ), daily_play AS (
        SELECT days.day,
          COALESCE(SUM(GREATEST(0, EXTRACT(EPOCH FROM (
            LEAST(COALESCE(s."lastActiveTimestamp", ${to}), s."loginTimestamp" + interval '12 hours', days.day + interval '1 day', ${to})
            - GREATEST(s."loginTimestamp", days.day, ${from})
          )))), 0) AS play_seconds
        FROM days
        LEFT JOIN "Session" s ON s."loginTimestamp" < days.day + interval '1 day'
          AND COALESCE(s."lastActiveTimestamp", ${to}) > days.day
        JOIN "User" session_user ON session_user."id" = s."userId" AND session_user."isSystemAdmin" = false
        GROUP BY days.day
      ), daily_match_play AS (
        SELECT days.day,
          COALESCE(SUM(GREATEST(0, EXTRACT(EPOCH FROM (
            LEAST(m."endedAt", days.day + interval '1 day', ${to})
            - GREATEST(m."startedAt", days.day, ${from})
          )))), 0) AS match_play_seconds
        FROM days
        LEFT JOIN "Match" m ON m."startedAt" IS NOT NULL AND m."endedAt" IS NOT NULL
          AND m."startedAt" < days.day + interval '1 day'
          AND m."endedAt" > days.day
        GROUP BY days.day
      )
      SELECT days.day, COALESCE(daily_activity.dau, 0) AS dau, COALESCE(daily_new.new_players, 0) AS new_players, COALESCE(daily_matches.matches_created, 0) AS matches_created, COALESCE(daily_settled.matches_settled, 0) AS matches_settled, COALESCE(daily_answers.answers, 0) AS answers, COALESCE(daily_answers.correct_answers, 0) AS correct_answers, COALESCE(daily_xp.xp_awarded, 0) AS xp_awarded, COALESCE(daily_wallet.wallet_credits, 0) AS wallet_credits, COALESCE(daily_wallet.wallet_debits, 0) AS wallet_debits, COALESCE(daily_purchases.purchases, 0) AS purchases, COALESCE(daily_play.play_seconds, 0) AS play_seconds, COALESCE(daily_match_play.match_play_seconds, 0) AS match_play_seconds
      FROM days LEFT JOIN daily_activity USING (day) LEFT JOIN daily_new USING (day) LEFT JOIN daily_matches USING (day) LEFT JOIN daily_settled USING (day) LEFT JOIN daily_answers USING (day) LEFT JOIN daily_xp USING (day) LEFT JOIN daily_wallet USING (day) LEFT JOIN daily_purchases USING (day) LEFT JOIN daily_play USING (day) LEFT JOIN daily_match_play USING (day) ORDER BY days.day ASC
    `)
  }

  private timeSummary(from: Date, to: Date) {
    return this.prisma.$queryRaw<Array<NumericRow>>(Prisma.sql`
      WITH session_rows AS (
        SELECT
          GREATEST(0, EXTRACT(EPOCH FROM (
            LEAST(s."lastActiveTimestamp", s."loginTimestamp" + interval '12 hours', ${to})
            - GREATEST(s."loginTimestamp", ${from})
          ))) AS duration_seconds,
          s."userId" AS user_id,
          s."loginTimestamp" AS login_at
        FROM "Session" s
        JOIN "User" u ON u."id" = s."userId" AND u."isSystemAdmin" = false
        WHERE s."loginTimestamp" <= ${to} AND s."lastActiveTimestamp" >= ${from}
      ), match_rows AS (
        SELECT GREATEST(0, EXTRACT(EPOCH FROM (
          LEAST(m."endedAt", ${to}) - GREATEST(m."startedAt", ${from})
        ))) AS duration_seconds
        FROM "Match" m
        WHERE m."startedAt" IS NOT NULL AND m."endedAt" IS NOT NULL
          AND m."startedAt" <= ${to} AND m."endedAt" >= ${from}
      )
      SELECT
        COALESCE(SUM(duration_seconds), 0) AS total_play_seconds,
        COALESCE(AVG(duration_seconds), 0) AS average_session_seconds,
        COALESCE(MAX(duration_seconds), 0) AS longest_session_seconds,
        COUNT(*) AS sessions,
        COUNT(DISTINCT user_id) AS players,
        COUNT(DISTINCT date_trunc('day', login_at)) AS active_days,
        (SELECT COALESCE(SUM(duration_seconds), 0) FROM match_rows) AS match_play_seconds
      FROM session_rows
    `)
  }

  private summary(from: Date, to: Date) {
    return this.prisma.$queryRaw<Array<NumericRow>>(Prisma.sql`
      WITH activity AS (
        SELECT "userId", "createdAt" AS occurred_at FROM "PlayerAuditEvent" WHERE "createdAt" <= ${to}
        UNION ALL SELECT "userId", "loginTimestamp" FROM "Session" WHERE "loginTimestamp" <= ${to}
        UNION ALL SELECT p."userId", e."serverReceivedAt" FROM "MatchEvent" e JOIN "MatchParticipant" p ON p."id" = e."participantId" WHERE p."userId" IS NOT NULL AND e."serverReceivedAt" <= ${to}
      )
      SELECT count(DISTINCT "userId") FILTER (WHERE occurred_at >= ${from}) AS period_active_users, count(DISTINCT "userId") FILTER (WHERE occurred_at >= ${this.daysBefore(to, 7)}) AS wau, count(DISTINCT "userId") FILTER (WHERE occurred_at >= ${this.daysBefore(to, 30)}) AS mau, (SELECT count(*) FROM "User" WHERE "createdAt" >= ${from} AND "createdAt" <= ${to}) AS new_players FROM activity
    `)
  }

  private answerSummary(from: Date, to: Date) {
    return this.prisma.$queryRaw<Array<NumericRow>>(Prisma.sql`SELECT count(*) AS answers, count(*) FILTER (WHERE payload->>'correct' = 'true') AS correct_answers, COALESCE(avg(CASE WHEN payload->>'timeTakenMs' ~ '^[0-9]+$' THEN (payload->>'timeTakenMs')::numeric END), 0) AS average_time_ms FROM "MatchEvent" WHERE "eventType" = 'ANSWER' AND "accepted" = true AND "serverReceivedAt" >= ${from} AND "serverReceivedAt" <= ${to}`)
  }

  private matchSummary(from: Date, to: Date) {
    return this.prisma.$queryRaw<Array<NumericRow>>(Prisma.sql`SELECT count(*) AS created, count(*) FILTER (WHERE "startedAt" IS NOT NULL) AS started, count(*) FILTER (WHERE "status" = 'SETTLED') AS settled, count(*) FILTER (WHERE "status" = 'REVIEW') AS review, count(*) FILTER (WHERE "status" = 'CANCELLED') AS cancelled, count(*) FILTER (WHERE "status" = 'SETTLED' AND ("settlementJson"->>'draw')::boolean = true) AS draws, count(*) FILTER (WHERE "mode" = 'BOT') AS bot_matches, COALESCE(avg(EXTRACT(EPOCH FROM ("endedAt" - "startedAt"))) FILTER (WHERE "endedAt" IS NOT NULL AND "startedAt" IS NOT NULL), 0) AS average_duration_seconds FROM "Match" LEFT JOIN "MatchSettlement" ON "MatchSettlement"."matchId" = "Match"."id" WHERE "Match"."createdAt" >= ${from} AND "Match"."createdAt" <= ${to}`)
  }

  private commerceSummary(from: Date, to: Date) {
    return this.prisma.$queryRaw<Array<NumericRow>>(Prisma.sql`SELECT (SELECT count(*) FROM "Purchase" WHERE "status" = 'COMPLETED' AND COALESCE("completedAt", "createdAt") BETWEEN ${from} AND ${to}) AS completed_purchases, (SELECT COALESCE(sum("totalAmount"), 0) FROM "Purchase" WHERE "status" = 'COMPLETED' AND COALESCE("completedAt", "createdAt") BETWEEN ${from} AND ${to}) AS purchase_value, (SELECT count(*) FROM "AdRewardClaim" WHERE "createdAt" BETWEEN ${from} AND ${to}) AS ad_claims, (SELECT count(*) FROM "AdRewardClaim" WHERE "status" = 'GRANTED' AND "createdAt" BETWEEN ${from} AND ${to}) AS granted_ad_claims, (SELECT count(*) FROM "AdRewardClaim" WHERE "status" = 'REJECTED' AND "createdAt" BETWEEN ${from} AND ${to}) AS rejected_ad_claims, (SELECT count(*) FROM "PaidRewardRequest" WHERE "requestedAt" BETWEEN ${from} AND ${to}) AS paid_reward_requests, (SELECT count(*) FROM "PaidRewardRequest" WHERE "status" = 'FULFILLED' AND "decidedAt" BETWEEN ${from} AND ${to}) AS fulfilled_paid_rewards, (SELECT count(*) FROM "PaidRewardRequest" WHERE "status" = 'REFUSED' AND "decidedAt" BETWEEN ${from} AND ${to}) AS refused_paid_rewards`)
  }

  private gameBreakdown(from: Date, to: Date) {
    return this.prisma.$queryRaw<Array<NumericRow>>(Prisma.sql`
      WITH match_rows AS (
        SELECT "gameDefinitionId", count(*) AS matches,
          count(*) FILTER (WHERE "status" = 'SETTLED') AS settled,
          count(*) FILTER (WHERE "status" = 'REVIEW') AS review
        FROM "Match"
        WHERE "createdAt" BETWEEN ${from} AND ${to}
        GROUP BY "gameDefinitionId"
      ), answer_rows AS (
        SELECT m."gameDefinitionId",
          count(*) FILTER (WHERE e."eventType" = 'ANSWER' AND e."accepted" = true) AS accepted_answers,
          count(*) FILTER (WHERE e."eventType" = 'ANSWER' AND e."accepted" = true AND e."payload"->>'correct' = 'true') AS correct_answers
        FROM "Match" m JOIN "MatchEvent" e ON e."matchId" = m."id"
        WHERE m."createdAt" BETWEEN ${from} AND ${to}
        GROUP BY m."gameDefinitionId"
      ), score_rows AS (
        SELECT m."gameDefinitionId", COALESCE(avg(mp."finalScore") FILTER (WHERE mp."finalScore" IS NOT NULL), 0) AS average_score
        FROM "Match" m JOIN "MatchParticipant" mp ON mp."matchId" = m."id"
        WHERE m."createdAt" BETWEEN ${from} AND ${to}
        GROUP BY m."gameDefinitionId"
      )
      SELECT gd."key", gd."name", COALESCE(m.matches, 0) AS matches,
        COALESCE(m.settled, 0) AS settled, COALESCE(m.review, 0) AS review,
        COALESCE(a.accepted_answers, 0) AS accepted_answers,
        COALESCE(a.correct_answers, 0) AS correct_answers,
        COALESCE(s.average_score, 0) AS average_score
      FROM "GameDefinition" gd
      LEFT JOIN match_rows m ON m."gameDefinitionId" = gd."id"
      LEFT JOIN answer_rows a ON a."gameDefinitionId" = gd."id"
      LEFT JOIN score_rows s ON s."gameDefinitionId" = gd."id"
      ORDER BY matches DESC, gd."key" ASC
    `)
  }

  private progressionBreakdown(from: Date, to: Date) {
    return this.prisma.$queryRaw<Array<NumericRow>>(Prisma.sql`SELECT pd."key", pd."name", count(pp."id") AS players, COALESCE(avg(pp."points"), 0) AS average_points, COALESCE(max(pp."step"), 0) AS highest_step, (SELECT COALESCE(sum(pe."delta"), 0) FROM "ProgressionEvent" pe WHERE pe."progressionId" = pd."id" AND pe."createdAt" BETWEEN ${from} AND ${to}) AS period_delta FROM "ProgressionDefinition" pd LEFT JOIN "PlayerProgression" pp ON pp."progressionId" = pd."id" GROUP BY pd."id", pd."key", pd."name" ORDER BY pd."key" ASC`)
  }

  private retention(from: Date, to: Date) {
    return this.prisma.$queryRaw<Array<NumericRow>>(Prisma.sql`
      WITH activity AS (
        SELECT "userId", "createdAt" AS occurred_at FROM "PlayerAuditEvent"
        UNION ALL SELECT "userId", "loginTimestamp" FROM "Session"
        UNION ALL SELECT p."userId", e."serverReceivedAt" FROM "MatchEvent" e JOIN "MatchParticipant" p ON p."id" = e."participantId" WHERE p."userId" IS NOT NULL
      )
      SELECT count(*) FILTER (WHERE u."createdAt" <= ${this.daysBefore(to, 1)}) AS day1_eligible, count(*) FILTER (WHERE u."createdAt" <= ${this.daysBefore(to, 1)} AND EXISTS (SELECT 1 FROM activity a WHERE a."userId" = u."id" AND (a.occurred_at - u."createdAt") >= interval '1 day' AND (a.occurred_at - u."createdAt") < interval '2 days')) AS day1_retained, count(*) FILTER (WHERE u."createdAt" <= ${this.daysBefore(to, 7)}) AS day7_eligible, count(*) FILTER (WHERE u."createdAt" <= ${this.daysBefore(to, 7)} AND EXISTS (SELECT 1 FROM activity a WHERE a."userId" = u."id" AND (a.occurred_at - u."createdAt") >= interval '7 days' AND (a.occurred_at - u."createdAt") < interval '8 days')) AS day7_retained, count(*) FILTER (WHERE u."createdAt" <= ${this.daysBefore(to, 30)}) AS day30_eligible, count(*) FILTER (WHERE u."createdAt" <= ${this.daysBefore(to, 30)} AND EXISTS (SELECT 1 FROM activity a WHERE a."userId" = u."id" AND (a.occurred_at - u."createdAt") >= interval '30 days' AND (a.occurred_at - u."createdAt") < interval '31 days')) AS day30_retained FROM "User" u WHERE u."createdAt" BETWEEN ${from} AND ${to}
    `)
  }

  private countryBreakdown(from: Date, to: Date) {
    return this.prisma.$queryRaw<Array<NumericRow>>(Prisma.sql`WITH active AS (SELECT DISTINCT a."userId" FROM "PlayerAuditEvent" a WHERE a."createdAt" BETWEEN ${from} AND ${to} UNION SELECT DISTINCT s."userId" FROM "Session" s WHERE s."loginTimestamp" BETWEEN ${from} AND ${to}) SELECT COALESCE(p."countryCode", 'UN') AS country_code, count(DISTINCT active."userId") AS active_users, count(DISTINCT u."id") FILTER (WHERE u."createdAt" BETWEEN ${from} AND ${to}) AS new_players FROM active JOIN "User" u ON u."id" = active."userId" LEFT JOIN "PlayerProfile" p ON p."userId" = u."id" GROUP BY COALESCE(p."countryCode", 'UN') ORDER BY active_users DESC LIMIT 10`)
  }

  private deviceBreakdown(from: Date, to: Date) {
    return this.prisma.$queryRaw<Array<NumericRow>>(Prisma.sql`SELECT CASE WHEN "isMobileSession" = true THEN 'Mobile' ELSE 'Web' END AS type, count(DISTINCT "userId") AS users, count(*) AS sessions FROM "Session" WHERE "loginTimestamp" BETWEEN ${from} AND ${to} GROUP BY 1 ORDER BY users DESC`)
  }

  private async health() {
    const now = new Date()
    const [onlinePlayers, searchingTickets, activeMatches, failedOutbox, openFeedback] = await this.prisma.$transaction([
      this.prisma.presence.count({ where: { lastHeartbeatAt: { gt: new Date(now.getTime() - 5 * 60 * 1000) }, user: { status: "ACTIVE" } } }),
      this.prisma.matchmakingTicket.count({ where: { status: "SEARCHING", expiresAt: { gt: now } } }),
      this.prisma.match.count({ where: { status: "STARTED" } }),
      this.prisma.outboxEvent.count({ where: { status: "FAILED" } }),
      this.prisma.playerFeedback.count({ where: { status: { in: ["OPEN", "IN_REVIEW"] } } }),
    ])
    return { onlinePlayers, searchingTickets, activeMatches, failedOutbox, openFeedback }
  }

  private daysBefore(value: Date, days: number) {
    return new Date(value.getTime() - days * 24 * 60 * 60 * 1000)
  }

  private async safeQuery<T>(label: string, query: Promise<T>, fallback: T) {
    try {
      return await query
    } catch (error) {
      this.logger.error(`Analytics report failed: ${label}`, error instanceof Error ? error.stack : String(error))
      return fallback
    }
  }

  private retentionRate(row: NumericRow, key: "day1" | "day7" | "day30") {
    const eligible = this.number(row[`${key}_eligible`])
    const retained = this.number(row[`${key}_retained`])
    return { eligible, retained, rate: eligible ? Math.round((retained / eligible) * 1000) / 10 : 0 }
  }

  private emptyRetention() { return { eligible: 0, retained: 0, rate: 0 } }

  private number(value: unknown) {
    if (typeof value === "bigint") return Number(value)
    if (typeof value === "number") return Number.isFinite(value) ? value : 0
    if (value && typeof value === "object" && "toString" in value) return Number(value.toString()) || 0
    return Number(value) || 0
  }

  private serialize<T>(value: T): T {
    return JSON.parse(JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item instanceof Prisma.Decimal ? item.toString() : item)) as T
  }
}
