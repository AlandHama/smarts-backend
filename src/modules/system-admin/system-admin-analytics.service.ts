import { BadRequestException, Injectable, Logger } from "@nestjs/common"
import { Prisma } from "@prisma/client"

import { PrismaService } from "../../prisma.service"
import { AdMobService } from "../admob/admob.service"
import { SystemAdminAnalyticsQueryDto } from "./dtos/system-admin-analytics-query.dto"

type NumericRow = Record<string, unknown>
type AnalyticsFilters = Pick<SystemAdminAnalyticsQueryDto, "country" | "platform" | "appVersion" | "gameKey" | "mode" | "audience" | "accountStatus"> & { from?: Date; to?: Date }
type AnalyticsRequest = Partial<SystemAdminAnalyticsQueryDto>

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

  constructor(private readonly prisma: PrismaService, private readonly adMobService: AdMobService) {}

  async overview(request: AnalyticsRequest | number = {}, actorId?: string) {
    const query: AnalyticsRequest = typeof request === "number" ? { days: request } : request
    const range = this.resolveRange(query)
    const { from, to, days, filters } = range
    const retentionTo = new Date(to)

    const [trend, summary, answerSummary, matchSummary, commerceSummary, gameRows, progressionRows, retention, countries, deviceReport, timeSummary, health, admob, freshness, comparison] = await Promise.all([
      this.safeQuery("daily trend", this.trend(from, to, filters), []),
      this.safeQuery("active-user summary", this.summary(from, to, filters), []),
      this.safeQuery("answer summary", this.answerSummary(from, to, filters), []),
      this.safeQuery("match summary", this.matchSummary(from, to, filters), []),
      this.safeQuery("commerce summary", this.commerceSummary(from, to, filters), []),
      this.safeQuery("game breakdown", this.gameBreakdown(from, to, filters), []),
      this.safeQuery("progression breakdown", this.progressionBreakdown(from, to, filters), []),
      this.safeQuery("retention", this.retention(from, retentionTo, filters), []),
      this.safeQuery("country breakdown", this.countryBreakdown(from, to, filters), []),
      this.safeQuery("device breakdown", this.deviceBreakdown(from, to, filters), this.emptyDeviceReport()),
      this.safeQuery("play-time summary", this.timeSummary(from, to, filters), []),
      this.safeQuery("live health", this.health(), { onlinePlayers: 0, searchingTickets: 0, activeMatches: 0, failedOutbox: 0, openFeedback: 0 }),
      this.safeQuery("AdMob analytics", this.adMobService.analytics(days), this.adMobService.emptyAnalyticsForSystemAdmin(days)),
      this.safeQuery("analytics freshness", this.freshness(), this.emptyFreshness()),
      query.comparison === "none" ? Promise.resolve(null) : this.safeQuery("comparison snapshot", this.comparisonSnapshot(from, to, filters), null),
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

    const report = this.serialize({
      period: { from, to, days, timezone: range.timezone, resolution: range.resolution },
      comparison,
      filters: this.publicFilters(filters),
      freshness,
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
      devices: deviceReport.platforms.map((row) => ({ type: String(row.type), users: this.number(row.users), sessions: this.number(row.sessions) })),
      deviceInsights: {
        platforms: deviceReport.platforms.map((row) => ({ type: String(row.type), users: this.number(row.users), sessions: this.number(row.sessions) })),
        operatingSystems: deviceReport.operatingSystems.map((row) => ({ name: String(row.name), version: String(row.version), users: this.number(row.users), sessions: this.number(row.sessions) })),
        models: deviceReport.models.map((row) => ({ manufacturer: String(row.manufacturer), model: String(row.model), users: this.number(row.users), sessions: this.number(row.sessions) })),
      },
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
      admob,
      health,
      metricDefinitions: this.metricDefinitions(),
      warnings: freshness.warnings,
    })
    if (actorId) await this.auditReportAccess(actorId, "VIEW", query, report.period)
    return report
  }

  private async trend(from: Date, to: Date, filters?: AnalyticsFilters) {
    const auditFilters = this.playerFilters(filters, "audit_user", "audit_profile")
    const sessionFilters = this.sessionFilters(filters, "activity_session", "session_user", "session_profile")
    const matchFilters = this.matchFilters(filters, "activity_match")
    const newPlayerFilters = this.playerFilters(filters, "new_user", "new_profile")
    const createdMatchFilters = this.matchFilters(filters, "created_match")
    const settledMatchFilters = this.matchFilters(filters, "settled_match")
    const answerMatchFilters = this.matchFilters(filters, "answer_match")
    const xpOwnerFilters = filters?.country || filters?.accountStatus ? this.ownerFilter(filters, '"ProgressionEvent"."userId"') : Prisma.empty
    const walletOwnerFilters = filters?.country || filters?.accountStatus ? this.ownerFilter(filters, '"WalletTransaction"."userId"') : Prisma.empty
    const purchaseOwnerFilters = filters?.country || filters?.accountStatus ? this.ownerFilter(filters, '"Purchase"."userId"') : Prisma.empty
    return this.prisma.$queryRaw<Array<NumericRow>>(Prisma.sql`
      WITH days AS (
        SELECT generate_series(date_trunc('day', ${from}::timestamp), date_trunc('day', ${to}::timestamp), interval '1 day') AS day
      ), activity AS (
        SELECT audit_event."userId", audit_event."createdAt" AS occurred_at FROM "PlayerAuditEvent" audit_event JOIN "User" audit_user ON audit_user."id" = audit_event."userId" LEFT JOIN "PlayerProfile" audit_profile ON audit_profile."userId" = audit_user."id" WHERE audit_event."createdAt" >= ${from} AND audit_event."createdAt" <= ${to} ${auditFilters}
        UNION ALL SELECT activity_session."userId", activity_session."loginTimestamp" FROM "Session" activity_session JOIN "User" session_user ON session_user."id" = activity_session."userId" LEFT JOIN "PlayerProfile" session_profile ON session_profile."userId" = session_user."id" WHERE activity_session."loginTimestamp" >= ${from} AND activity_session."loginTimestamp" <= ${to} ${sessionFilters}
        UNION ALL SELECT activity_participant."userId", activity_event."serverReceivedAt" FROM "MatchEvent" activity_event JOIN "MatchParticipant" activity_participant ON activity_participant."id" = activity_event."participantId" JOIN "Match" activity_match ON activity_match."id" = activity_event."matchId" WHERE activity_participant."userId" IS NOT NULL AND activity_event."serverReceivedAt" >= ${from} AND activity_event."serverReceivedAt" <= ${to} ${matchFilters}
      ), daily_activity AS (
        SELECT date_trunc('day', occurred_at) AS day, count(DISTINCT "userId") AS dau FROM activity GROUP BY 1
      ), daily_new AS (
        SELECT date_trunc('day', new_user."createdAt") AS day, count(*) AS new_players FROM "User" new_user LEFT JOIN "PlayerProfile" new_profile ON new_profile."userId" = new_user."id" WHERE new_user."createdAt" >= ${from} AND new_user."createdAt" <= ${to} ${newPlayerFilters} GROUP BY 1
      ), daily_matches AS (
        SELECT date_trunc('day', created_match."createdAt") AS day, count(*) AS matches_created FROM "Match" created_match WHERE created_match."createdAt" >= ${from} AND created_match."createdAt" <= ${to} ${createdMatchFilters} GROUP BY 1
      ), daily_settled AS (
        SELECT date_trunc('day', COALESCE(settled_match."settledAt", settled_match."endedAt")) AS day, count(*) AS matches_settled FROM "Match" settled_match WHERE settled_match."status" = 'SETTLED' AND COALESCE(settled_match."settledAt", settled_match."endedAt") >= ${from} AND COALESCE(settled_match."settledAt", settled_match."endedAt") <= ${to} ${settledMatchFilters} GROUP BY 1
      ), daily_answers AS (
        SELECT date_trunc('day', answer_event."serverReceivedAt") AS day, count(*) AS answers, count(*) FILTER (WHERE answer_event."payload"->>'correct' = 'true') AS correct_answers FROM "MatchEvent" answer_event JOIN "Match" answer_match ON answer_match."id" = answer_event."matchId" WHERE answer_event."eventType" IN ('ANSWER', 'SKIP') AND answer_event."accepted" = true AND answer_event."serverReceivedAt" >= ${from} AND answer_event."serverReceivedAt" <= ${to} ${answerMatchFilters} GROUP BY 1
      ), daily_xp AS (
        SELECT date_trunc('day', "createdAt") AS day, COALESCE(sum("delta"), 0) AS xp_awarded FROM "ProgressionEvent" WHERE "delta" > 0 AND "createdAt" >= ${from} AND "createdAt" <= ${to} ${xpOwnerFilters} GROUP BY 1
      ), daily_wallet AS (
        SELECT date_trunc('day', "createdAt") AS day, COALESCE(sum("amount") FILTER (WHERE "direction" = 'CREDIT'), 0) AS wallet_credits, COALESCE(sum("amount") FILTER (WHERE "direction" = 'DEBIT'), 0) AS wallet_debits FROM "WalletTransaction" WHERE "createdAt" >= ${from} AND "createdAt" <= ${to} ${walletOwnerFilters} GROUP BY 1
      ), daily_purchases AS (
        SELECT date_trunc('day', COALESCE("completedAt", "createdAt")) AS day, count(*) FILTER (WHERE "status" = 'COMPLETED') AS purchases FROM "Purchase" WHERE COALESCE("completedAt", "createdAt") >= ${from} AND COALESCE("completedAt", "createdAt") <= ${to} ${purchaseOwnerFilters} GROUP BY 1
      ), daily_play AS (
        SELECT days.day,
          COALESCE(SUM(GREATEST(0, EXTRACT(EPOCH FROM (
            LEAST(COALESCE(s."lastActiveTimestamp", ${to}), s."loginTimestamp" + interval '12 hours', days.day + interval '1 day', ${to})
            - GREATEST(s."loginTimestamp", days.day, ${from})
          )))), 0) AS play_seconds
        FROM days
        LEFT JOIN "Session" s ON s."loginTimestamp" < days.day + interval '1 day'
          AND COALESCE(s."lastActiveTimestamp", ${to}) > days.day
        JOIN "User" session_actor ON session_actor."id" = s."userId" AND session_actor."isSystemAdmin" = false LEFT JOIN "PlayerProfile" session_profile ON session_profile."userId" = session_actor."id"
        WHERE 1 = 1 ${this.sessionFilters(filters, "s", "session_actor", "session_profile")}
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
          ${this.matchFilters(filters, "m")}
        GROUP BY days.day
      )
      SELECT days.day, COALESCE(daily_activity.dau, 0) AS dau, COALESCE(daily_new.new_players, 0) AS new_players, COALESCE(daily_matches.matches_created, 0) AS matches_created, COALESCE(daily_settled.matches_settled, 0) AS matches_settled, COALESCE(daily_answers.answers, 0) AS answers, COALESCE(daily_answers.correct_answers, 0) AS correct_answers, COALESCE(daily_xp.xp_awarded, 0) AS xp_awarded, COALESCE(daily_wallet.wallet_credits, 0) AS wallet_credits, COALESCE(daily_wallet.wallet_debits, 0) AS wallet_debits, COALESCE(daily_purchases.purchases, 0) AS purchases, COALESCE(daily_play.play_seconds, 0) AS play_seconds, COALESCE(daily_match_play.match_play_seconds, 0) AS match_play_seconds
      FROM days LEFT JOIN daily_activity USING (day) LEFT JOIN daily_new USING (day) LEFT JOIN daily_matches USING (day) LEFT JOIN daily_settled USING (day) LEFT JOIN daily_answers USING (day) LEFT JOIN daily_xp USING (day) LEFT JOIN daily_wallet USING (day) LEFT JOIN daily_purchases USING (day) LEFT JOIN daily_play USING (day) LEFT JOIN daily_match_play USING (day) ORDER BY days.day ASC
    `)
  }

  private timeSummary(from: Date, to: Date, filters?: AnalyticsFilters) {
    const sessionFilters = this.sessionFilters(filters, "s", "u", "p")
    const matchFilters = this.matchFilters(filters, "m")
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
        LEFT JOIN "PlayerProfile" p ON p."userId" = u."id"
        WHERE s."loginTimestamp" <= ${to} AND s."lastActiveTimestamp" >= ${from} ${sessionFilters}
      ), match_rows AS (
        SELECT GREATEST(0, EXTRACT(EPOCH FROM (
          LEAST(m."endedAt", ${to}) - GREATEST(m."startedAt", ${from})
        ))) AS duration_seconds
        FROM "Match" m
        WHERE m."startedAt" IS NOT NULL AND m."endedAt" IS NOT NULL
          AND m."startedAt" <= ${to} AND m."endedAt" >= ${from}
          ${matchFilters}
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

  private summary(from: Date, to: Date, filters?: AnalyticsFilters) {
    const auditFilters = this.playerFilters(filters, "summary_audit_user", "summary_audit_profile")
    const sessionFilters = this.sessionFilters(filters, "summary_session", "summary_session_user", "summary_session_profile")
    const matchFilters = this.matchFilters(filters, "summary_match")
    const newPlayerFilters = this.playerFilters(filters, "summary_new_user", "summary_new_profile")
    return this.prisma.$queryRaw<Array<NumericRow>>(Prisma.sql`
      WITH activity AS (
        SELECT summary_audit_event."userId", summary_audit_event."createdAt" AS occurred_at FROM "PlayerAuditEvent" summary_audit_event JOIN "User" summary_audit_user ON summary_audit_user."id" = summary_audit_event."userId" LEFT JOIN "PlayerProfile" summary_audit_profile ON summary_audit_profile."userId" = summary_audit_user."id" WHERE summary_audit_event."createdAt" <= ${to} ${auditFilters}
        UNION ALL SELECT summary_session."userId", summary_session."loginTimestamp" FROM "Session" summary_session JOIN "User" summary_session_user ON summary_session_user."id" = summary_session."userId" LEFT JOIN "PlayerProfile" summary_session_profile ON summary_session_profile."userId" = summary_session_user."id" WHERE summary_session."loginTimestamp" <= ${to} ${sessionFilters}
        UNION ALL SELECT p."userId", e."serverReceivedAt" FROM "MatchEvent" e JOIN "MatchParticipant" p ON p."id" = e."participantId" JOIN "Match" summary_match ON summary_match."id" = e."matchId" WHERE p."userId" IS NOT NULL AND e."serverReceivedAt" <= ${to} ${matchFilters}
      )
      SELECT count(DISTINCT "userId") FILTER (WHERE occurred_at >= ${from}) AS period_active_users, count(DISTINCT "userId") FILTER (WHERE occurred_at >= ${this.daysBefore(to, 7)}) AS wau, count(DISTINCT "userId") FILTER (WHERE occurred_at >= ${this.daysBefore(to, 30)}) AS mau, (SELECT count(*) FROM "User" summary_new_user LEFT JOIN "PlayerProfile" summary_new_profile ON summary_new_profile."userId" = summary_new_user."id" WHERE summary_new_user."createdAt" >= ${from} AND summary_new_user."createdAt" <= ${to} ${newPlayerFilters}) AS new_players FROM activity
    `)
  }

  private answerSummary(from: Date, to: Date, filters?: AnalyticsFilters) {
    return this.prisma.$queryRaw<Array<NumericRow>>(Prisma.sql`SELECT count(*) AS answers, count(*) FILTER (WHERE e."payload"->>'correct' = 'true') AS correct_answers, COALESCE(avg(CASE WHEN e."payload"->>'timeTakenMs' ~ '^[0-9]+$' THEN (e."payload"->>'timeTakenMs')::numeric END), 0) AS average_time_ms FROM "MatchEvent" e JOIN "Match" answer_match ON answer_match."id" = e."matchId" WHERE e."eventType" IN ('ANSWER', 'SKIP') AND e."accepted" = true AND e."serverReceivedAt" >= ${from} AND e."serverReceivedAt" <= ${to} ${this.matchFilters(filters, "answer_match")}`)
  }

  private matchSummary(from: Date, to: Date, filters?: AnalyticsFilters) {
    return this.prisma.$queryRaw<Array<NumericRow>>(Prisma.sql`SELECT count(*) AS created, count(*) FILTER (WHERE m."startedAt" IS NOT NULL) AS started, count(*) FILTER (WHERE m."status" = 'SETTLED') AS settled, count(*) FILTER (WHERE m."status" = 'REVIEW') AS review, count(*) FILTER (WHERE m."status" = 'CANCELLED') AS cancelled, count(*) FILTER (WHERE m."status" = 'SETTLED' AND (m."settlementJson"->>'draw')::boolean = true) AS draws, count(*) FILTER (WHERE m."mode" = 'BOT') AS bot_matches, COALESCE(avg(EXTRACT(EPOCH FROM (m."endedAt" - m."startedAt"))) FILTER (WHERE m."endedAt" IS NOT NULL AND m."startedAt" IS NOT NULL), 0) AS average_duration_seconds FROM "Match" m LEFT JOIN "MatchSettlement" ON "MatchSettlement"."matchId" = m."id" WHERE m."createdAt" >= ${from} AND m."createdAt" <= ${to} ${this.matchFilters(filters, "m")}`)
  }

  private commerceSummary(from: Date, to: Date, filters?: AnalyticsFilters) {
    const purchaseFilter = this.ownerFilter(filters, '"Purchase"."userId"')
    const adFilter = this.ownerFilter(filters, '"AdRewardClaim"."userId"')
    const paidRewardFilter = this.ownerFilter(filters, '"PaidRewardRequest"."userId"')
    return this.prisma.$queryRaw<Array<NumericRow>>(Prisma.sql`SELECT (SELECT count(*) FROM "Purchase" WHERE "status" = 'COMPLETED' AND COALESCE("completedAt", "createdAt") BETWEEN ${from} AND ${to} ${purchaseFilter}) AS completed_purchases, (SELECT COALESCE(sum("totalAmount"), 0) FROM "Purchase" WHERE "status" = 'COMPLETED' AND COALESCE("completedAt", "createdAt") BETWEEN ${from} AND ${to} ${purchaseFilter}) AS purchase_value, (SELECT count(*) FROM "AdRewardClaim" WHERE "createdAt" BETWEEN ${from} AND ${to} ${adFilter}) AS ad_claims, (SELECT count(*) FROM "AdRewardClaim" WHERE "status" = 'GRANTED' AND "createdAt" BETWEEN ${from} AND ${to} ${adFilter}) AS granted_ad_claims, (SELECT count(*) FROM "AdRewardClaim" WHERE "status" = 'REJECTED' AND "createdAt" BETWEEN ${from} AND ${to} ${adFilter}) AS rejected_ad_claims, (SELECT count(*) FROM "PaidRewardRequest" WHERE "requestedAt" BETWEEN ${from} AND ${to} ${paidRewardFilter}) AS paid_reward_requests, (SELECT count(*) FROM "PaidRewardRequest" WHERE "status" = 'FULFILLED' AND "decidedAt" BETWEEN ${from} AND ${to} ${paidRewardFilter}) AS fulfilled_paid_rewards, (SELECT count(*) FROM "PaidRewardRequest" WHERE "status" = 'REFUSED' AND "decidedAt" BETWEEN ${from} AND ${to} ${paidRewardFilter}) AS refused_paid_rewards`)
  }

  private gameBreakdown(from: Date, to: Date, filters?: AnalyticsFilters) {
    const matchRowsFilter = this.matchFilters(filters, "match_rows_match")
    const answerRowsFilter = this.matchFilters(filters, "answer_rows_match")
    const scoreRowsFilter = this.matchFilters(filters, "score_rows_match")
    return this.prisma.$queryRaw<Array<NumericRow>>(Prisma.sql`
      WITH match_rows AS (
        SELECT "gameDefinitionId", count(*) AS matches,
          count(*) FILTER (WHERE "status" = 'SETTLED') AS settled,
          count(*) FILTER (WHERE "status" = 'REVIEW') AS review
        FROM "Match" match_rows_match
        WHERE match_rows_match."createdAt" BETWEEN ${from} AND ${to} ${matchRowsFilter}
        GROUP BY match_rows_match."gameDefinitionId"
      ), answer_rows AS (
        SELECT answer_rows_match."gameDefinitionId",
          count(*) FILTER (WHERE e."eventType" IN ('ANSWER', 'SKIP') AND e."accepted" = true) AS accepted_answers,
          count(*) FILTER (WHERE e."eventType" IN ('ANSWER', 'SKIP') AND e."accepted" = true AND e."payload"->>'correct' = 'true') AS correct_answers
        FROM "Match" answer_rows_match JOIN "MatchEvent" e ON e."matchId" = answer_rows_match."id"
        WHERE answer_rows_match."createdAt" BETWEEN ${from} AND ${to} ${answerRowsFilter}
        GROUP BY answer_rows_match."gameDefinitionId"
      ), score_rows AS (
        SELECT score_rows_match."gameDefinitionId", COALESCE(avg(mp."finalScore") FILTER (WHERE mp."finalScore" IS NOT NULL), 0) AS average_score
        FROM "Match" score_rows_match JOIN "MatchParticipant" mp ON mp."matchId" = score_rows_match."id"
        WHERE score_rows_match."createdAt" BETWEEN ${from} AND ${to} ${scoreRowsFilter}
        GROUP BY score_rows_match."gameDefinitionId"
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

  private progressionBreakdown(from: Date, to: Date, filters?: AnalyticsFilters) {
    const playerFilter = this.playerFilters(filters, "progression_user", "progression_profile")
    const eventFilter = this.ownerFilter(filters, 'pe."userId"')
    return this.prisma.$queryRaw<Array<NumericRow>>(Prisma.sql`SELECT pd."key", pd."name", count(pp."id") AS players, COALESCE(avg(pp."points"), 0) AS average_points, COALESCE(max(pp."step"), 0) AS highest_step, (SELECT COALESCE(sum(pe."delta"), 0) FROM "ProgressionEvent" pe WHERE pe."progressionId" = pd."id" AND pe."createdAt" BETWEEN ${from} AND ${to} ${eventFilter}) AS period_delta FROM "ProgressionDefinition" pd LEFT JOIN "PlayerProgression" pp ON pp."progressionId" = pd."id" LEFT JOIN "User" progression_user ON progression_user."id" = pp."userId" ${playerFilter} LEFT JOIN "PlayerProfile" progression_profile ON progression_profile."userId" = progression_user."id" GROUP BY pd."id", pd."key", pd."name" ORDER BY pd."key" ASC`)
  }

  private retention(from: Date, to: Date, filters?: AnalyticsFilters) {
    const playerFilter = this.playerFilters(filters, "retention_user", "retention_profile")
    return this.prisma.$queryRaw<Array<NumericRow>>(Prisma.sql`
      WITH activity AS (
        SELECT "userId", "createdAt" AS occurred_at FROM "PlayerAuditEvent"
        UNION ALL SELECT "userId", "loginTimestamp" FROM "Session"
        UNION ALL SELECT p."userId", e."serverReceivedAt" FROM "MatchEvent" e JOIN "MatchParticipant" p ON p."id" = e."participantId" WHERE p."userId" IS NOT NULL
      )
      SELECT count(*) FILTER (WHERE retention_user."createdAt" <= ${this.daysBefore(to, 1)}) AS day1_eligible, count(*) FILTER (WHERE retention_user."createdAt" <= ${this.daysBefore(to, 1)} AND EXISTS (SELECT 1 FROM activity a WHERE a."userId" = retention_user."id" AND (a.occurred_at - retention_user."createdAt") >= interval '1 day' AND (a.occurred_at - retention_user."createdAt") < interval '2 days')) AS day1_retained, count(*) FILTER (WHERE retention_user."createdAt" <= ${this.daysBefore(to, 7)}) AS day7_eligible, count(*) FILTER (WHERE retention_user."createdAt" <= ${this.daysBefore(to, 7)} AND EXISTS (SELECT 1 FROM activity a WHERE a."userId" = retention_user."id" AND (a.occurred_at - retention_user."createdAt") >= interval '7 days' AND (a.occurred_at - retention_user."createdAt") < interval '8 days')) AS day7_retained, count(*) FILTER (WHERE retention_user."createdAt" <= ${this.daysBefore(to, 30)}) AS day30_eligible, count(*) FILTER (WHERE retention_user."createdAt" <= ${this.daysBefore(to, 30)} AND EXISTS (SELECT 1 FROM activity a WHERE a."userId" = retention_user."id" AND (a.occurred_at - retention_user."createdAt") >= interval '30 days' AND (a.occurred_at - retention_user."createdAt") < interval '31 days')) AS day30_retained FROM "User" retention_user LEFT JOIN "PlayerProfile" retention_profile ON retention_profile."userId" = retention_user."id" WHERE retention_user."createdAt" BETWEEN ${from} AND ${to} ${playerFilter}
    `)
  }

  private countryBreakdown(from: Date, to: Date, filters?: AnalyticsFilters) {
    const playerFilter = this.playerFilters(filters, "country_user", "country_profile")
    return this.prisma.$queryRaw<Array<NumericRow>>(Prisma.sql`WITH active AS (SELECT DISTINCT a."userId" FROM "PlayerAuditEvent" a WHERE a."createdAt" BETWEEN ${from} AND ${to} UNION SELECT DISTINCT s."userId" FROM "Session" s WHERE s."loginTimestamp" BETWEEN ${from} AND ${to}) SELECT COALESCE(country_profile."countryCode", 'UN') AS country_code, count(DISTINCT active."userId") AS active_users, count(DISTINCT country_user."id") FILTER (WHERE country_user."createdAt" BETWEEN ${from} AND ${to}) AS new_players FROM active JOIN "User" country_user ON country_user."id" = active."userId" LEFT JOIN "PlayerProfile" country_profile ON country_profile."userId" = country_user."id" WHERE 1 = 1 ${playerFilter} GROUP BY COALESCE(country_profile."countryCode", 'UN') ORDER BY active_users DESC LIMIT 10`)
  }

  private async deviceBreakdown(from: Date, to: Date, filters?: AnalyticsFilters) {
    const sessionFilters = this.sessionFilters(filters, "s", "device_user", "device_profile")
    const [platforms, operatingSystems, models] = await Promise.all([
      this.prisma.$queryRaw<Array<NumericRow>>(Prisma.sql`SELECT COALESCE(NULLIF(s."platform", ''), CASE WHEN s."isMobileSession" = true THEN 'mobile' ELSE 'web' END) AS type, count(DISTINCT s."userId") AS users, count(*) AS sessions FROM "Session" s JOIN "User" device_user ON device_user."id" = s."userId" LEFT JOIN "PlayerProfile" device_profile ON device_profile."userId" = device_user."id" WHERE s."loginTimestamp" BETWEEN ${from} AND ${to} ${sessionFilters} GROUP BY 1 ORDER BY users DESC`),
      this.prisma.$queryRaw<Array<NumericRow>>(Prisma.sql`SELECT COALESCE(NULLIF(s."osName", ''), 'Unknown') AS name, COALESCE(NULLIF(s."osVersion", ''), 'Unknown') AS version, count(DISTINCT s."userId") AS users, count(*) AS sessions FROM "Session" s JOIN "User" device_user ON device_user."id" = s."userId" LEFT JOIN "PlayerProfile" device_profile ON device_profile."userId" = device_user."id" WHERE s."loginTimestamp" BETWEEN ${from} AND ${to} ${sessionFilters} GROUP BY 1, 2 ORDER BY users DESC LIMIT 20`),
      this.prisma.$queryRaw<Array<NumericRow>>(Prisma.sql`SELECT COALESCE(NULLIF(s."deviceManufacturer", ''), 'Unknown') AS manufacturer, COALESCE(NULLIF(s."deviceModel", ''), 'Unknown') AS model, count(DISTINCT s."userId") AS users, count(*) AS sessions FROM "Session" s JOIN "User" device_user ON device_user."id" = s."userId" LEFT JOIN "PlayerProfile" device_profile ON device_profile."userId" = device_user."id" WHERE s."loginTimestamp" BETWEEN ${from} AND ${to} ${sessionFilters} GROUP BY 1, 2 ORDER BY users DESC LIMIT 20`),
    ])
    return { platforms, operatingSystems, models }
  }

  private emptyDeviceReport() {
    return { platforms: [] as NumericRow[], operatingSystems: [] as NumericRow[], models: [] as NumericRow[] }
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

  private async comparisonSnapshot(from: Date, to: Date, filters: AnalyticsFilters) {
    const span = to.getTime() - from.getTime()
    const comparisonTo = new Date(from.getTime() - 1)
    const comparisonFrom = new Date(comparisonTo.getTime() - span)
    const [trend, summary, answers, matches, commerce, time] = await Promise.all([
      this.trend(comparisonFrom, comparisonTo, filters),
      this.summary(comparisonFrom, comparisonTo, filters),
      this.answerSummary(comparisonFrom, comparisonTo, filters),
      this.matchSummary(comparisonFrom, comparisonTo, filters),
      this.commerceSummary(comparisonFrom, comparisonTo, filters),
      this.timeSummary(comparisonFrom, comparisonTo, filters),
    ])
    const answerCount = this.number(answers[0]?.answers)
    const matchCount = this.number(matches[0]?.created)
    const timeRow = time[0] ?? {}
    return {
      period: { from: comparisonFrom, to: comparisonTo },
      kpis: {
        averageDau: trend.length ? Math.round(trend.reduce((sum, row) => sum + this.number(row.dau), 0) / trend.length) : 0,
        periodActiveUsers: this.number(summary[0]?.period_active_users),
        newPlayers: this.number(summary[0]?.new_players),
        matchesSettled: this.number(matches[0]?.settled),
        completionRate: matchCount ? Math.round((this.number(matches[0]?.settled) / matchCount) * 1000) / 10 : 0,
        accuracy: answerCount ? Math.round((this.number(answers[0]?.correct_answers) / answerCount) * 1000) / 10 : 0,
        xpAwarded: this.number(trend.reduce((sum, row) => sum + this.number(row.xpAwarded), 0)),
        purchaseValue: this.number(commerce[0]?.purchase_value),
        totalPlayHours: Math.round((this.number(timeRow.total_play_seconds) / 3600) * 100) / 100,
        averageSessionMinutes: Math.round((this.number(timeRow.average_session_seconds) / 60) * 10) / 10,
      },
    }
  }

  async exportCsv(request: AnalyticsRequest = {}, actorId?: string) {
    const report = await this.overview({ ...request, comparison: "none" }, undefined)
    if (actorId) await this.auditReportAccess(actorId, "EXPORT_CSV", request, report.period)
    const lines = [
      ["SMARTS analytics report", ""],
      ["from", report.period.from],
      ["to", report.period.to],
      ["timezone", report.period.timezone],
      ["freshness", report.freshness.status],
      [],
      ["date", "dau", "new_players", "matches_created", "matches_settled", "answers", "correct_answers", "xp_awarded", "wallet_credits", "wallet_debits", "purchases", "play_hours", "match_play_hours"],
      ...report.trends.map((row) => [row.date, row.dau, row.newPlayers, row.matchesCreated, row.matchesSettled, row.answers, row.correctAnswers, row.xpAwarded, row.walletCredits, row.walletDebits, row.purchases, row.playHours, row.matchPlayHours]),
    ]
    return lines.map((line) => line.map((value) => this.csvCell(value)).join(",")).join("\n") + "\n"
  }

  private resolveRange(query: AnalyticsRequest) {
    const now = new Date()
    const requestedDays = Math.min(Math.max(Number(query.days) || 30, 1), 365)
    const parse = (value: string, endOfDay = false) => {
      const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value)
      const parsed = dateOnly
        ? new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`)
        : new Date(value)
      if (Number.isNaN(parsed.getTime())) throw new BadRequestException("Invalid analytics date range")
      return parsed
    }
    const to = query.to ? parse(query.to, true) : now
    const from = query.from
      ? parse(query.from)
      : new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate() - (requestedDays - 1)))
    const span = to.getTime() - from.getTime()
    if (span < 0 || span > 365 * 24 * 60 * 60 * 1000) throw new BadRequestException("Analytics date range must be between 1 and 366 days")
    const days = Math.max(1, Math.ceil(span / (24 * 60 * 60 * 1000))) + 1
    const filters: AnalyticsFilters = {
      country: query.country?.trim().toUpperCase() || undefined,
      platform: query.platform?.trim() || undefined,
      appVersion: query.appVersion?.trim() || undefined,
      gameKey: query.gameKey?.trim() || undefined,
      mode: query.mode?.trim().toUpperCase() || undefined,
      audience: query.audience || "all",
      accountStatus: query.accountStatus?.trim().toUpperCase() || undefined,
      from,
      to,
    }
    return {
      from,
      to,
      days,
      timezone: query.timezone?.trim() || "UTC",
      resolution: query.resolution && query.resolution !== "auto" ? query.resolution : days <= 31 ? "day" : days <= 180 ? "week" : "month",
      filters,
    }
  }

  private async freshness() {
    const state = await this.prisma.analyticsRefreshState.findUnique({ where: { key: "server-events" } })
    if (!state) return this.emptyFreshness()
    const stale = !state.completedAt || Date.now() - state.completedAt.getTime() > 15 * 60 * 1000
    const status = state.status === "FAILED" ? "failed" : state.status === "COMPLETE" && !stale ? "fresh" : state.status === "COMPLETE" ? "stale" : "partial"
    const warnings = [
      ...(status === "stale" ? ["Analytics aggregate refresh is older than 15 minutes."] : []),
      ...(status === "failed" ? [state.error || "Analytics aggregate refresh failed."] : []),
      ...(status === "partial" ? ["Analytics aggregates are still being refreshed."] : []),
    ]
    return { status, source: "PostgreSQL authoritative tables", dataThrough: state.dataThrough, lastRefresh: state.completedAt, rowCount: state.rowCount, warnings }
  }

  private emptyFreshness() {
    return { status: "partial", source: "PostgreSQL authoritative tables", dataThrough: null, lastRefresh: null, rowCount: 0, warnings: ["Analytics aggregates have not completed their first refresh."] }
  }

  private metricDefinitions() {
    return [
      { key: "dau", label: "DAU today", definition: "Distinct non-admin players active during the latest UTC day.", freshnessTargetMinutes: 15 },
      { key: "periodActiveUsers", label: "Active players", definition: "Distinct non-admin players with authoritative activity in the selected range.", freshnessTargetMinutes: 15 },
      { key: "matchesSettled", label: "Matches settled", definition: "Matches whose server settlement completed in the selected range.", freshnessTargetMinutes: 15 },
      { key: "accuracy", label: "Answer accuracy", definition: "Correct accepted answer events divided by accepted answer and skip events.", freshnessTargetMinutes: 15 },
      { key: "xpAwarded", label: "XP awarded", definition: "Positive server-owned progression deltas in the selected range.", freshnessTargetMinutes: 15 },
      { key: "purchaseValue", label: "Purchase value", definition: "Completed purchase total amount in the selected range.", freshnessTargetMinutes: 15 },
    ]
  }

  private publicFilters(filters: AnalyticsFilters) {
    return {
      country: filters.country,
      platform: filters.platform,
      appVersion: filters.appVersion,
      gameKey: filters.gameKey,
      mode: filters.mode,
      audience: filters.audience,
      accountStatus: filters.accountStatus,
    }
  }

  private async auditReportAccess(actorId: string, action: "VIEW" | "EXPORT_CSV", query: AnalyticsRequest, period: { from: Date | string; to: Date | string; timezone: string }) {
    await this.prisma.adminAuditEvent.create({
      data: {
        actorId,
        action: `ANALYTICS_${action}`,
        entityType: "AnalyticsReport",
        entityId: "overview",
        reason: action === "VIEW" ? "Viewed analytics overview" : "Exported analytics overview CSV",
        metadata: {
          from: period.from,
          to: period.to,
          timezone: period.timezone,
          filters: {
            country: query.country,
            platform: query.platform,
            appVersion: query.appVersion,
            gameKey: query.gameKey,
            mode: query.mode,
            audience: query.audience,
            accountStatus: query.accountStatus,
          },
        } as Prisma.InputJsonValue,
      },
    }).catch((error) => this.logger.warn(`Analytics audit write failed: ${error instanceof Error ? error.message : String(error)}`))
  }

  private csvCell(value: unknown) {
    const text = value === null || value === undefined ? "" : String(value)
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
  }

  private playerFilters(filters: AnalyticsFilters | undefined, userAlias: string, profileAlias: string) {
    if (!filters) return Prisma.empty
    const user = Prisma.raw(userAlias)
    const profile = Prisma.raw(profileAlias)
    const conditions = [Prisma.sql`${user}."isSystemAdmin" = false`]
    if (filters.country) conditions.push(Prisma.sql`COALESCE(${profile}."countryCode", 'UN') = ${filters.country}`)
    if (filters.accountStatus) conditions.push(Prisma.sql`${user}."status" = ${filters.accountStatus}`)
    if (filters.audience === "new" && filters.from && filters.to) conditions.push(Prisma.sql`${user}."createdAt" >= ${filters.from} AND ${user}."createdAt" <= ${filters.to}`)
    if (filters.audience === "returning" && filters.from) conditions.push(Prisma.sql`${user}."createdAt" < ${filters.from}`)
    return Prisma.sql`AND ${Prisma.join(conditions, " AND ")}`
  }

  private sessionFilters(filters: AnalyticsFilters | undefined, sessionAlias: string, userAlias: string, profileAlias: string) {
    if (!filters) return Prisma.empty
    const session = Prisma.raw(sessionAlias)
    const conditions = [this.playerFilters(filters, userAlias, profileAlias)]
    if (filters.platform) conditions.push(Prisma.sql`COALESCE(NULLIF(${session}."platform", ''), CASE WHEN ${session}."isMobileSession" = true THEN 'mobile' ELSE 'web' END) = ${filters.platform}`)
    if (filters.appVersion) conditions.push(Prisma.sql`COALESCE(${session}."clientVersion", ${session}."appBuildNumber", '') = ${filters.appVersion}`)
    return Prisma.sql`${Prisma.join(conditions, " ")}`
  }

  private ownerFilter(filters: AnalyticsFilters | undefined, ownerExpression: string) {
    if (!filters?.country && !filters?.accountStatus) return Prisma.empty
    const userAlias = "owner_filter_user"
    const profileAlias = "owner_filter_profile"
    return Prisma.sql`AND EXISTS (SELECT 1 FROM "User" ${Prisma.raw(userAlias)} LEFT JOIN "PlayerProfile" ${Prisma.raw(profileAlias)} ON ${Prisma.raw(profileAlias)}."userId" = ${Prisma.raw(userAlias)}."id" WHERE ${Prisma.raw(userAlias)}."id" = ${Prisma.raw(ownerExpression)} ${this.playerFilters(filters, userAlias, profileAlias)})`
  }

  private matchFilters(filters: AnalyticsFilters | undefined, matchAlias: string) {
    if (!filters) return Prisma.empty
    const match = Prisma.raw(matchAlias)
    const conditions = [Prisma.sql`${match}."id" IS NOT NULL`]
    if (filters.gameKey) conditions.push(Prisma.sql`EXISTS (SELECT 1 FROM "GameDefinition" filter_game WHERE filter_game."id" = ${match}."gameDefinitionId" AND filter_game."key" = ${filters.gameKey})`)
    if (filters.mode) conditions.push(Prisma.sql`${match}."mode" = ${filters.mode}`)
    if (filters.country || filters.accountStatus) {
      const user = Prisma.raw(`${matchAlias}_filter_user`)
      const profile = Prisma.raw(`${matchAlias}_filter_profile`)
      conditions.push(Prisma.sql`EXISTS (SELECT 1 FROM "MatchParticipant" ${Prisma.raw(`${matchAlias}_filter_participant`)} JOIN "User" ${user} ON ${user}."id" = ${Prisma.raw(`${matchAlias}_filter_participant`)}."userId" LEFT JOIN "PlayerProfile" ${profile} ON ${profile}."userId" = ${user}."id" WHERE ${Prisma.raw(`${matchAlias}_filter_participant`)}."matchId" = ${match}."id" ${this.playerFilters(filters, `${matchAlias}_filter_user`, `${matchAlias}_filter_profile`)})`)
    }
    return Prisma.sql`AND ${Prisma.join(conditions, " AND ")}`
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
