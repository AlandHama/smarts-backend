import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from "@nestjs/common"
import { Prisma } from "@prisma/client"

import { PrismaService } from "../../prisma.service"
import { getGldConfig } from "./gld.config"
import { GldRevenueService } from "./gld.revenue.service"
import { UpdateGldControlsDto } from "./dtos/gld-admin.dto"
import { GldSimulationDto } from "./dtos/gld-simulation.dto"
import { GldManualBackingDto } from "./dtos/gld-manual-backing.dto"
import { writeAdminAudit } from "../../common/helpers/admin-audit"

const DAY_MS = 24 * 60 * 60 * 1000

@Injectable()
export class GldService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GldService.name)
  private timer?: ReturnType<typeof setInterval>
  private recalculating = false

  constructor(private readonly prisma: PrismaService, private readonly revenue: GldRevenueService) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.runScheduledCycle(), DAY_MS)
    void this.runScheduledCycle()
  }

  onModuleDestroy() { if (this.timer) clearInterval(this.timer) }

  async runScheduledCycle() {
    try {
      await this.revenue.materializeMaturedAdMobRevenue()
      await this.recalculate("scheduled")
    } catch (error) {
      this.logger.error(`GLD scheduled cycle failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  async getPublicState() {
    const state = await this.getOrCreateState()
    const now = new Date()
    const dayAgo = new Date(now.getTime() - DAY_MS)
    const weekAgo = new Date(now.getTime() - 7 * DAY_MS)
    const [previous, daySnapshot, weekSnapshot] = await Promise.all([
      this.prisma.gldEconomySnapshot.findFirst({ where: { createdAt: { lt: state.lastRecalculatedAt ?? now } }, orderBy: { createdAt: "desc" } }),
      this.prisma.gldEconomySnapshot.findFirst({ where: { createdAt: { lte: dayAgo } }, orderBy: { createdAt: "desc" } }),
      this.prisma.gldEconomySnapshot.findFirst({ where: { createdAt: { lte: weekAgo } }, orderBy: { createdAt: "desc" } }),
    ])
    return this.serialize({
      currency: { key: "GLD", symbol: "GLD", code: "GLD", unit: "GLD", usdMicros: state.displayedValueUsdMicros },
      displayedValue: { usdMicros: state.displayedValueUsdMicros, formattedUsd: this.formatUsd(state.displayedValueUsdMicros) },
      value: { usdMicros: state.displayedValueUsdMicros, previousUsdMicros: previous?.displayedValueUsdMicros ?? state.displayedValueUsdMicros },
      change: { dayBps: this.changeBps(state.displayedValueUsdMicros, daySnapshot?.displayedValueUsdMicros), weekBps: this.changeBps(state.displayedValueUsdMicros, weekSnapshot?.displayedValueUsdMicros) },
      health: state.health,
      updatedAt: state.updatedAt,
      lastRecalculatedAt: state.lastRecalculatedAt,
    })
  }

  async getHistory(days = 30, requestedGranularity = "day") {
    const bounded = Math.min(Math.max(Number(days) || 30, 1), 365)
    const granularity = requestedGranularity === "minute" || requestedGranularity === "hour" ? requestedGranularity : "day"
    const from = new Date(Date.now() - bounded * DAY_MS)
    const [state, rows] = await Promise.all([
      this.getOrCreateState(),
      this.prisma.gldEconomySnapshot.findMany({ where: { createdAt: { gte: from } }, orderBy: { createdAt: "asc" }, take: 10000 }),
    ])
    const samples = [...rows, { createdAt: state.updatedAt, displayedValueUsdMicros: state.displayedValueUsdMicros }]
    const buckets = new Map<number, { timestamp: Date; valueUsdMicros: bigint }>()
    for (const sample of samples) {
      if (sample.createdAt < from) continue
      const bucket = new Date(sample.createdAt)
      if (granularity === "minute") bucket.setUTCSeconds(0, 0)
      else if (granularity === "hour") bucket.setUTCMinutes(0, 0, 0)
      else bucket.setUTCHours(0, 0, 0, 0)
      buckets.set(bucket.getTime(), { timestamp: bucket, valueUsdMicros: sample.displayedValueUsdMicros })
    }
    const points = [...buckets.values()].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime()).map((point) => ({ timestamp: point.timestamp, valueUsdMicros: point.valueUsdMicros, createdAt: point.timestamp, displayedValueUsdMicros: point.valueUsdMicros }))
    return this.serialize({ days: bounded, granularity, points })
  }

  simulate(dto: GldSimulationDto) {
    const reserve = BigInt(dto.reserveUsdMicros)
    const supply = BigInt(dto.circulatingSupply)
    const config = getGldConfig()
    // Reserve and price are both represented in USD micros. Dividing the
    // reserve micros by the number of GLD units already produces USD micros
    // per GLD; multiplying by another million would overstate the price.
    const target = supply > 0n ? this.clamp(reserve / supply, config.minPriceUsdMicros, config.maxPriceUsdMicros) : config.maxPriceUsdMicros
    return this.serialize({ reserveUsdMicros: reserve, circulatingSupply: supply, priceUsdMicros: target, formattedUsd: this.formatUsd(target), minPriceUsdMicros: config.minPriceUsdMicros, maxPriceUsdMicros: config.maxPriceUsdMicros })
  }

  async getAdminState() {
    const state = await this.getOrCreateState()
    const config = getGldConfig()
    const dateKey = new Date().toISOString().slice(0, 10)
    const dayStart = new Date(`${dateKey}T00:00:00.000Z`)
    const [snapshots, revenueSnapshots, controls, emissionDay, burnTotals, revenueTotals, manualBackings, manualBackingTotals] = await Promise.all([
      this.prisma.gldEconomySnapshot.findMany({ orderBy: { createdAt: "desc" }, take: 30 }),
      this.revenue.listSnapshots(30),
      this.prisma.gldAdminControl.upsert({ where: { singletonKey: "default" }, create: { singletonKey: "default" }, update: {} }),
      this.prisma.gldEmissionDay.findUnique({ where: { dateKey } }),
      this.prisma.gldBurnEvent.aggregate({ _sum: { amount: true }, _count: { id: true } }),
      this.prisma.gldRevenueSnapshot.aggregate({ where: { recognitionStatus: { in: ["RECOGNIZED", "RESTATED"] } }, _sum: { grossAdRevenueUsdMicros: true, rewardBackingUsdMicros: true, reserveAddedUsdMicros: true }, _count: { id: true } }),
      this.prisma.gldManualBacking.findMany({ orderBy: { createdAt: "desc" }, take: 25, include: { createdBy: { select: { id: true, username: true, email: true } } } }),
      this.prisma.gldManualBacking.aggregate({ _sum: { amountUsdMicros: true }, _count: { id: true } }),
    ])
    const todayBurns = await this.prisma.gldBurnEvent.aggregate({ where: { createdAt: { gte: dayStart } }, _sum: { amount: true }, _count: { id: true } })
    return this.serialize({ state, config, controls, snapshots, revenueSnapshots, manualBackings, metrics: { dateKey, emissionDay, burns: { total: burnTotals._sum.amount ?? 0n, count: burnTotals._count.id, today: todayBurns._sum.amount ?? 0n, todayCount: todayBurns._count.id }, revenue: { grossAdRevenueUsdMicros: revenueTotals._sum.grossAdRevenueUsdMicros ?? 0n, rewardBackingUsdMicros: revenueTotals._sum.rewardBackingUsdMicros ?? 0n, reserveAddedUsdMicros: revenueTotals._sum.reserveAddedUsdMicros ?? 0n, snapshots: revenueTotals._count.id }, manualBacking: { totalUsdMicros: manualBackingTotals._sum.amountUsdMicros ?? 0n, count: manualBackingTotals._count.id } } })
  }

  async addManualBacking(dto: GldManualBackingDto, actorId: string) {
    const amountUsdMicros = this.parseUsd(dto.amountUsd)
    const reason = dto.reason.trim()
    const idempotencyKey = dto.idempotencyKey.trim()
    if (amountUsdMicros <= 0n) throw new BadRequestException("Manual backing must be greater than zero")
    if (!reason) throw new BadRequestException("A reason is required for manual backing")
    if (!idempotencyKey) throw new BadRequestException("An idempotency key is required")
    const backing = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.gldManualBacking.findUnique({ where: { idempotencyKey } })
      if (existing) return existing
      const created = await tx.gldManualBacking.create({ data: { amountUsdMicros, reason, idempotencyKey, createdById: actorId } })
      await tx.gldTreasuryEntry.create({ data: { manualBackingId: created.id, entryType: "RESERVE", amountUsdMicros, idempotencyKey: `manual-backing:${created.id}`, metadata: { source: "ADMIN_MANUAL_BACKING", reason } } })
      await writeAdminAudit(tx, { actorId, action: "GLD_MANUAL_BACKING_ADDED", entityType: "GldManualBacking", entityId: created.id, reason, metadata: { amountUsdMicros: amountUsdMicros.toString(), source: "ADMIN_MANUAL_BACKING" } })
      return created
    })
    return this.serialize(backing)
  }

  async updateControls(dto: UpdateGldControlsDto, actorId: string) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.gldAdminControl.upsert({ where: { singletonKey: "default" }, create: { singletonKey: "default" }, update: {} })
      const updated = await tx.gldAdminControl.update({ where: { id: before.id }, data: {
        ...(dto.emissionsPaused === undefined ? {} : { emissionsPaused: dto.emissionsPaused }),
        ...(dto.catalogSinksPaused === undefined ? {} : { catalogSinksPaused: dto.catalogSinksPaused }),
        ...(dto.giftsPaused === undefined ? {} : { giftsPaused: dto.giftsPaused }),
        ...(dto.paidRewardsPaused === undefined ? {} : { paidRewardsPaused: dto.paidRewardsPaused }),
        ...(dto.reason === undefined ? {} : { reason: dto.reason.trim() || null }),
        updatedById: actorId,
      } })
      await writeAdminAudit(tx, { actorId, action: "GLD_CONTROLS_UPDATED", entityType: "GldAdminControl", entityId: updated.id, reason: dto.reason, metadata: { before: { emissionsPaused: before.emissionsPaused, catalogSinksPaused: before.catalogSinksPaused, giftsPaused: before.giftsPaused, paidRewardsPaused: before.paidRewardsPaused }, after: { emissionsPaused: updated.emissionsPaused, catalogSinksPaused: updated.catalogSinksPaused, giftsPaused: updated.giftsPaused, paidRewardsPaused: updated.paidRewardsPaused } } })
      return this.serialize(updated)
    })
  }

  async recalculate(reason = "manual") {
    if (this.recalculating) return { skipped: true, reason: "recalculation-in-progress" }
    this.recalculating = true
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext('SMARTS_GLD_ECONOMY_RECALCULATION'))`)
        const config = getGldConfig()
        const currency = await tx.currencyDefinition.findUnique({ where: { code: "GLD" }, select: { id: true, active: true } })
        if (!currency?.active) throw new NotFoundException("GLD currency is not configured")
        const current = await tx.gldEconomyState.upsert({ where: { currencyId: currency.id }, create: { currencyId: currency.id, displayedValueUsdMicros: config.initialPriceUsdMicros, targetValueUsdMicros: config.initialPriceUsdMicros, treasuryReserveUsdMicros: 0n, circulatingSupply: 0n, reserveRatioBps: 0, smoothingFactorBps: config.smoothingFactorBps, minPriceUsdMicros: config.minPriceUsdMicros, maxPriceUsdMicros: config.maxPriceUsdMicros, dailyEmissionBudget: 0n, dailyEmissionUsed: 0n }, update: {} })
        const supplyResult = await tx.walletBalance.aggregate({ where: { currencyId: currency.id, wallet: { status: "ACTIVE" } }, _sum: { amount: true } })
        const circulatingSupply = supplyResult._sum.amount ?? 0n
        const reserveResult = await tx.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`SELECT COALESCE(SUM(CASE WHEN "entryType" = 'RESERVE' OR ("entryType" = 'ADJUSTMENT' AND "metadata"->>'allocation' = 'RESERVE') THEN "amountUsdMicros" ELSE 0 END), 0)::bigint AS total FROM "GldTreasuryEntry"`)
        const treasuryReserve = reserveResult[0]?.total ?? 0n
        // Reserve and price are both represented in USD micros. The division
        // therefore directly gives the reserve-backed USD-micros price per GLD.
        const target = circulatingSupply > 0n ? this.clamp(treasuryReserve / circulatingSupply, config.minPriceUsdMicros, config.maxPriceUsdMicros) : current.displayedValueUsdMicros
        const displayed = this.clamp(this.smooth(current.displayedValueUsdMicros, target, config.smoothingFactorBps), config.minPriceUsdMicros, config.maxPriceUsdMicros)
        const liability = circulatingSupply * displayed
        const reserveRatioBps = liability > 0n ? Number((treasuryReserve * 10_000n) / liability) : 0
        const health = this.health(reserveRatioBps)
        const dateKey = new Date().toISOString().slice(0, 10)
        const dailyBudget = await this.calculateDailyBudget(tx, dateKey, displayed, config)
        const emissionDay = await tx.gldEmissionDay.findUnique({ where: { dateKey }, select: { emittedAmount: true } })
        const latestRevenue = await tx.gldRevenueSnapshot.findFirst({ where: { recognitionStatus: { in: ["RECOGNIZED", "RESTATED"] } }, orderBy: { periodEnd: "desc" }, select: { periodEnd: true } })
        const recalculatedAt = new Date()
        const updated = await tx.gldEconomyState.update({ where: { id: current.id }, data: { displayedValueUsdMicros: displayed, targetValueUsdMicros: target, treasuryReserveUsdMicros: treasuryReserve, circulatingSupply, reserveRatioBps, health, dailyEmissionBudget: dailyBudget, dailyEmissionUsed: emissionDay?.emittedAmount ?? 0n, smoothingFactorBps: config.smoothingFactorBps, minPriceUsdMicros: config.minPriceUsdMicros, maxPriceUsdMicros: config.maxPriceUsdMicros, lastRevenueSnapshotAt: latestRevenue?.periodEnd ?? null, lastRecalculatedAt: recalculatedAt } })
        await tx.gldEconomySnapshot.create({ data: { displayedValueUsdMicros: displayed, targetValueUsdMicros: target, treasuryReserveUsdMicros: treasuryReserve, circulatingSupply, reserveRatioBps, dailyEmissionBudget: dailyBudget, dailyEmissionUsed: emissionDay?.emittedAmount ?? 0n, reason, metadata: { algorithm: "reserve-over-circulating-supply", version: 1 } } })
        return updated
      })
      return this.serialize(result)
    } finally { this.recalculating = false }
  }

  private async calculateDailyBudget(tx: Prisma.TransactionClient, dateKey: string, displayed: bigint, config: ReturnType<typeof getGldConfig>) {
    const start = new Date(`${dateKey}T00:00:00.000Z`)
    const end = new Date(start.getTime() + DAY_MS)
    const backing = await tx.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`SELECT COALESCE(SUM(CASE WHEN "entryType" = 'REWARD_BACKING' OR ("entryType" = 'ADJUSTMENT' AND "metadata"->>'allocation' = 'REWARD_BACKING') THEN "amountUsdMicros" ELSE 0 END), 0)::bigint AS total FROM "GldTreasuryEntry" WHERE "createdAt" >= ${start} AND "createdAt" < ${end}`)
    const raw = displayed > 0n ? (backing[0]?.total ?? 0n) / displayed : 0n
    const prior = await tx.gldEmissionDay.findFirst({ where: { dateKey: { lt: dateKey } }, orderBy: { dateKey: "desc" }, select: { emissionBudget: true } })
    const hasPriorBudget = Boolean(prior && prior.emissionBudget > 0n)
    const growthCap = hasPriorBudget ? (prior!.emissionBudget * BigInt(10_000 + config.maxDailyGrowthBps)) / 10_000n : config.maximumDailyEmission
    const dropFloor = hasPriorBudget ? (prior!.emissionBudget * BigInt(Math.max(0, 10_000 - config.maxDailyDropBps))) / 10_000n : 0n
    const budget = this.clamp(raw, config.minimumDailyEmission, config.maximumDailyEmission)
    const bounded = hasPriorBudget ? this.clamp(budget, dropFloor, growthCap) : budget
    await tx.gldEmissionDay.upsert({ where: { dateKey }, create: { dateKey, emissionBudget: bounded }, update: { emissionBudget: bounded } })
    return bounded
  }

  private async getOrCreateState() {
    const config = getGldConfig()
    const currency = await this.prisma.currencyDefinition.findUnique({ where: { code: "GLD" }, select: { id: true, active: true } })
    if (!currency?.active) throw new NotFoundException("GLD currency is not configured")
    return this.prisma.gldEconomyState.upsert({ where: { currencyId: currency.id }, create: { currencyId: currency.id, displayedValueUsdMicros: config.initialPriceUsdMicros, targetValueUsdMicros: config.initialPriceUsdMicros, treasuryReserveUsdMicros: 0n, circulatingSupply: 0n, reserveRatioBps: 0, smoothingFactorBps: config.smoothingFactorBps, minPriceUsdMicros: config.minPriceUsdMicros, maxPriceUsdMicros: config.maxPriceUsdMicros, dailyEmissionBudget: 0n, dailyEmissionUsed: 0n }, update: {} })
  }

  private clamp(value: bigint, min: bigint, max: bigint) { return value < min ? min : value > max ? max : value }
  private smooth(previous: bigint, target: bigint, factorBps: number) { return previous + ((target - previous) * BigInt(factorBps)) / 10_000n }
  private health(ratio: number) { return ratio >= 12_000 ? "VERY_HEALTHY" : ratio >= 10_000 ? "HEALTHY" : ratio >= 8_000 ? "CAUTION" : ratio >= 6_000 ? "RESTRICTED" : "CRITICAL" }
  private changeBps(current: bigint, historical?: bigint) { return !historical || historical === 0n ? 0 : Number(((current - historical) * 10_000n) / historical) }
  private parseUsd(value: string) {
    const match = value.trim().match(/^(\d+)(?:\.(\d{0,6}))?$/)
    if (!match) throw new BadRequestException("Manual backing must be a valid USD amount with up to 6 decimal places")
    return BigInt(match[1]) * 1_000_000n + BigInt((match[2] ?? "").padEnd(6, "0") || "0")
  }
  private formatUsd(micros: bigint) { return `$${(micros / 1_000_000n).toString()}.${(micros % 1_000_000n).toString().padStart(6, "0").padEnd(10, "0")}` }
  private serialize(value: unknown): any {
    if (typeof value === "bigint") return value.toString()
    if (value instanceof Date) return value.toISOString()
    if (Array.isArray(value)) return value.map((item) => this.serialize(item))
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, this.serialize(item)]))
    return value
  }
}
