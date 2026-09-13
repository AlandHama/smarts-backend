import { Injectable, Logger } from "@nestjs/common"
import { Prisma } from "@prisma/client"

import { PrismaService } from "../../prisma.service"
import { getGldConfig } from "./gld.config"

@Injectable()
export class GldRevenueService {
  private readonly logger = new Logger(GldRevenueService.name)

  constructor(private readonly prisma: PrismaService) {}

  /** Materialize only mature, USD-denominated AdMob rows. */
  async materializeMaturedAdMobRevenue(now = new Date()) {
    const connection = await this.prisma.adMobConnection.findUnique({ where: { provider: "ADMOB" }, select: { id: true, currencyCode: true, status: true } })
    if (!connection || connection.status !== "CONNECTED") return { processed: 0, skipped: "admob-not-connected" }
    if ((connection.currencyCode ?? "USD").toUpperCase() !== "USD") return { processed: 0, skipped: "admob-currency-not-usd" }

    const matureDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 2))
    const periodEnd = new Date(matureDay.getTime() + 24 * 60 * 60 * 1000)
    const result = await this.materializeDay(connection.id, matureDay, periodEnd)
    return { processed: result ? 1 : 0, date: matureDay.toISOString().slice(0, 10) }
  }

  async listSnapshots(limit = 30) {
    const rows = await this.prisma.gldRevenueSnapshot.findMany({ orderBy: { periodEnd: "desc" }, take: Math.min(Math.max(limit, 1), 100) })
    return rows.map((row) => this.serialize(row))
  }

  private async materializeDay(connectionId: string, periodStart: Date, periodEnd: Date) {
    const row = await this.prisma.adMobReportRow.aggregate({ where: { connectionId, reportDate: periodStart }, _sum: { estimatedEarningsMicros: true } })
    const gross = row._sum.estimatedEarningsMicros ?? 0n
    const config = getGldConfig()
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
      metadata: { source: "admob-network-report", matureAfterDays: 2 },
    }
    if (!existing) {
      await this.prisma.$transaction(async (tx) => {
        const snapshot = await tx.gldRevenueSnapshot.create({ data: { periodStart, periodEnd, source: "ADMOB_NETWORK_REPORT", ...values } })
        await this.createAllocationEntries(tx, snapshot.id, values)
      })
      return true
    }

    const changed = existing.grossAdRevenueUsdMicros !== gross || existing.adCostsUsdMicros !== config.adCostsUsdMicros
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
