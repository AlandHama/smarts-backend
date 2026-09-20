import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from "@nestjs/common"
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto"
import { Prisma } from "@prisma/client"

import { getAuthConfig } from "../auth/auth.config"
import { PrismaService } from "../../prisma.service"
import { GldService } from "../gld/gld.service"

const ADMOB_SCOPE = "https://www.googleapis.com/auth/admob.report https://www.googleapis.com/auth/admob.readonly"
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
const ADMOB_API_URL = "https://admob.googleapis.com/v1"
// Keep report refresh aligned with the GLD treasury cycle. AdMob can publish
// late adjustments, so recent report days are re-read on every sync.
const SYNC_INTERVAL_MS = 30 * 60 * 1000
const DEFAULT_SYNC_DAYS = 3

type GoogleAccount = { publisherId?: string; name?: string; reportingTimeZone?: string; currencyCode?: string }
type ReportRecord = { row?: { dimensionValues?: Record<string, unknown>; metricValues?: Record<string, unknown> } }

@Injectable()
export class AdMobService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AdMobService.name)
  private timer?: ReturnType<typeof setInterval>
  private syncing = false

  constructor(private readonly prisma: PrismaService, private readonly gldService: GldService) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.sync(DEFAULT_SYNC_DAYS), SYNC_INTERVAL_MS)
    void this.sync(DEFAULT_SYNC_DAYS)
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer)
  }

  getAuthorizationUrl(adminId: string) {
    const clientId = this.requiredConfig("ADMOB_GOOGLE_CLIENT_ID")
    this.requiredConfig("ADMOB_GOOGLE_CLIENT_SECRET")
    const redirectUri = this.requiredConfig("ADMOB_OAUTH_REDIRECT_URI")
    const state = this.signState(adminId)
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      access_type: "offline",
      prompt: "consent",
      scope: ADMOB_SCOPE,
      state,
    })
    return { authorizationUrl: `${GOOGLE_AUTH_URL}?${params.toString()}` }
  }

  async handleCallback(code: string | undefined, state: string | undefined, error?: string) {
    if (error) throw new BadRequestException(`Google authorization failed: ${error}`)
    if (!code || !state) throw new BadRequestException("AdMob authorization response is incomplete")
    const adminId = this.verifyState(state)
    const token = await this.exchangeCode(code)
    let refreshToken = token.refresh_token
    const existing = await this.prisma.adMobConnection.findUnique({ where: { provider: "ADMOB" } })
    if (!refreshToken && existing) refreshToken = this.decrypt(existing.encryptedRefreshToken)
    if (!refreshToken) throw new BadRequestException("Google did not return a refresh token. Reconnect with consent enabled.")

    const accounts = await this.listAccounts(token.access_token)
    if (!accounts.length) throw new BadRequestException("The authorized Google account has no AdMob publisher account")
    const configuredPublisher = process.env.ADMOB_PUBLISHER_ID?.trim()
    const account = (configuredPublisher ? accounts.find((item) => item.publisherId === configuredPublisher) : undefined) ?? accounts[0]
    if (!account.publisherId) throw new BadRequestException("AdMob did not return a publisher ID")
    // Account listing is sufficient to establish the connection. Some AdMob
    // accounts can list successfully while the optional account-details call
    // is temporarily unavailable, so do not discard valid OAuth credentials
    // merely because metadata could not be read.
    let details: GoogleAccount = {}
    try {
      details = await this.getAccount(account.publisherId, token.access_token)
    } catch (error) {
      this.logger.warn(`AdMob account metadata unavailable: ${error instanceof Error ? error.message : String(error)}`)
    }

    await this.prisma.adMobConnection.upsert({
      where: { provider: "ADMOB" },
      create: {
        provider: "ADMOB",
        publisherId: account.publisherId,
        googleAccountEmail: token.email ?? null,
        reportingTimezone: details.reportingTimeZone ?? account.reportingTimeZone ?? null,
        currencyCode: details.currencyCode ?? account.currencyCode ?? "USD",
        encryptedRefreshToken: this.encrypt(refreshToken),
        status: "CONNECTED",
        createdById: adminId,
        lastSyncError: null,
      },
      update: {
        publisherId: account.publisherId,
        googleAccountEmail: token.email ?? existing?.googleAccountEmail ?? null,
        reportingTimezone: details.reportingTimeZone ?? account.reportingTimeZone ?? existing?.reportingTimezone ?? null,
        currencyCode: details.currencyCode ?? account.currencyCode ?? existing?.currencyCode ?? "USD",
        encryptedRefreshToken: this.encrypt(refreshToken),
        status: "CONNECTED",
        createdById: adminId,
        lastSyncError: null,
      },
    })
    void this.sync(30)
    return { adminId, publisherId: account.publisherId }
  }

  async disconnect() {
    const connection = await this.prisma.adMobConnection.findUnique({ where: { provider: "ADMOB" } })
    if (!connection) return { disconnected: true }
    await this.prisma.adMobConnection.update({ where: { id: connection.id }, data: { status: "DISCONNECTED", encryptedRefreshToken: "", lastSyncError: null } })
    return { disconnected: true }
  }

  async sync(days = DEFAULT_SYNC_DAYS) {
    if (this.syncing) return { skipped: true, reason: "sync-in-progress" }
    const connection = await this.prisma.adMobConnection.findUnique({ where: { provider: "ADMOB" } })
    if (!connection || connection.status !== "CONNECTED" || !connection.encryptedRefreshToken) return { skipped: true, reason: "not-connected" }
    this.syncing = true
    const boundedDays = Math.min(Math.max(Number(days) || DEFAULT_SYNC_DAYS, 1), 365)
    const end = new Date()
    const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate() - (boundedDays - 1)))
    await this.prisma.adMobConnection.update({ where: { id: connection.id }, data: { lastSyncStartedAt: new Date(), lastSyncError: null } })
    try {
      const accessToken = await this.refreshAccessToken(connection.encryptedRefreshToken)
      const records = await this.generateNetworkReport(connection.publisherId, connection.currencyCode ?? "USD", start, end, accessToken)
      const rows = records.map((record) => this.mapReportRow(record)).filter((row): row is NonNullable<ReturnType<AdMobService["mapReportRow"]>> => Boolean(row))
      await this.prisma.$transaction(async (transaction) => {
        await transaction.adMobReportRow.deleteMany({ where: { connectionId: connection.id, reportDate: { gte: start, lte: end } } })
        for (let offset = 0; offset < rows.length; offset += 1000) {
          await transaction.adMobReportRow.createMany({ data: rows.slice(offset, offset + 1000).map((row) => ({ ...row, connectionId: connection.id })) })
        }
        await transaction.adMobConnection.update({ where: { id: connection.id }, data: { status: "CONNECTED", lastSyncAt: new Date(), lastSyncError: null } })
      })
      this.logger.log(`AdMob report synchronized (${rows.length} rows, ${boundedDays} days)`)
      // Materialize and recalculate immediately after the latest report is
      // stored; the scheduled GLD cycle remains as a retry/backstop.
      await this.gldService.runScheduledCycle()
      return { synchronized: true, rows: rows.length, days: boundedDays }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await this.prisma.adMobConnection.update({ where: { id: connection.id }, data: { status: "ERROR", lastSyncError: message.slice(0, 2000) } }).catch(() => undefined)
      this.logger.error(`AdMob synchronization failed: ${message}`)
      return { synchronized: false, error: message }
    } finally {
      this.syncing = false
    }
  }

  async analytics(days = 30) {
    const boundedDays = Math.min(Math.max(Number(days) || 30, 1), 365)
    const now = new Date()
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (boundedDays - 1)))
    const connection = await this.prisma.adMobConnection.findUnique({ where: { provider: "ADMOB" }, select: { id: true, publisherId: true, googleAccountEmail: true, reportingTimezone: true, currencyCode: true, status: true, connectedAt: true, lastSyncAt: true, lastSyncStartedAt: true, lastSyncError: true } })
    if (!connection) return this.emptyAnalytics(boundedDays, from, now)
    const [summary, trend, apps, formats, countries, adUnits, rewardSummary] = await Promise.all([
      this.prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`SELECT COALESCE(SUM("adRequests"),0) AS ad_requests, COALESCE(SUM("matchedRequests"),0) AS matched_requests, COALESCE(SUM("impressions"),0) AS impressions, COALESCE(SUM("clicks"),0) AS clicks, COALESCE(SUM("estimatedEarningsMicros"),0) AS earnings, COALESCE(SUM("impressionCtrBps" * "impressions"),0) AS ctr_weight, COALESCE(SUM("impressionRpmMicros" * "impressions"),0) AS rpm_weight, COALESCE(SUM("matchRateBps" * "adRequests"),0) AS match_weight, COALESCE(SUM("showRateBps" * "matchedRequests"),0) AS show_weight FROM "AdMobReportRow" WHERE "connectionId" = ${connection.id} AND "reportDate" BETWEEN ${from} AND ${now}`),
      this.prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`SELECT "reportDate" AS date, COALESCE(SUM("adRequests"),0) AS ad_requests, COALESCE(SUM("matchedRequests"),0) AS matched_requests, COALESCE(SUM("impressions"),0) AS impressions, COALESCE(SUM("clicks"),0) AS clicks, COALESCE(SUM("estimatedEarningsMicros"),0) AS earnings FROM "AdMobReportRow" WHERE "connectionId" = ${connection.id} AND "reportDate" BETWEEN ${from} AND ${now} GROUP BY "reportDate" ORDER BY "reportDate" ASC`),
      this.breakdown(connection.id, from, now, "appId", "appName"),
      this.breakdown(connection.id, from, now, "format", "format"),
      this.breakdown(connection.id, from, now, "countryCode", "countryCode"),
      this.breakdown(connection.id, from, now, "adUnitId", "adUnitName"),
      this.prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`SELECT count(*) AS total, count(*) FILTER (WHERE "status" = 'GRANTED') AS granted, count(*) FILTER (WHERE "status" = 'REJECTED') AS rejected FROM "AdRewardClaim" WHERE lower("provider") = 'admob' AND "createdAt" BETWEEN ${from} AND ${now}`),
    ])
    const totals = summary[0] ?? {}
    return this.serialize({
      // OAuth remains authorized while a report sync is unhealthy.  Keep the
      // connection visible so administrators can see the sync error and retry
      // it instead of being incorrectly sent back through OAuth.
      connected: connection.status !== "DISCONNECTED",
      syncHealthy: connection.status === "CONNECTED",
      connection: { ...connection, encryptedRefreshToken: undefined },
      period: { from, to: now, days: boundedDays },
      kpis: {
        adRequests: this.number(totals.ad_requests), matchedRequests: this.number(totals.matched_requests), impressions: this.number(totals.impressions), clicks: this.number(totals.clicks), estimatedEarningsMicros: this.number(totals.earnings), estimatedEarnings: this.number(totals.earnings) / 1_000_000,
        impressionCtr: this.ratio(this.number(totals.clicks), this.number(totals.impressions)), matchRate: this.ratio(this.number(totals.matched_requests), this.number(totals.ad_requests)), showRate: this.ratio(this.number(totals.impressions), this.number(totals.matched_requests)), impressionRpm: this.number(totals.impressions) ? this.number(totals.earnings) / this.number(totals.impressions) * 1000 / 1_000_000 : 0,
        rewardClaims: this.number(rewardSummary[0]?.total), grantedRewardClaims: this.number(rewardSummary[0]?.granted), rejectedRewardClaims: this.number(rewardSummary[0]?.rejected),
      },
      trends: trend.map((row) => ({ date: row.date, adRequests: this.number(row.ad_requests), matchedRequests: this.number(row.matched_requests), impressions: this.number(row.impressions), clicks: this.number(row.clicks), estimatedEarnings: this.number(row.earnings) / 1_000_000 })),
      apps: this.normalizeBreakdown(apps), formats: this.normalizeBreakdown(formats), countries: this.normalizeBreakdown(countries), adUnits: this.normalizeBreakdown(adUnits),
    })
  }

  emptyAnalyticsForSystemAdmin(days = 30) {
    const boundedDays = Math.min(Math.max(Number(days) || 30, 1), 365)
    const now = new Date()
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (boundedDays - 1)))
    return this.emptyAnalytics(boundedDays, from, now)
  }

  private async breakdown(connectionId: string, from: Date, to: Date, groupColumn: string, labelColumn: string) {
    const column = Prisma.raw(`"${groupColumn}"`)
    const label = Prisma.raw(`"${labelColumn}"`)
    return this.prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`SELECT ${column} AS key, MAX(${label}) AS label, COALESCE(SUM("impressions"),0) AS impressions, COALESCE(SUM("clicks"),0) AS clicks, COALESCE(SUM("estimatedEarningsMicros"),0) AS earnings, COALESCE(SUM("matchedRequests"),0) AS matched_requests FROM "AdMobReportRow" WHERE "connectionId" = ${connectionId} AND "reportDate" BETWEEN ${from} AND ${to} AND ${column} IS NOT NULL GROUP BY ${column} ORDER BY earnings DESC LIMIT 100`)
  }

  private normalizeBreakdown(rows: Array<Record<string, unknown>>) { return rows.map((row) => ({ key: row.key ?? "UNKNOWN", label: row.label ?? row.key ?? "Unknown", impressions: this.number(row.impressions), clicks: this.number(row.clicks), matchedRequests: this.number(row.matched_requests), estimatedEarnings: this.number(row.earnings) / 1_000_000 })) }

  private emptyAnalytics(days: number, from: Date, to: Date) { return { connected: false, syncHealthy: false, connection: null, period: { from, to, days }, kpis: { adRequests: 0, matchedRequests: 0, impressions: 0, clicks: 0, estimatedEarningsMicros: 0, estimatedEarnings: 0, impressionCtr: 0, matchRate: 0, showRate: 0, impressionRpm: 0, rewardClaims: 0, grantedRewardClaims: 0, rejectedRewardClaims: 0 }, trends: [], apps: [], formats: [], countries: [], adUnits: [] } }

  private async generateNetworkReport(publisherId: string, currencyCode: string, start: Date, end: Date, accessToken: string) {
    // AD_UNIT automatically includes APP in the network report response.
    // Keeping APP out of the requested dimensions avoids duplicate grouping.
    const body = { reportSpec: { dateRange: { startDate: this.googleDate(start), endDate: this.googleDate(end) }, dimensions: ["DATE", "AD_UNIT", "PLATFORM", "COUNTRY", "FORMAT"], metrics: ["AD_REQUESTS", "MATCHED_REQUESTS", "IMPRESSIONS", "CLICKS", "ESTIMATED_EARNINGS", "IMPRESSION_CTR", "IMPRESSION_RPM", "MATCH_RATE", "SHOW_RATE"], localizationSettings: { currencyCode, languageCode: "en-US" }, maxReportRows: 100000 } }
    const response = await fetch(`${ADMOB_API_URL}/accounts/${encodeURIComponent(publisherId)}/networkReport:generate`, { method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify(body) })
    if (!response.ok) throw new Error(`AdMob report request failed (${response.status}): ${(await response.text()).slice(0, 500)}`)
    const bodyText = await response.text()
    const parsed = JSON.parse(bodyText) as unknown
    return Array.isArray(parsed) ? parsed as ReportRecord[] : [parsed as ReportRecord]
  }

  private mapReportRow(record: ReportRecord) {
    const raw = record.row
    if (!raw) return null
    const dimensions = raw.dimensionValues ?? {}
    const metrics = raw.metricValues ?? {}
    const value = (source: Record<string, unknown>, key: string) => { const item = source[key]; return item && typeof item === "object" ? (item as Record<string, unknown>).value ?? (item as Record<string, unknown>).displayLabel : item }
    const dateText = String(value(dimensions, "DATE") ?? "")
    if (!/^\d{8}$/.test(dateText)) return null
    const reportDate = new Date(Date.UTC(Number(dateText.slice(0, 4)), Number(dateText.slice(4, 6)) - 1, Number(dateText.slice(6, 8))))
    const metric = (key: string) => {
      const item = metrics[key]
      if (item && typeof item === "object") {
        const metricObject = item as Record<string, unknown>
        return metricObject.integerValue ?? metricObject.microsValue ?? metricObject.doubleValue ?? metricObject.value
      }
      return item
    }
    const integer = (key: string) => BigInt(String(metric(key) ?? "0"))
    const decimal = (key: string) => Number(metric(key) ?? 0)
    const dimensionKey = ["APP", "PLATFORM", "COUNTRY", "FORMAT", "AD_UNIT"].map((key) => `${key}:${String(value(dimensions, key) ?? "")}`).join("|")
    return { reportDate, dimensionKey, appId: this.stringValue(dimensions, "APP"), appName: this.labelValue(dimensions, "APP"), platform: this.stringValue(dimensions, "PLATFORM"), countryCode: this.stringValue(dimensions, "COUNTRY")?.slice(0, 2).toUpperCase() || null, format: this.stringValue(dimensions, "FORMAT"), adUnitId: this.stringValue(dimensions, "AD_UNIT"), adUnitName: this.labelValue(dimensions, "AD_UNIT"), adRequests: integer("AD_REQUESTS"), matchedRequests: integer("MATCHED_REQUESTS"), impressions: integer("IMPRESSIONS"), clicks: integer("CLICKS"), estimatedEarningsMicros: integer("ESTIMATED_EARNINGS"), impressionCtrBps: Math.round(decimal("IMPRESSION_CTR") * 10000), impressionRpmMicros: BigInt(Math.round(decimal("IMPRESSION_RPM"))), matchRateBps: Math.round(decimal("MATCH_RATE") * 10000), showRateBps: Math.round(decimal("SHOW_RATE") * 10000), raw: record as unknown as Prisma.InputJsonValue }
  }

  private stringValue(values: Record<string, unknown>, key: string) { const item = values[key]; const value = item && typeof item === "object" ? (item as Record<string, unknown>).value : item; return value === undefined || value === null || value === "" ? null : String(value) }
  private labelValue(values: Record<string, unknown>, key: string) { const item = values[key]; if (item && typeof item === "object" && (item as Record<string, unknown>).displayLabel) return String((item as Record<string, unknown>).displayLabel); return this.stringValue(values, key) }
  private googleDate(value: Date) { return { year: value.getUTCFullYear(), month: value.getUTCMonth() + 1, day: value.getUTCDate() } }

  private async exchangeCode(code: string) {
    const response = await fetch(GOOGLE_TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, client_id: this.requiredConfig("ADMOB_GOOGLE_CLIENT_ID"), client_secret: this.requiredConfig("ADMOB_GOOGLE_CLIENT_SECRET"), redirect_uri: this.requiredConfig("ADMOB_OAUTH_REDIRECT_URI"), grant_type: "authorization_code" }) })
    if (!response.ok) throw new BadRequestException(`Google token exchange failed: ${(await response.text()).slice(0, 500)}`)
    return await response.json() as { access_token: string; refresh_token?: string; email?: string }
  }

  private async refreshAccessToken(encryptedRefreshToken: string) {
    const response = await fetch(GOOGLE_TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ refresh_token: this.decrypt(encryptedRefreshToken), client_id: this.requiredConfig("ADMOB_GOOGLE_CLIENT_ID"), client_secret: this.requiredConfig("ADMOB_GOOGLE_CLIENT_SECRET"), grant_type: "refresh_token" }) })
    if (!response.ok) throw new Error(`Google token refresh failed (${response.status})`)
    const body = await response.json() as { access_token?: string }
    if (!body.access_token) throw new Error("Google did not return an AdMob access token")
    return body.access_token
  }

  private async listAccounts(accessToken: string) { const body = await this.googleGet("accounts", accessToken) as { account?: GoogleAccount[]; accounts?: GoogleAccount[] }; return body.account ?? body.accounts ?? [] }
  private async getAccount(publisherId: string, accessToken: string) { return await this.googleGet(`accounts/${encodeURIComponent(publisherId)}`, accessToken) as GoogleAccount }
  private async googleGet(path: string, accessToken: string) { const response = await fetch(`${ADMOB_API_URL}/${path}`, { headers: { Authorization: `Bearer ${accessToken}` } }); if (!response.ok) throw new BadRequestException(`AdMob request failed (${response.status}): ${(await response.text()).slice(0, 500)}`); return await response.json() as Record<string, unknown> }

  private signState(adminId: string) { const payload = Buffer.from(JSON.stringify({ adminId, expiresAt: Date.now() + 10 * 60 * 1000, nonce: randomBytes(16).toString("hex") })).toString("base64url"); const signature = createHmac("sha256", this.stateSecret()).update(payload).digest("base64url"); return `${payload}.${signature}` }
  private verifyState(state: string) { const [payload, supplied] = state.split("."); if (!payload || !supplied) throw new BadRequestException("Invalid AdMob OAuth state"); const expected = createHmac("sha256", this.stateSecret()).update(payload).digest("base64url"); if (supplied.length !== expected.length || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) throw new BadRequestException("Invalid AdMob OAuth state"); const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { adminId?: string; expiresAt?: number }; if (!data.adminId || !data.expiresAt || data.expiresAt < Date.now()) throw new BadRequestException("AdMob OAuth state expired"); return data.adminId }
  private stateSecret() { return process.env.ADMOB_OAUTH_STATE_SECRET?.trim() || getAuthConfig().accessSecret }
  private requiredConfig(name: string) { const value = process.env[name]?.trim(); if (!value) throw new BadRequestException(`${name} is not configured`); return value }
  private encryptionKey() { const value = process.env.ADMOB_TOKEN_ENCRYPTION_KEY?.trim(); if (!value && (process.env.NODE_ENV ?? "development") === "production") throw new Error("ADMOB_TOKEN_ENCRYPTION_KEY is required in production"); return createHash("sha256").update(value || getAuthConfig().accessSecret).digest() }
  private encrypt(value: string) { const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", this.encryptionKey(), iv); const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]); return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}` }
  private decrypt(value: string) { const [ivText, tagText, encryptedText] = value.split("."); if (!ivText || !tagText || !encryptedText) throw new Error("Stored AdMob token is invalid"); const decipher = createDecipheriv("aes-256-gcm", this.encryptionKey(), Buffer.from(ivText, "base64url")); decipher.setAuthTag(Buffer.from(tagText, "base64url")); return Buffer.concat([decipher.update(Buffer.from(encryptedText, "base64url")), decipher.final()]).toString("utf8") }
  private number(value: unknown) { if (typeof value === "bigint") return Number(value); if (typeof value === "number") return Number.isFinite(value) ? value : 0; return Number(value ?? 0) || 0 }
  private ratio(numerator: number, denominator: number) { return denominator ? Math.round((numerator / denominator) * 10000) / 100 : 0 }
  private serialize<T>(value: T): T { return JSON.parse(JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item)) as T }
}
