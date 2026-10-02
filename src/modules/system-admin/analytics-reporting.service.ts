import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common"
import { Prisma } from "@prisma/client"

import { PrismaService } from "../../prisma.service"
import { SystemAdminAnalyticsQueryDto } from "./dtos/system-admin-analytics-query.dto"
import { AnalyticsAlertRuleDto, AnalyticsPlayerExplorerQueryDto, AnalyticsSavedReportDto, AnalyticsScheduledReportDto } from "./dtos/analytics-report.dto"

type Range = { from: Date; to: Date; timezone: string; resolution: string }

const REPORTS = ["engagement", "gameplay", "progression", "economy", "social", "support", "risk", "platform"] as const
type ReportKey = typeof REPORTS[number]

@Injectable()
export class AnalyticsReportingService {
  constructor(private readonly prisma: PrismaService) {}

  private range(query: SystemAdminAnalyticsQueryDto): Range {
    const to = query.to ? new Date(query.to) : new Date()
    const from = query.from ? new Date(query.from) : new Date(to.getTime() - (query.days || 30) * 86400000)
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from >= to) throw new BadRequestException("Invalid analytics date range")
    if (to.getTime() - from.getTime() > 366 * 86400000) throw new BadRequestException("Analytics range cannot exceed 366 days")
    return { from, to, timezone: query.timezone || "UTC", resolution: query.resolution === "auto" ? (to.getTime() - from.getTime() > 90 * 86400000 ? "week" : "day") : (query.resolution || "day") }
  }

  private n(value: unknown) { return typeof value === "bigint" ? Number(value) : Number(value || 0) }
  private rows(rows: Array<Record<string, unknown>>) { return rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, typeof value === "bigint" ? Number(value) : value]))) }
  private async sql<T extends Record<string, unknown>>(query: Prisma.Sql, fallback: T[] = []): Promise<T[]> {
    try { return this.rows(await this.prisma.$queryRaw<T[]>(query)) as T[] } catch { return fallback }
  }
  private dateFilter(from: Date, to: Date) { return Prisma.sql`WHERE "createdAt" >= ${from} AND "createdAt" <= ${to}` }
  private key(value: string | undefined) { return value?.trim() || undefined }

  async report(key: string, query: SystemAdminAnalyticsQueryDto, actorId?: string) {
    if (!REPORTS.includes(key as ReportKey)) throw new NotFoundException("Analytics report not found")
    const range = this.range(query)
    const filters = { country: this.key(query.country), platform: this.key(query.platform), appVersion: this.key(query.appVersion), gameKey: this.key(query.gameKey), mode: this.key(query.mode), audience: query.audience || "all", accountStatus: this.key(query.accountStatus) }
    const [trend, breakdowns, tables, quality] = await Promise.all([
      this.trend(key as ReportKey, range, query),
      this.breakdowns(key as ReportKey, range, query),
      this.tables(key as ReportKey, range, query),
      this.quality(),
    ])
    if (actorId) await this.audit(actorId, "analytics.report.view", key, { filters, range }).catch(() => undefined)
    const totals = trend.reduce<Record<string, number>>((acc, row) => { for (const [name, value] of Object.entries(row)) if (name !== "bucket") acc[name] = (acc[name] || 0) + this.n(value); return acc }, {})
    return { key, range, filters, generatedAt: new Date().toISOString(), freshness: quality.some((item) => item.status !== "PASS") ? "partial" : "fresh", definitionVersion: 1, kpis: this.kpis(key as ReportKey, totals, trend), trend, breakdowns, tables, quality, warnings: quality.filter((item) => item.status !== "PASS") }
  }

  private async trend(key: ReportKey, r: Range, query: SystemAdminAnalyticsQueryDto) {
    const bucket = r.resolution === "month" ? "month" : r.resolution === "week" ? "week" : "day"
    const b = Prisma.sql`date_trunc(${bucket}, "createdAt")`
    const country = query.country ? Prisma.sql` AND u."countryCode" = ${query.country}` : Prisma.empty
    const platform = query.platform ? Prisma.sql` AND s."platform" = ${query.platform}` : Prisma.empty
    switch (key) {
      case "engagement": return this.sql(Prisma.sql`SELECT ${b} AS bucket, COUNT(DISTINCT s."userId")::int AS active, COUNT(DISTINCT CASE WHEN u."createdAt" >= ${r.from} THEN s."userId" END)::int AS new_players, COUNT(*)::int AS sessions FROM "Session" s JOIN "User" u ON u.id=s."userId" WHERE s."createdAt" >= ${r.from} AND s."createdAt" <= ${r.to}${country}${platform} GROUP BY 1 ORDER BY 1`)
      case "gameplay": return this.sql(Prisma.sql`SELECT ${b} AS bucket, COUNT(*) FILTER (WHERE m.status::text IN ('CREATED','STARTED','REVIEW'))::int AS created, COUNT(*) FILTER (WHERE m."settledAt" IS NOT NULL)::int AS settled, COUNT(*) FILTER (WHERE m.status::text IN ('CANCELLED','ABANDONED'))::int AS abandoned FROM "Match" m WHERE m."createdAt" >= ${r.from} AND m."createdAt" <= ${r.to} GROUP BY 1 ORDER BY 1`)
      case "progression": return this.sql(Prisma.sql`SELECT ${b} AS bucket, COALESCE(SUM(pe.delta),0)::numeric AS xp, COUNT(*)::int AS events, (SELECT COUNT(*) FROM "PlayerMission" pm WHERE pm."claimedAt" >= ${r.from} AND pm."claimedAt" <= ${r.to})::int AS mission_claims FROM "ProgressionEvent" pe WHERE pe."createdAt" >= ${r.from} AND pe."createdAt" <= ${r.to} GROUP BY 1 ORDER BY 1`)
      case "economy": return this.sql(Prisma.sql`SELECT ${b} AS bucket, COALESCE(SUM(CASE WHEN wt.direction::text='CREDIT' THEN wt."exactAmount" ELSE 0 END),0)::numeric AS credits, COALESCE(SUM(CASE WHEN wt.direction::text='DEBIT' THEN wt."exactAmount" ELSE 0 END),0)::numeric AS debits, COUNT(*)::int AS transactions FROM "WalletTransaction" wt WHERE wt."createdAt" >= ${r.from} AND wt."createdAt" <= ${r.to} GROUP BY 1 ORDER BY 1`)
      case "social": return this.sql(Prisma.sql`SELECT ${b} AS bucket, COUNT(*)::int AS messages, COUNT(*) FILTER (WHERE (metadata->>'type')='VOICE')::int AS voice_messages, COUNT(*) FILTER (WHERE "readAt" IS NOT NULL)::int AS notifications_read FROM "ChatMessage" cm LEFT JOIN "Notification" n ON n."createdAt" >= cm."createdAt" AND n."createdAt" < cm."createdAt" + interval '1 second' WHERE cm."createdAt" >= ${r.from} AND cm."createdAt" <= ${r.to} GROUP BY 1 ORDER BY 1`)
      case "support": return this.sql(Prisma.sql`SELECT ${b} AS bucket, (SELECT COUNT(*) FROM "SupportTicket" t WHERE t."createdAt" >= ${r.from} AND t."createdAt" <= ${r.to})::int AS tickets, (SELECT COUNT(*) FROM "SupportLiveChatSession" s WHERE s."createdAt" >= ${r.from} AND s."createdAt" <= ${r.to})::int AS live_chats, (SELECT COUNT(*) FROM "SupportTicket" t WHERE t.status::text IN ('OPEN','IN_PROGRESS','WAITING_FOR_PLAYER','ESCALATED'))::int AS backlog GROUP BY 1 ORDER BY 1`)
      case "risk": return this.sql(Prisma.sql`SELECT ${b} AS bucket, (SELECT COUNT(*) FROM "FraudSignal" f WHERE f."createdAt" >= ${r.from} AND f."createdAt" <= ${r.to})::int AS signals, (SELECT COUNT(*) FROM "FraudCase" c WHERE c."createdAt" >= ${r.from} AND c."createdAt" <= ${r.to})::int AS cases, (SELECT COUNT(*) FROM "ChatReport" cr WHERE cr."createdAt" >= ${r.from} AND cr."createdAt" <= ${r.to})::int AS reports GROUP BY 1 ORDER BY 1`)
      case "platform": return this.sql(Prisma.sql`SELECT ${b} AS bucket, COUNT(*)::int AS sessions, (SELECT COUNT(*) FROM "OutboxEvent" o WHERE o.status::text='FAILED' AND o."createdAt" >= ${r.from} AND o."createdAt" <= ${r.to})::int AS failed_jobs, (SELECT COUNT(*) FROM "Notification" n WHERE n."createdAt" >= ${r.from} AND n."createdAt" <= ${r.to} AND n."pushStatus"::text='FAILED')::int AS failed_notifications FROM "Session" s WHERE s."createdAt" >= ${r.from} AND s."createdAt" <= ${r.to} GROUP BY 1 ORDER BY 1`)
    }
  }

  private async breakdowns(key: ReportKey, r: Range, query: SystemAdminAnalyticsQueryDto) {
    switch (key) {
      case "engagement": return this.sql(Prisma.sql`SELECT COALESCE(u."countryCode",'unknown') AS dimension, COUNT(DISTINCT s."userId")::int AS value FROM "Session" s JOIN "User" u ON u.id=s."userId" WHERE s."createdAt" BETWEEN ${r.from} AND ${r.to} GROUP BY 1 ORDER BY 2 DESC LIMIT 20`)
      case "gameplay": return this.sql(Prisma.sql`SELECT m.mode::text AS dimension, COUNT(*)::int AS matches, COUNT(*) FILTER (WHERE m."settledAt" IS NOT NULL)::int AS settled FROM "Match" m WHERE m."createdAt" BETWEEN ${r.from} AND ${r.to} GROUP BY 1 ORDER BY 2 DESC`)
      case "progression": return this.sql(Prisma.sql`SELECT pd.key AS dimension, COUNT(*)::int AS players, COALESCE(SUM(pp.points),0)::numeric AS points FROM "PlayerProgression" pp JOIN "ProgressionDefinition" pd ON pd.id=pp."progressionId" GROUP BY 1 ORDER BY 3 DESC LIMIT 20`)
      case "economy": return this.sql(Prisma.sql`SELECT wt."sourceType"::text AS dimension, COUNT(*)::int AS transactions, COALESCE(SUM(wt."exactAmount"),0)::numeric AS amount FROM "WalletTransaction" wt WHERE wt."createdAt" BETWEEN ${r.from} AND ${r.to} GROUP BY 1 ORDER BY 3 DESC LIMIT 30`)
      case "social": return this.sql(Prisma.sql`SELECT COALESCE(metadata->>'type','TEXT') AS dimension, COUNT(*)::int AS value FROM "ChatMessage" WHERE "createdAt" BETWEEN ${r.from} AND ${r.to} GROUP BY 1 ORDER BY 2 DESC`)
      case "support": return this.sql(Prisma.sql`SELECT t.status::text AS dimension, COUNT(*)::int AS value FROM "SupportTicket" t WHERE t."createdAt" BETWEEN ${r.from} AND ${r.to} GROUP BY 1 ORDER BY 2 DESC`)
      case "risk": return this.sql(Prisma.sql`SELECT f.severity::text AS dimension, COUNT(*)::int AS value FROM "FraudSignal" f WHERE f."createdAt" BETWEEN ${r.from} AND ${r.to} GROUP BY 1 ORDER BY 2 DESC`)
      case "platform": return this.sql(Prisma.sql`SELECT COALESCE("platform",'unknown') AS dimension, COUNT(*)::int AS value FROM "Session" WHERE "createdAt" BETWEEN ${r.from} AND ${r.to} GROUP BY 1 ORDER BY 2 DESC`)
    }
  }

  private async tables(key: ReportKey, r: Range, query: SystemAdminAnalyticsQueryDto) {
    if (key === "economy") return this.sql(Prisma.sql`SELECT wt."sourceType"::text AS source, COUNT(*)::int AS entries, COALESCE(SUM(wt."exactAmount"),0)::numeric AS volume FROM "WalletTransaction" wt WHERE wt."createdAt" BETWEEN ${r.from} AND ${r.to} GROUP BY 1 ORDER BY 3 DESC LIMIT 50`)
    if (key === "support") return this.sql(Prisma.sql`SELECT t."ticketNumber", t.subject, t.status::text AS status, t.priority::text AS priority, t."createdAt", t."firstResponseAt", t."resolvedAt" FROM "SupportTicket" t WHERE t."createdAt" BETWEEN ${r.from} AND ${r.to} ORDER BY t."createdAt" DESC LIMIT 50`)
    if (key === "risk") return this.sql(Prisma.sql`SELECT f.id, f.type::text AS type, f.severity::text AS severity, f."createdAt", f."userId" FROM "FraudSignal" f WHERE f."createdAt" BETWEEN ${r.from} AND ${r.to} ORDER BY f."createdAt" DESC LIMIT 50`)
    return this.sql(Prisma.sql`SELECT DATE_TRUNC('day', "createdAt") AS day, COUNT(*)::int AS value FROM "AnalyticsEvent" WHERE "createdAt" BETWEEN ${r.from} AND ${r.to} GROUP BY 1 ORDER BY 1`)
  }

  private kpis(key: ReportKey, totals: Record<string, number>, trend: Array<Record<string, unknown>>) {
    const first = trend[0] || {}; const last = trend[trend.length - 1] || {}
    const value = (name: string) => totals[name] || 0
    const out: Array<{ key: string; label: string; value: number; unit?: string }> = []
    if (key === "engagement") out.push({ key: "active", label: "Active player sessions", value: value("active") }, { key: "new_players", label: "New players", value: value("new_players") }, { key: "sessions", label: "Sessions", value: value("sessions") })
    if (key === "gameplay") out.push({ key: "created", label: "Matches created", value: value("created") }, { key: "settled", label: "Matches settled", value: value("settled") }, { key: "abandoned", label: "Abandoned", value: value("abandoned") })
    if (key === "progression") out.push({ key: "xp", label: "XP awarded", value: value("xp") }, { key: "events", label: "Progression events", value: value("events") }, { key: "mission_claims", label: "Mission claims", value: value("mission_claims") })
    if (key === "economy") out.push({ key: "credits", label: "GLD credits", value: value("credits"), unit: "GLD" }, { key: "debits", label: "GLD debits", value: value("debits"), unit: "GLD" }, { key: "transactions", label: "Ledger entries", value: value("transactions") })
    if (key === "social") out.push({ key: "messages", label: "Messages", value: value("messages") }, { key: "voice_messages", label: "Voice messages", value: value("voice_messages") }, { key: "notifications_read", label: "Notifications read", value: value("notifications_read") })
    if (key === "support") out.push({ key: "tickets", label: "Tickets", value: value("tickets") }, { key: "live_chats", label: "Live chats", value: value("live_chats") }, { key: "backlog", label: "Open backlog", value: this.n(last.backlog) })
    if (key === "risk") out.push({ key: "signals", label: "Risk signals", value: value("signals") }, { key: "cases", label: "Fraud cases", value: value("cases") }, { key: "reports", label: "Player reports", value: value("reports") })
    if (key === "platform") out.push({ key: "sessions", label: "Sessions", value: value("sessions") }, { key: "failed_jobs", label: "Failed jobs", value: value("failed_jobs") }, { key: "failed_notifications", label: "Push failures", value: value("failed_notifications") })
    return out.map((item) => ({ ...item, change: this.n(last[item.key]) - this.n(first[item.key]) }))
  }

  async playerExplorer(query: AnalyticsPlayerExplorerQueryDto, actorId: string) {
    const search = query.search?.trim(); const limit = query.limit || 25
    const rows = await this.sql(Prisma.sql`SELECT u.id, u.username, u.email, u.status::text AS status, p."countryCode", u."lastOnline", u."createdAt", p.level, p.elo, COALESCE(s."gamesPlayed",0)::int AS games_played, COALESCE(s.wins,0)::int AS wins, fp."riskLevel"::text AS risk_level FROM "User" u LEFT JOIN "PlayerProfile" p ON p."userId"=u.id LEFT JOIN "PlayerStats" s ON s."userId"=u.id LEFT JOIN "FraudProfile" fp ON fp."userId"=u.id WHERE (${search ? Prisma.sql`u.username ILIKE ${`%${search}%`} OR u.email ILIKE ${`%${search}%`} OR u.id::text=${search}` : Prisma.sql`TRUE`}) ORDER BY u."lastOnline" DESC NULLS LAST LIMIT ${limit}`)
    await this.audit(actorId, "analytics.player_explorer.view", "player-explorer", { search: search || null, count: rows.length }).catch(() => undefined)
    return { rows, nextCursor: rows.length === limit ? rows[rows.length - 1]?.id : null }
  }

  async quality() {
    const [duplicate, late, refresh] = await Promise.all([
      this.sql(Prisma.sql`SELECT COUNT(*)::int AS value FROM (SELECT "eventName", "occurredAt", COUNT(*) FROM "AnalyticsEvent" GROUP BY 1,2 HAVING COUNT(*) > 1) x`),
      this.sql(Prisma.sql`SELECT COUNT(*)::int AS value FROM "AnalyticsEvent" WHERE "occurredAt" > "receivedAt" + interval '24 hours'`),
      this.sql(Prisma.sql`SELECT "key", status, "dataThrough", "updatedAt" FROM "AnalyticsRefreshState"`),
    ])
    const checks = [
      { key: "duplicate-events", name: "Duplicate analytics events", feature: "pipeline", status: this.n(duplicate[0]?.value) ? "FAIL" : "PASS", severity: "WARNING", message: this.n(duplicate[0]?.value) ? `${this.n(duplicate[0]?.value)} duplicate groups detected` : "No duplicate groups detected", metadata: duplicate[0] || {} },
      { key: "late-events", name: "Late analytics events", feature: "pipeline", status: this.n(late[0]?.value) ? "WARN" : "PASS", severity: "INFO", message: `${this.n(late[0]?.value)} events arrived outside the lateness window`, metadata: late[0] || {} },
      ...refresh.map((item) => ({ key: `refresh-${item.key}`, name: `Refresh ${item.key}`, feature: "pipeline", status: item.status === "COMPLETE" ? "PASS" : "WARN", severity: "WARNING", message: item.status === "COMPLETE" ? "Worker completed successfully" : `Worker state is ${item.status}`, metadata: item })),
    ]
    for (const check of checks) {
      const data = { ...check, metadata: check.metadata as Prisma.InputJsonValue }
      await this.prisma.analyticsDataQualityCheck.upsert({ where: { key: check.key }, create: data, update: { ...data, checkedAt: new Date() } }).catch(() => undefined)
    }
    return checks
  }

  async definitions() { return this.prisma.analyticsReportDefinition.findMany({ where: { active: true }, orderBy: { category: "asc" } }) }
  async saved(actorId: string) { return this.prisma.analyticsSavedReport.findMany({ where: { OR: [{ ownerId: actorId }, { visibility: "ALL_PERMITTED" }, { visibility: "TEAM" }] }, orderBy: { updatedAt: "desc" } }) }
  async save(dto: AnalyticsSavedReportDto, actorId: string, id?: string) {
    const data = { ownerId: actorId, name: dto.name.trim(), reportKey: dto.reportKey, visibility: dto.visibility || "PRIVATE", configuration: dto.configuration as Prisma.InputJsonValue }
    const row = id ? await this.prisma.analyticsSavedReport.update({ where: { id }, data }) : await this.prisma.analyticsSavedReport.create({ data })
    await this.audit(actorId, id ? "analytics.saved_report.update" : "analytics.saved_report.create", dto.reportKey, { id: row.id }).catch(() => undefined)
    return row
  }
  async removeSaved(id: string, actorId: string) { const row = await this.prisma.analyticsSavedReport.deleteMany({ where: { id, ownerId: actorId } }); if (!row.count) throw new NotFoundException("Saved report not found"); return { deleted: true } }
  async schedules(actorId: string) { return this.prisma.analyticsScheduledReport.findMany({ where: { ownerId: actorId }, orderBy: { updatedAt: "desc" } }) }
  async schedule(dto: AnalyticsScheduledReportDto, actorId: string, id?: string) {
    const data = { savedReportId: dto.savedReportId, ownerId: actorId, frequency: dto.frequency, timezone: dto.timezone || "UTC", sendAt: dto.sendAt || "09:00", recipients: dto.recipients as Prisma.InputJsonValue, formats: dto.formats as Prisma.InputJsonValue, enabled: dto.enabled ?? true, nextRunAt: new Date(Date.now() + 86400000) }
    return id ? this.prisma.analyticsScheduledReport.update({ where: { id, ownerId: actorId }, data }) : this.prisma.analyticsScheduledReport.create({ data })
  }
  async removeSchedule(id: string, actorId: string) { const row = await this.prisma.analyticsScheduledReport.deleteMany({ where: { id, ownerId: actorId } }); if (!row.count) throw new NotFoundException("Scheduled report not found"); return { deleted: true } }
  async updateSchedule(id: string, dto: AnalyticsScheduledReportDto, actorId: string) { return this.schedule(dto, actorId, id) }
  async alerts() {
    const [rules, events] = await Promise.all([
      this.prisma.analyticsAlertRule.findMany({ orderBy: { updatedAt: "desc" } }),
      this.prisma.analyticsAlertEvent.findMany({ orderBy: { triggeredAt: "desc" }, take: 50 }),
    ])
    return { rules, events }
  }
  async saveAlert(dto: AnalyticsAlertRuleDto, actorId: string, id?: string) {
    const data = { key: dto.key, name: dto.name, metricKey: dto.metricKey, condition: dto.condition, threshold: dto.threshold, baselineWindow: dto.baselineWindow || 7, evaluationMinutes: dto.evaluationMinutes || 15, minimumSample: dto.minimumSample || 1, severity: dto.severity || "WARNING", cooldownMinutes: dto.cooldownMinutes || 60, recipients: dto.recipients as Prisma.InputJsonValue, enabled: dto.enabled ?? true, createdById: actorId, updatedById: actorId }
    return id ? this.prisma.analyticsAlertRule.update({ where: { id }, data }) : this.prisma.analyticsAlertRule.create({ data })
  }
  async acknowledgeAlert(id: string, actorId: string) { return this.prisma.analyticsAlertEvent.update({ where: { id }, data: { status: "ACKNOWLEDGED", acknowledgedAt: new Date(), acknowledgedById: actorId } }) }
  async createExport(body: { reportKey?: string; format?: string; query?: SystemAdminAnalyticsQueryDto }, actorId: string) {
    const reportKey = body.reportKey || "overview"; const format = (body.format || "JSON").toUpperCase()
    const job = await this.prisma.analyticsExportJob.create({ data: { ownerId: actorId, reportKey, format, status: "RUNNING", query: (body.query || {}) as Prisma.InputJsonValue, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) } })
    try {
      const result = reportKey === "overview" ? await this.prisma.analyticsEvent.count() : await this.report(reportKey, (body.query || {}) as SystemAdminAnalyticsQueryDto, actorId)
      return this.prisma.analyticsExportJob.update({ where: { id: job.id }, data: { status: "COMPLETE", result: result as Prisma.InputJsonValue, completedAt: new Date() } })
    } catch (error) { return this.prisma.analyticsExportJob.update({ where: { id: job.id }, data: { status: "FAILED", error: error instanceof Error ? error.message : String(error), completedAt: new Date() } }) }
  }
  async exportJob(id: string, actorId: string) { const row = await this.prisma.analyticsExportJob.findFirst({ where: { id, ownerId: actorId } }); if (!row) throw new NotFoundException("Export job not found"); return row }

  private async audit(actorId: string, action: string, entityId: string, metadata: unknown) { return this.prisma.adminAuditEvent.create({ data: { actorId, action, entityType: "ANALYTICS", entityId, reason: "System Admin analytics activity", metadata: metadata as Prisma.InputJsonValue } }) }
}
