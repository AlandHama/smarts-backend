import { Injectable, Logger } from "@nestjs/common"
import { Prisma } from "@prisma/client"

import { PrismaService } from "../../prisma.service"
import { applyGldPolicyOverrides, getGldConfig } from "./gld.config"

@Injectable()
export class GldRevenueService {
  private readonly logger = new Logger(GldRevenueService.name)
  private readonly fxCache = new Map<string, { numerator: bigint; denominator: bigint; rate: string; fetchedAt: Date }>()

  constructor(private readonly prisma: PrismaService) {}

  /** Materialize the latest synchronized AdMob rows into the treasury. */
  async materializeMaturedAdMobRevenue(now = new Date()) {
    const connection = await this.prisma.adMobConnection.findUnique({ where: { provider: "ADMOB" }, select: { id: true, currencyCode: true, status: true } })
    if (!connection || connection.status !== "CONNECTED") return { processed: 0, skipped: "admob-not-connected" }
    const dates = await this.prisma.adMobReportRow.findMany({
      where: { connectionId: connection.id, reportDate: { lte: now } },
      select: { reportDate: true },
      distinct: ["reportDate"],
      orderBy: { reportDate: "desc" },
      take: 7,
    })
    if (dates.length === 0) return { processed: 0, skipped: "admob-report-empty" }
    let processed = 0
    for (const { reportDate } of dates) {
      const periodEnd = new Date(reportDate.getTime() + 24 * 60 * 60 * 1000)
      if (await this.materializeDay(connection.id, connection.currencyCode ?? "USD", reportDate, periodEnd)) processed += 1
    }
    return { processed, dates: dates.map(({ reportDate }) => reportDate.toISOString().slice(0, 10)) }
  }

  async listSnapshots(limit = 30) {
    const rows = await this.prisma.gldRevenueSnapshot.findMany({ orderBy: { periodEnd: "desc" }, take: Math.min(Math.max(limit, 1), 100) })
    return rows.map((row) => this.serialize(row))
  }

  private async materializeDay(connectionId: string, sourceCurrency: string, periodStart: Date, periodEnd: Date) {
    const row = await this.prisma.adMobReportRow.aggregate({ where: { connectionId, reportDate: periodStart }, _sum: { estimatedEarningsMicros: true } })
    const grossSource = row._sum.estimatedEarningsMicros ?? 0n
    const fx = await this.usdRate(sourceCurrency)
    const gross = (grossSource * fx.numerator) / fx.denominator
    const controls = await this.prisma.gldAdminControl.findUnique({ where: { singletonKey: "default" } })
    const config = applyGldPolicyOverrides(getGldConfig(), controls)
    const existing = await this.prisma.gldRevenueSnapshot.findUnique({ where: { source_periodStart_periodEnd: { source: "ADMOB_NETWORK_REPORT", periodStart, periodEnd } } })
    const recognizedGross = (gross * BigInt(config.recognitionHaircutBps)) / 10_000n
    const eligibleProfit = recognizedGross > config.adCostsUsdMicros ? recognizedGross - config.adCostsUsdMicros : 0n
    const values = {
      grossAdRevenueUsdMicros: gross,
      adCostsUsdMicros: config.adCostsUsdMicros,
      eligibleProfitUsdMicros: eligibleProfit,
      playerRewardAllocationBps: config.playerRewardAllocationBps,
      reserveAllocationBps: config.reserveAllocationBps,
      companyAllocationBps: config.companyAllocationBps,
      rewardBackingUsdMicros: (eligibleProfit * BigInt(config.playerRewardAllocationBps)) / 10_000n,
      reserveAddedUsdMicros: (eligibleProfit * BigInt(config.reserveAllocationBps)) / 10_000n,
      companyShareUsdMicros: (eligibleProfit * BigInt(config.companyAllocationBps)) / 10_000n,
      recognitionStatus: "RECOGNIZED" as const,
      recognitionHaircutBps: config.recognitionHaircutBps,
      metadata: { source: "admob-network-report", sourceCurrency: sourceCurrency.toUpperCase(), grossSourceMicros: grossSource.toString(), fxRateToUsd: fx.rate, fxRateFetchedAt: fx.fetchedAt.toISOString(), settlementWindowHours: 0 },
    }
    if (!existing) {
      await this.prisma.$transaction(async (tx) => {
        const snapshot = await tx.gldRevenueSnapshot.create({ data: { periodStart, periodEnd, source: "ADMOB_NETWORK_REPORT", ...values } })
        await this.createAllocationEntries(tx, snapshot.id, values)
      })
      return true
    }

    const changed = existing.grossAdRevenueUsdMicros !== gross || existing.adCostsUsdMicros !== config.adCostsUsdMicros || existing.reserveAllocationBps !== config.reserveAllocationBps || existing.recognitionHaircutBps !== config.recognitionHaircutBps
    if (!changed) return false
    await this.prisma.$transaction(async (tx) => {
      await tx.gldRevenueSnapshot.update({ where: { id: existing.id }, data: { ...values, recognitionStatus: "RESTATED", metadata: { ...values.metadata, restatedAt: new Date().toISOString() } } })
      const deltas = [
        ["REWARD_BACKING", values.rewardBackingUsdMicros - existing.rewardBackingUsdMicros, "REWARD_BACKING"],
        ["RESERVE", values.reserveAddedUsdMicros - existing.reserveAddedUsdMicros, "RESERVE"],
        ["COMPANY", values.companyShareUsdMicros - existing.companyShareUsdMicros, "COMPANY"],
      ] as const
      for (const [entryType, amount, allocation] of deltas) {
        if (amount === 0n) continue
        await tx.gldTreasuryEntry.create({ data: { revenueSnapshotId: existing.id, entryType: "ADJUSTMENT", amountUsdMicros: amount, idempotencyKey: `admob-restatement:${existing.id}:${allocation}:${amount.toString()}`, metadata: { allocation, originalEntryType: entryType } } })
      }
    })
    this.logger.warn(`Restated GLD AdMob revenue snapshot ${existing.id}`)
    return true
  }

