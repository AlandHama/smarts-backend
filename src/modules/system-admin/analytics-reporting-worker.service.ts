import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common"
import { Prisma } from "@prisma/client"

import { PrismaService } from "../../prisma.service"
import { AnalyticsReportingService } from "./analytics-reporting.service"

const INTERVAL = 5 * 60 * 1000

/** Keeps report operations alive without putting alert/schedule work on admin requests. */
@Injectable()
export class AnalyticsReportingWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AnalyticsReportingWorkerService.name)
  private timer?: ReturnType<typeof setInterval>

  constructor(private readonly prisma: PrismaService, private readonly reporting: AnalyticsReportingService) {}
  onModuleInit() { void this.run(); this.timer = setInterval(() => void this.run(), INTERVAL) }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer) }

  async run() {
    const lock = await this.prisma.$queryRaw<Array<{ locked: boolean }>>(Prisma.sql`SELECT pg_try_advisory_lock(hashtext('smarts.analytics.operations')) AS locked`)
    if (!lock[0]?.locked) return
    try {
      await this.reporting.quality()
      await this.evaluateAlerts()
      await this.advanceSchedules()
    } catch (error) { this.logger.warn(`Analytics operations worker failed: ${error instanceof Error ? error.message : String(error)}`) }
    finally { await this.prisma.$queryRaw(Prisma.sql`SELECT pg_advisory_unlock(hashtext('smarts.analytics.operations'))`).catch(() => undefined) }
  }

  private async evaluateAlerts() {
    const rules = await this.prisma.analyticsAlertRule.findMany({ where: { enabled: true } })
    for (const rule of rules) {
      const latest = await this.prisma.$queryRaw<Array<{ value: Prisma.Decimal }>>(Prisma.sql`SELECT COALESCE(SUM("value"),0) AS value FROM "AnalyticsHourlyAggregate" WHERE "metricKey"=${rule.metricKey} AND "hour" >= date_trunc('hour', CURRENT_TIMESTAMP - (${rule.evaluationMinutes} || ' minutes')::interval)`)
      const value = Number(latest[0]?.value || 0); const threshold = Number(rule.threshold)
      const triggered = rule.condition === "GT" ? value > threshold : rule.condition === "GTE" ? value >= threshold : rule.condition === "LT" ? value < threshold : rule.condition === "LTE" ? value <= threshold : Math.abs(value) >= threshold
      const cooldown = rule.lastTriggeredAt && Date.now() - rule.lastTriggeredAt.getTime() < rule.cooldownMinutes * 60000
      await this.prisma.analyticsAlertRule.update({ where: { id: rule.id }, data: { lastEvaluatedAt: new Date(), ...(triggered && !cooldown ? { lastTriggeredAt: new Date() } : {}) } })
      if (triggered && !cooldown) await this.prisma.analyticsAlertEvent.create({ data: { ruleId: rule.id, observedValue: value, threshold: rule.threshold, message: `${rule.name}: ${value} met ${rule.condition} ${threshold}`, metadata: { metricKey: rule.metricKey, evaluationMinutes: rule.evaluationMinutes } } })
    }
  }

  private async advanceSchedules() {
    const due = await this.prisma.analyticsScheduledReport.findMany({ where: { enabled: true, nextRunAt: { lte: new Date() } }, take: 100 })
    for (const schedule of due) {
      const saved = await this.prisma.analyticsSavedReport.findUnique({ where: { id: schedule.savedReportId } })
      const next = new Date(schedule.nextRunAt || Date.now()); if (schedule.frequency === "WEEKLY") next.setUTCDate(next.getUTCDate() + 7); else if (schedule.frequency === "MONTHLY") next.setUTCMonth(next.getUTCMonth() + 1); else next.setUTCDate(next.getUTCDate() + 1)
      await this.prisma.analyticsScheduledReport.update({ where: { id: schedule.id }, data: { lastRunAt: new Date(), lastStatus: "QUEUED", lastError: null, nextRunAt: next } })
      await this.prisma.analyticsExportJob.create({ data: { ownerId: schedule.ownerId, reportKey: saved?.reportKey || "overview", format: "SCHEDULED", status: "QUEUED", query: { scheduleId: schedule.id, savedReportId: schedule.savedReportId, configuration: saved?.configuration || {}, formats: schedule.formats, recipients: schedule.recipients }, expiresAt: new Date(Date.now() + 7 * 86400000) } })
    }
  }
}