  private async usdRate(sourceCurrency: string) {
    const currency = sourceCurrency.trim().toUpperCase() || "USD"
    if (currency === "USD") return { numerator: 1n, denominator: 1n, rate: "1", fetchedAt: new Date() }
    const config = getGldConfig()
    const cached = this.fxCache.get(currency)
    const cacheAge = cached ? Date.now() - cached.fetchedAt.getTime() : Number.POSITIVE_INFINITY
    if (cached && cacheAge < config.fxRateCacheMinutes * 60_000) return cached
    try {
      const response = await fetch(`${config.fxRateUrl}/${currency.toLowerCase()}/usd`, { signal: AbortSignal.timeout(10_000) })
      if (!response.ok) throw new Error(`FX provider returned ${response.status}`)
      const body = (await response.json()) as { rate?: unknown }
      const rateNumber = Number(body.rate)
      if (!Number.isFinite(rateNumber) || rateNumber <= 0) throw new Error("FX provider returned an invalid USD rate")
      const denominator = 1_000_000_000_000n
      const numerator = BigInt(Math.round(rateNumber * Number(denominator)))
      const value = { numerator, denominator, rate: rateNumber.toFixed(12), fetchedAt: new Date() }
      this.fxCache.set(currency, value)
      return value
    } catch (error) {
      if (cached) {
        this.logger.warn(`Using cached ${currency}/USD FX rate: ${error instanceof Error ? error.message : String(error)}`)
        return cached
      }
      throw new Error(`Unable to convert AdMob ${currency} revenue to USD: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private createAllocationEntries(tx: Prisma.TransactionClient, snapshotId: string, values: { rewardBackingUsdMicros: bigint; reserveAddedUsdMicros: bigint; companyShareUsdMicros: bigint }) {
    return Promise.all([
      tx.gldTreasuryEntry.create({ data: { revenueSnapshotId: snapshotId, entryType: "REWARD_BACKING", amountUsdMicros: values.rewardBackingUsdMicros, idempotencyKey: `admob-revenue:${snapshotId}:reward-backing`, metadata: { allocation: "REWARD_BACKING" } } }),
      tx.gldTreasuryEntry.create({ data: { revenueSnapshotId: snapshotId, entryType: "RESERVE", amountUsdMicros: values.reserveAddedUsdMicros, idempotencyKey: `admob-revenue:${snapshotId}:reserve`, metadata: { allocation: "RESERVE" } } }),
      tx.gldTreasuryEntry.create({ data: { revenueSnapshotId: snapshotId, entryType: "COMPANY", amountUsdMicros: values.companyShareUsdMicros, idempotencyKey: `admob-revenue:${snapshotId}:company`, metadata: { allocation: "COMPANY" } } }),
    ])
  }

  private serialize(value: unknown): unknown {
    if (typeof value === "bigint") return value.toString()
    if (value instanceof Date) return value.toISOString()
    if (Array.isArray(value)) return value.map((item) => this.serialize(item))
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, this.serialize(item)]))
    return value
  }
}
